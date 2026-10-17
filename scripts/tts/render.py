"""
Render the text audio jobs phones submit (lb_tts_jobs) with Kokoro and store the clips in
lb_tts_clips, where the phones pick them up. Run by .github/workflows/tts.yml.

    python scripts/tts/render.py <models dir> [--linger SECONDS] [--selftest]

Env: SUPABASE_URL and SUPABASE_SERVICE_KEY (the workflow reads the key through the Management API);
SUPABASE_REST instead of SUPABASE_URL for a bare local PostgREST.

Same voices, G2P and loudness as the recordings (scripts/audio/generate.py): sentences in the
American voice, words in the voice of the unit (American or British). Clips are uploaded a few at
a time and the job's progress is updated as they land, so a phone can play the first sentences
while the rest is still rendering.

Privacy: the repository and its Actions logs are public, the texts are not. This script prints
counts and timings only, never a text, a word or phonemes; an error prints its type only.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "audio"))
from generate import SR, check, encode, polish  # noqa: E402

logging.disable(logging.CRITICAL)

STALE_MIN = 15  # a "running" job untouched this long was left by a run that died
UPLOAD_EVERY = 4  # clips per upload (and per progress update)
CLIP_KEEP_DAYS = 120
JOB_KEEP_DAYS = 30
MAX_CHUNK = 280  # characters per synthesis chunk for very long sentences


# ---------------------------------------------------------------- REST


class Db:
    def __init__(self, url: str, key: str):
        # SUPABASE_REST points straight at a PostgREST (local tests); Supabase serves it at /rest/v1/.
        self.base = (os.environ.get("SUPABASE_REST") or url.rstrip("/") + "/rest/v1").rstrip("/") + "/"
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # a legacy JWT key also goes in Authorization
            self.headers["Authorization"] = f"Bearer {key}"

    def call(self, method: str, path: str, body=None, prefer: str | None = None):
        data = None if body is None else json.dumps(body).encode()
        h = dict(self.headers)
        if prefer:
            h["Prefer"] = prefer
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    raw = r.read()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                if e.code < 500 or attempt == 3:
                    raise RuntimeError(f"HTTP {e.code} on {method} {path.split('?')[0]}") from None
            except urllib.error.URLError:
                if attempt == 3:
                    raise RuntimeError(f"network error on {method} {path.split('?')[0]}") from None
            time.sleep(2 * (attempt + 1))


def q(v: str) -> str:
    return urllib.parse.quote(v, safe="")


def now_iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


# ---------------------------------------------------------------- synthesis


class Speaker:
    """Kokoro with the recordings' G2P (misaki, espeak fallback), loaded once on first use."""

    def __init__(self, models: Path):
        self.models = models
        self.v = None

    def voices(self):
        if self.v is None:
            from generate import Voices

            self.v = Voices(self.models)
        return self.v

    def phonemes(self, text: str, accent: str) -> list[str]:
        v = self.voices()
        out: list[str] = []
        for p in (v.g2p[accent](text)[0], v.espeak[accent](text)[0]):
            p = v.clean(p)
            if p and p not in out:
                out.append(p)
        return out

    def one(self, text: str, accent: str, kind: str) -> np.ndarray | None:
        """Best clip for one piece of text: the first candidate that passes the checks."""
        first = None
        for p in self.phonemes(text, accent):
            a, qc = polish(self.voices().say(p, accent, 1.0), kind)
            if a is None:
                continue
            if check(qc, kind, text, 1.0).get("ok"):
                return a
            first = first if first is not None else a
        return first

    def render(self, text: str, accent: str, word: bool) -> np.ndarray | None:
        kind = "word" if word else "sentence"
        if word or len(text) <= MAX_CHUNK:
            return self.one(text, accent, kind)
        # Very long sentences: synthesize clause by clause and join with a short pause.
        parts, cur = [], ""
        for piece in re.split(r"(?<=[,;:])\s+", text):
            if cur and len(cur) + len(piece) + 1 > MAX_CHUNK:
                parts.append(cur)
                cur = piece
            else:
                cur = f"{cur} {piece}".strip()
        if cur:
            parts.append(cur)
        clips = [self.one(p, accent, "sentence") for p in parts]
        if any(c is None for c in clips):
            return None
        gap = np.zeros(int(0.12 * SR), dtype=np.float32)
        out = []
        for i, c in enumerate(clips):
            out.extend([gap, c] if i else [c])
        return np.concatenate(out)


def to_m4a(a: np.ndarray) -> bytes:
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "c.m4a"
        encode(a, path)
        return path.read_bytes()


# ---------------------------------------------------------------- jobs


def open_jobs(db: Db) -> list[dict]:
    rows = db.call(
        "GET",
        "lb_tts_jobs?select=id,status,updated_at,total&status=in.(pending,running)"
        "&order=created_at.asc",
    ) or []
    stale = datetime.now(timezone.utc) - timedelta(minutes=STALE_MIN)
    out = []
    for r in rows:
        if r["status"] == "running":
            at = datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))
            if at > stale:
                continue
        out.append(r)
    return out


def existing(db: Db, units: list[dict]) -> set[tuple[str, str]]:
    have: set[tuple[str, str]] = set()
    for v in ("us", "uk"):
        keys = sorted({u["k"] for u in units if u.get("v", "us") == v})
        for i in range(0, len(keys), 80):
            chunk = ",".join(q(k) for k in keys[i : i + 80])
            rows = db.call("GET", f"lb_tts_clips?select=k&v=eq.{v}&k=in.({chunk})") or []
            have |= {(r["k"], v) for r in rows}
    return have


def run_job(db: Db, sp: Speaker, job_id: str, stats: dict) -> None:
    rows = db.call("GET", f"lb_tts_jobs?select=units,status&id=eq.{q(job_id)}") or []
    if not rows:
        return
    units = [u for u in rows[0]["units"] if isinstance(u, dict) and u.get("k") and u.get("t")]
    db.call("PATCH", f"lb_tts_jobs?id=eq.{q(job_id)}", {"status": "running", "updated_at": now_iso()})
    have = existing(db, units)
    done = failed = 0
    batch: list[dict] = []

    def flush():
        nonlocal batch
        if batch:
            db.call("POST", "lb_tts_clips", batch, prefer="resolution=merge-duplicates")
            batch = []
        db.call(
            "PATCH",
            f"lb_tts_jobs?id=eq.{q(job_id)}",
            {"done": done, "failed": failed, "updated_at": now_iso()},
        )

    seen: set[tuple[str, str]] = set()
    for u in units:
        key = (u["k"], u.get("v", "us"))
        if key in have or key in seen:
            done += 1
            continue
        seen.add(key)
        t0 = time.time()
        try:
            text = str(u["t"])[:2000]
            a = sp.render(text, key[1], bool(u.get("w")))
            if a is None:
                raise ValueError("no clip")
            data = to_m4a(a)
            batch.append({
                "k": key[0],
                "v": key[1],
                "audio": base64.b64encode(data).decode(),
                "ms": int(len(a) * 1000 / SR),
            })
            done += 1
            stats["audio_s"] += len(a) / SR
            stats["clips"] += 1
        except Exception as e:  # noqa: BLE001 - one bad unit never stops the job
            failed += 1
            stats["errors"][type(e).__name__] = stats["errors"].get(type(e).__name__, 0) + 1
        stats["render_s"] += time.time() - t0
        if len(batch) >= UPLOAD_EVERY:
            flush()
    flush()
    status = "failed" if failed and not done else "done"
    db.call("PATCH", f"lb_tts_jobs?id=eq.{q(job_id)}", {"status": status, "updated_at": now_iso()})
    stats["jobs"] += 1
    print(f"job {stats['jobs']}: {len(units)} units, {done} ready, {failed} failed", flush=True)


def cleanup(db: Db) -> None:
    db.call("DELETE", f"lb_tts_clips?created_at=lt.{q(now_iso(-timedelta(days=CLIP_KEEP_DAYS)))}")
    db.call("DELETE", f"lb_tts_jobs?created_at=lt.{q(now_iso(-timedelta(days=JOB_KEEP_DAYS)))}")


SELFTEST_UNITS = [
    {"k": "selftest-s1", "v": "us", "t": "The weather was lovely, so we walked along the river."},
    {"k": "selftest-s2", "v": "us",
     "t": "In 2025, the lab spent $3.5 million on compute, roughly 40% more than the year before; "
          "even so, the researchers said the results, which were published in March, justified "
          "the cost, and they plan to share the code, the data and the weights with everyone "
          "who asks for them."},
    {"k": "selftest-w1", "v": "us", "t": "multimodal", "w": True},
    {"k": "selftest-w1", "v": "uk", "t": "multimodal", "w": True},
]


def selftest(db: Db, sp: Speaker, stats: dict) -> None:
    jid = f"selftest-{int(time.time())}"
    db.call("POST", "lb_tts_jobs", {
        "id": jid, "user_id": "selftest", "units": SELFTEST_UNITS, "total": len(SELFTEST_UNITS),
    })
    db.call("DELETE", "lb_tts_clips?k=like.selftest-*")
    run_job(db, sp, jid, stats)
    job = db.call("GET", f"lb_tts_jobs?select=status,done,failed&id=eq.{q(jid)}")[0]
    clips = db.call("GET", "lb_tts_clips?select=k,v,audio,ms&k=like.selftest-*") or []
    ok = job["status"] == "done" and job["done"] == len(SELFTEST_UNITS) and len(clips) == 4
    for c in clips:
        raw = base64.b64decode(c["audio"])
        ok = ok and raw[4:8] == b"ftyp" and c["ms"] > 300
    print(f"selftest: job {job['status']}, {len(clips)} clips, valid m4a: {ok}", flush=True)
    db.call("DELETE", "lb_tts_clips?k=like.selftest-*")
    db.call("DELETE", f"lb_tts_jobs?id=eq.{q(jid)}")
    if not ok:
        sys.exit(1)


def main() -> None:
    args = sys.argv[1:]
    models = Path(args[0])
    linger = int(args[args.index("--linger") + 1]) if "--linger" in args else 0
    db = Db(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    sp = Speaker(models)
    stats = {"jobs": 0, "clips": 0, "audio_s": 0.0, "render_s": 0.0, "errors": {}}
    t0 = time.time()
    if "--selftest" in args:
        selftest(db, sp, stats)
    idle_since = time.time()
    while True:
        jobs = open_jobs(db)
        for j in jobs:
            run_job(db, sp, j["id"], stats)
        if jobs:
            idle_since = time.time()
        elif time.time() - idle_since >= linger:
            break
        else:
            time.sleep(8)
    cleanup(db)
    speed = stats["audio_s"] / stats["render_s"] if stats["render_s"] else 0
    print(
        f"done: {stats['jobs']} jobs, {stats['clips']} clips, {stats['audio_s']:.0f} s of audio "
        f"rendered at {speed:.1f}x real time, {time.time() - t0:.0f} s in all, "
        f"errors {json.dumps(stats['errors'])}",
        flush=True,
    )


if __name__ == "__main__":
    main()
