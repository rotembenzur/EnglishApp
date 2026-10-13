"""
Render one chunk of the audio plan with Kokoro, check every clip, encode AAC.

    python scripts/audio/generate.py <chunk.json> <out dir> <models dir>

For every unit in the chunk it writes <out>/<g>.m4a and one JSON line in <out>/results.jsonl.
Words: candidate pronunciations are tried in order (misaki G2P, the lexicon variant that matches
our IPA for heteronyms, phonemes converted from our IPA, espeak) until a clip passes the silence
and duration checks and Whisper hears the right word. Sentences: misaki, then espeak. Prints
counts only (the repository rules forbid printing word lists).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from phonemes import in_vocab, ipa_to_misaki, phone_distance  # noqa: E402

CFG = json.loads((Path(__file__).parent / "config.json").read_text())
SR = CFG["sampleRate"]
FRAME = SR // 100  # 10 ms


# ---------------------------------------------------------------- audio checks


def frames_db(a: np.ndarray) -> np.ndarray:
    n = len(a) // FRAME
    if n == 0:
        return np.array([-120.0])
    f = a[: n * FRAME].reshape(n, FRAME)
    rms = np.sqrt(np.mean(f * f, axis=1) + 1e-12)
    return 20 * np.log10(rms + 1e-12)


def polish(a: np.ndarray, kind: str) -> tuple[np.ndarray | None, dict]:
    """Trim, normalize loudness, fade; return the clip and its quality-check record."""
    qc: dict = {}
    if a is None or len(a) == 0 or not np.isfinite(a).all():
        return None, {"ok": False, "why": "empty"}
    a = a.astype(np.float32)
    db = frames_db(a)
    peak_db = float(db.max())
    thr = max(-55.0, peak_db - 38.0)
    voiced = np.where(db > thr)[0]
    if len(voiced) == 0 or peak_db < -45:
        return None, {"ok": False, "why": "silent"}
    start = max(0, voiced[0] * FRAME - int(0.06 * SR))
    end = min(len(a), (voiced[-1] + 1) * FRAME + int(0.15 * SR))
    a = a[start:end]
    # Longest silence inside the speech.
    inner = db[voiced[0] : voiced[-1] + 1] <= thr
    run = best = 0
    for s in inner:
        run = run + 1 if s else 0
        best = max(best, run)
    qc["gap"] = round(best / 100, 2)
    # Loudness: voiced RMS to -18 dBFS, peak never above -1 dBFS.
    vdb = db[voiced]
    vrms = 10 ** (np.mean(vdb) / 20)
    gain = 10 ** (-18 / 20) / max(vrms, 1e-6)
    peak = float(np.max(np.abs(a))) or 1e-6
    gain = min(gain, 10 ** (-1 / 20) / peak)
    a = a * gain
    fade = int(0.005 * SR)
    if len(a) > 4 * fade:
        a[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
        a[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    dur = len(a) / SR
    qc["dur"] = round(dur, 3)
    return a, qc


def check(qc: dict, kind: str, text: str, speed: float) -> dict:
    if "why" in qc:
        return qc
    dur, gap = qc["dur"], qc["gap"]
    n = len(text)
    if kind == "word":
        lo, hi = 0.18 / speed, (0.9 + 0.11 * n) / speed
        max_gap = (0.55 if " " not in text else 0.8) / speed
    else:
        cps = n / max(dur, 0.01)
        qc["cps"] = round(cps, 1)
        lo, hi = n / 30.0, n / 7.0 + 0.8
        max_gap = 1.1
    why = []
    if dur < lo:
        why.append("short")
    if dur > hi:
        why.append("long")
    if gap > max_gap:
        why.append("gap")
    qc["ok"] = not why
    if why:
        qc["why"] = ",".join(why)
    return qc


def encode(a: np.ndarray, path: Path) -> None:
    pcm = np.clip(a, -1, 1).astype("<f4").tobytes()
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
            "-c:a", "aac", "-b:a", CFG["aacBitrate"], "-ar", str(SR), "-ac", "1",
            "-movflags", "+faststart", "-map_metadata", "-1", str(path),
        ],
        input=pcm,
        check=True,
    )


# ---------------------------------------------------------------- speech recognition


class Ears:
    """Whisper (faster-whisper, CPU int8): a small model first, a bigger one for a second opinion."""

    def __init__(self, models: Path, g2p):
        from faster_whisper import WhisperModel

        self._WM = WhisperModel
        self.root = str(models / "whisper")
        threads = os.cpu_count() or 4
        self.first = WhisperModel(CFG["asrFirst"], device="cpu", compute_type="int8",
                                  cpu_threads=threads, download_root=self.root)
        self._second = None
        self.g2p = g2p
        self.threads = threads

    def second(self):
        if self._second is None:
            self._second = self._WM(CFG["asrSecond"], device="cpu", compute_type="int8",
                                    cpu_threads=self.threads, download_root=self.root)
        return self._second

    @staticmethod
    def _run(model, path: Path) -> str:
        # Decode the encoded clip ourselves (16 kHz mono float): checks the AAC file as shipped and
        # keeps faster-whisper away from PyAV, whose API changes between releases.
        pcm = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
             "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"],
            capture_output=True, check=True,
        ).stdout
        audio = np.frombuffer(pcm, dtype="<f4").copy()
        segs, _ = model.transcribe(
            audio, language="en", beam_size=5, temperature=0.0,
            without_timestamps=True, condition_on_previous_text=False, vad_filter=False,
        )
        return " ".join(s.text for s in segs).strip()

    def norm(self, s: str) -> list[str]:
        from num2words import num2words

        s = s.lower().replace("’", "'")
        s = re.sub(r"\d+", lambda m: " " + num2words(int(m.group())) + " ", s)
        s = re.sub(r"[^a-z' ]+", " ", s.replace("-", " "))
        return [w.strip("'") for w in s.split() if w.strip("'")]

    def phones(self, words: list[str]) -> str:
        if not words:
            return ""
        return self.g2p(" ".join(words))[0] or ""

    def judge(self, heard: str, text: str, kind: str) -> dict:
        h, t = self.norm(heard), self.norm(text)
        if h == t:
            return {"ok": True, "how": "exact"}
        pd = phone_distance(self.phones(h), self.phones(t))
        if kind == "word":
            ok = pd <= 0.2
        else:
            ok = pd <= 0.15 or wer(h, t) <= 0.15
        return {"ok": ok, "how": "phones" if ok else "miss", "pd": round(pd, 3)}

    def hear(self, path: Path, text: str, kind: str) -> dict:
        heard = self._run(self.first, path)
        v = self.judge(heard, text, kind)
        v["model"] = CFG["asrFirst"]
        v["heard"] = heard
        if not v["ok"]:
            heard2 = self._run(self.second(), path)
            v2 = self.judge(heard2, text, kind)
            v2["model"] = CFG["asrSecond"]
            v2["heard"] = heard2
            v2["first"] = {"heard": heard, "pd": v.get("pd")}
            v = v2
        return v


def wer(h: list[str], t: list[str]) -> float:
    if not t:
        return 0.0 if not h else 1.0
    prev = list(range(len(t) + 1))
    for i, a in enumerate(h, 1):
        cur = [i]
        for j, b in enumerate(t, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a != b)))
        prev = cur
    return prev[-1] / len(t)


# ---------------------------------------------------------------- pronunciation candidates


class Voices:
    def __init__(self, models: Path):
        from kokoro_onnx import Kokoro
        from kokoro_onnx.config import get_vocab
        from misaki import en, espeak

        self.tts = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
        self.vocab = get_vocab()
        self.g2p = {
            "us": en.G2P(trf=False, british=False, fallback=espeak.EspeakFallback(british=False)),
            "uk": en.G2P(trf=False, british=True, fallback=espeak.EspeakFallback(british=True)),
        }
        self.espeak = {
            "us": espeak.EspeakG2P(language="en-us"),
            "uk": espeak.EspeakG2P(language="en-gb"),
        }

    def say(self, phonemes: str, accent: str, speed: float) -> np.ndarray:
        voice = CFG["voices"][accent]
        a, sr = self.tts.create(phonemes, voice=voice, speed=speed, is_phonemes=True,
                                lang="en-gb" if accent == "uk" else "en-us")
        assert sr == SR, sr
        return a

    def clean(self, p: str) -> str | None:
        p = (p or "").strip()
        if not p or not in_vocab(p, self.vocab):
            return None
        return p

    def word_candidates(self, u: dict) -> list[tuple[str, str]]:
        accent, text = u["voice"], u["text"]
        out: list[tuple[str, str]] = []

        def add(method: str, p: str | None):
            p = self.clean(p) if p else None
            if p and all(p != q for _, q in out):
                out.append((method, p))

        if u.get("override"):
            add("override", u["override"])
        g2p = self.g2p[accent](text)[0]
        het = self.heteronym(u)
        if het:
            add("lexicon", het)
        own_ipa = u.get("ipa")
        if het and own_ipa:
            add("ipa", ipa_to_misaki(own_ipa, accent == "uk"))
        add("g2p", g2p)
        if own_ipa:
            add("ipa", ipa_to_misaki(own_ipa, accent == "uk"))
        try:
            add("espeak", self.espeak[accent](text)[0])
        except Exception:  # noqa: BLE001
            pass
        return out

    def heteronym(self, u: dict) -> str | None:
        """For words with several dictionary pronunciations, pick the one our IPA describes."""
        text = u["text"]
        if " " in text or not u.get("refIpa"):
            return None
        us_gold = self.g2p["us"].lexicon.golds.get(text)
        if not isinstance(us_gold, dict):
            return None
        ref = ipa_to_misaki(u["refIpa"], False)
        tag = min(
            (t for t, p in us_gold.items() if p),
            key=lambda t: phone_distance(us_gold[t], ref),
        )
        gold = self.g2p[u["voice"]].lexicon.golds.get(text)
        if isinstance(gold, dict):
            return gold.get(tag) or gold.get("DEFAULT")
        if isinstance(gold, str):
            return gold
        return None


# ---------------------------------------------------------------- main


def render(voices: Voices, ears: Ears | None, out: Path, u: dict, kind: str, speed: float,
           cands: list[tuple[str, str]], g: str, asr: bool) -> dict:
    """Try candidates in order; keep the first that passes, else the best one seen."""
    best: tuple[tuple, dict, np.ndarray] | None = None
    attempts = 0
    tmp = out / f"{g}.try.m4a"
    for method, p in cands:
        attempts += 1
        try:
            raw = voices.say(p, u["voice"], speed)
        except Exception as e:  # noqa: BLE001
            print(f"synthesis error ({method}): {str(e)[:80]}", flush=True)
            continue
        a, qc = polish(raw, kind)
        if a is None:
            continue
        qc = check(qc, kind, u["text"], speed)
        rec: dict = {"method": method, "phonemes": p, "qc": qc}
        if not qc.get("ok"):
            score: tuple = (0, 0.0)
        elif asr and ears is not None:
            encode(a, tmp)
            rec["asr"] = ears.hear(tmp, u["text"], kind)
            score = (2 if rec["asr"]["ok"] else 1, -rec["asr"].get("pd", 0.0))
        else:
            score = (2, 0.0)
        if best is None or score > best[0]:
            best = (score, rec, a)
        if score[0] == 2:
            break
    tmp.unlink(missing_ok=True)
    if best is None:
        return {"g": g, "ok": False, "attempts": attempts}
    _, rec, a = best
    encode(a, out / f"{g}.m4a")
    return {
        "g": g,
        "ok": bool(rec["qc"].get("ok")),
        "asrOk": rec["asr"]["ok"] if "asr" in rec else None,
        "attempts": attempts,
        **rec,
        "bytes": (out / f"{g}.m4a").stat().st_size,
    }


def main() -> None:
    chunk_path, out_dir, models = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out_dir.mkdir(parents=True, exist_ok=True)
    chunk = json.loads(chunk_path.read_text())
    voices = Voices(models)
    # AUDIO_NO_ASR=1 skips recognition (local smoke tests where the Whisper models are unreachable).
    ears = None if os.environ.get("AUDIO_NO_ASR") else Ears(models, voices.g2p["us"])
    res = (out_dir / "results.jsonl").open("a")
    t0 = time.time()
    n = 0
    stats = {"clips": 0, "failed": 0, "asrChecked": 0, "asrMiss": 0, "retried": 0}
    for u in chunk["units"]:
        if u["type"] == "word":
            cands = voices.word_candidates(u)
            r = render(voices, ears, out_dir, u, "word", 1.0, cands, u["g"], True)
            r.update({"key": u["key"], "voice": u["voice"], "kind": "word", "speed": 1.0})
            # The slow version uses the pronunciation that won for the normal one.
            chosen = [c for c in cands if c[1] == r.get("phonemes")] or cands
            rest = [c for c in cands if c not in chosen]
            rs = render(voices, ears, out_dir, u, "word", CFG["slowSpeed"], chosen + rest, u["gs"], True)
            rs.update({"key": u["key"], "voice": u["voice"], "kind": "word", "speed": CFG["slowSpeed"]})
            rows = [r, rs]
        else:
            g2p = voices.g2p["us"](u["text"])[0]
            cands = [("g2p", g2p)]
            try:
                cands.append(("espeak", voices.espeak["us"](u["text"])[0]))
            except Exception:  # noqa: BLE001
                pass
            cands = [(m, p) for m, p in cands if voices.clean(p)]
            r = render(voices, ears, out_dir, u, "sentence", 1.0, cands, u["g"], bool(u.get("sample")))
            r.update({"key": u["key"], "voice": "us", "kind": "sentence", "speed": 1.0})
            rows = [r]
        for row in rows:
            stats["clips"] += 1
            stats["failed"] += 0 if row["ok"] else 1
            if row.get("asrOk") is not None:
                stats["asrChecked"] += 1
                stats["asrMiss"] += 0 if row["asrOk"] else 1
            stats["retried"] += 1 if row.get("attempts", 1) > 1 else 0
            res.write(json.dumps(row, ensure_ascii=False) + "\n")
        n += 1
        if n % 100 == 0:
            res.flush()
            el = time.time() - t0
            print(f"{n}/{len(chunk['units'])} units, {el:.0f}s, {json.dumps(stats)}", flush=True)
    res.close()
    print(f"done: {n} units in {time.time() - t0:.0f}s, {json.dumps(stats)}", flush=True)


if __name__ == "__main__":
    main()
