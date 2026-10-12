#!/usr/bin/env python3
"""
Builds content/lemmas.json, the lemma inventory backbone (spec 5.1).

Sources (all open, downloaded into scripts/.cache by `scripts/fetch-data.sh`):
  - wordfreq (MIT, Robyn Speer): real-world English word frequencies.
  - WordNet 3.0 via NLTK: lemmatization, parts of speech, sense counts, topics, families.
  - CEFR-J Vocabulary Profile 1.5 (free for research and commercial use, Tono Laboratory)
    and the Octanove C1/C2 profile (CC BY-SA 4.0): CEFR correction signal.
  - LDNOOBW English list (CC BY 4.0): obscene terms and slurs to exclude.

The script never prints words, only counts. Lemma ids are stable: ids already present in
content/lemmas.json are preserved and new lemmas get ids above the current maximum,
so user data keyed by lemma id survives every rebuild.

Run: scripts/.cache/venv/bin/python -I scripts/build_lemmas.py
"""

from __future__ import annotations

import csv
import json
import math
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
OUT = ROOT / "content" / "lemmas.json"
os.environ.setdefault("NLTK_DATA", str(CACHE / "nltk_data"))

import wordfreq  # noqa: E402
from nltk.corpus import wordnet as wn  # noqa: E402
from nltk.corpus import words as nltk_words  # noqa: E402
from nltk.tag import pos_tag  # noqa: E402

PTB_POS = {
    "NN": "noun", "NNS": "noun", "VB": "verb", "VBD": "verb", "VBG": "verb", "VBN": "verb",
    "VBP": "verb", "VBZ": "verb", "JJ": "adj", "JJR": "adj", "JJS": "adj", "RB": "adv",
    "RBR": "adv", "RBS": "adv", "WRB": "adv", "IN": "prep", "CC": "conj", "DT": "det",
    "WDT": "det", "PRP": "pron", "WP": "pron", "MD": "aux", "UH": "interj", "CD": "num",
}

TARGET = 62000  # lemmas to keep (spec floor: 50,000)
SCAN = 320000  # surface forms to scan from wordfreq

# ---------------------------------------------------------------------------
# Difficulty model: must stay identical to src/engine/difficulty.ts
# ---------------------------------------------------------------------------
ANCHORS = [(1, 0), (100, 5), (1000, 25), (5000, 50), (20000, 75), (50000, 90), (150000, 100)]
CEFR_CENTER = {"A1": 8, "A2": 22, "B1": 38, "B2": 55, "C1": 72, "C2": 88}


def clamp(x: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, x))


def rank_to_difficulty(rank: int) -> float:
    r = max(1, rank)
    if r <= ANCHORS[0][0]:
        return ANCHORS[0][1]
    if r >= ANCHORS[-1][0]:
        return ANCHORS[-1][1]
    lr = math.log10(r)
    for i in range(1, len(ANCHORS)):
        r1, d1 = ANCHORS[i]
        if r <= r1:
            r0, d0 = ANCHORS[i - 1]
            t = (lr - math.log10(r0)) / (math.log10(r1) - math.log10(r0))
            return d0 + t * (d1 - d0)
    return ANCHORS[-1][1]


def compute_difficulty(rank, cefr, length, senses, irregular, abstract) -> float:
    base = rank_to_difficulty(rank)
    cefr_part = CEFR_CENTER[cefr] if cefr else base
    minor = base
    minor += clamp((length - 7) * 0.6, -3, 4)
    if senses is not None:
        minor += -2 if senses >= 6 else (2 if senses <= 1 else 0)
    if irregular:
        minor += 1.5
    if abstract:
        minor += 2
    d = 0.7 * base + 0.2 * cefr_part + 0.1 * minor
    # Match JS Math.round(x * 10) / 10 (round half up) rather than Python banker's rounding.
    return math.floor(clamp(d, 0, 100) * 10 + 0.5) / 10


def band_of(d: float) -> str:
    for limit, band in ((15, "A1"), (30, "A2"), (45, "B1"), (62, "B2"), (80, "C1"), (92, "C2")):
        if d < limit:
            return band
    return "C2+"


# ---------------------------------------------------------------------------
# Closed-class words that WordNet does not cover
# ---------------------------------------------------------------------------
FUNCTION_POS = {
    "det": "the a an this that these those each every either neither some any no all both "
    "another such what which whose much many few several enough",
    "pron": "i you he she it we they me him her us them my your his its our their mine yours "
    "hers ours theirs myself yourself himself herself itself ourselves yourselves themselves "
    "who whom whoever whatever whichever someone somebody something anyone anybody anything "
    "everyone everybody everything nobody nothing none oneself",
    "prep": "of in to for with on at by from up about into over after beneath under above "
    "across against along among around before behind below beside besides between beyond "
    "during except inside near off onto outside past since through throughout toward towards "
    "upon within without via despite unlike underneath amid amidst per versus",
    "conj": "and or but if because although though while whereas unless until whether nor "
    "so yet once lest",
    "aux": "be have do will would shall should can could may might must ought",
    "adv": "not also very too just then there here now only even still ever never always "
    "often already soon again almost quite rather perhaps maybe else however therefore "
    "thus hence indeed anyway somewhat",
    "interj": "yes no oh hello hi okay ok wow hey ouch oops bye goodbye please thanks",
}
FUNCTION_WORDS: dict[str, list[str]] = defaultdict(list)
for _pos, _ws in FUNCTION_POS.items():
    for _w in _ws.split():
        FUNCTION_WORDS[_w].append(_pos)

WN_POS = {"n": "noun", "v": "verb", "a": "adj", "s": "adj", "r": "adv"}

ABSTRACT_LEX = {
    "noun.attribute", "noun.cognition", "noun.state", "noun.feeling", "noun.motive",
    "noun.relation", "noun.communication", "noun.act", "noun.event", "noun.process",
}

# Topic classification from WordNet lexicographer files and hypernym anchors.
LEX_TOPICS = {
    "noun.food": "food", "verb.consumption": "food",
    "noun.feeling": "emotions", "verb.emotion": "emotions",
    "noun.animal": "nature", "noun.plant": "nature", "verb.weather": "nature",
    "noun.body": "health", "verb.body": "health",
}
HYPERNYM_TOPICS = {
    "relative.n.01": "family", "family.n.01": "family", "kin.n.01": "family",
    "marriage.n.01": "family", "child.n.01": "family",
    "occupation.n.01": "work", "job.n.01": "work", "worker.n.01": "work",
    "business.n.01": "work", "employee.n.01": "work", "professional.n.01": "work",
    "workplace.n.01": "work",
    "travel.n.01": "travel", "journey.n.01": "travel", "vehicle.n.01": "travel",
    "hotel.n.01": "travel", "airport.n.01": "travel", "tourist.n.01": "travel",
    "baggage.n.01": "travel", "road.n.01": "travel", "transport.n.01": "travel",
    "food.n.01": "food", "food.n.02": "food", "beverage.n.01": "food", "dish.n.02": "food",
    "meal.n.01": "food", "cooking.n.01": "food",
    "computer.n.01": "tech", "software.n.01": "tech", "electronic_equipment.n.01": "tech",
    "telecommunication.n.01": "tech", "machine.n.01": "tech", "device.n.01": "tech",
    "emotion.n.01": "emotions", "feeling.n.01": "emotions",
    "disease.n.01": "health", "illness.n.01": "health", "medicine.n.02": "health",
    "drug.n.01": "health", "body_part.n.01": "health", "symptom.n.01": "health",
    "medical_care.n.01": "health", "health_professional.n.01": "health",
    "plant.n.02": "nature", "animal.n.01": "nature",
    "geological_formation.n.01": "nature", "weather.n.01": "nature", "body_of_water.n.01": "nature",
    "law.n.01": "law", "legal_document.n.01": "law", "crime.n.01": "law", "court.n.01": "law",
    "lawyer.n.01": "law", "legal_action.n.01": "law", "criminal.n.01": "law",
    "money.n.01": "finance", "financial_gain.n.01": "finance", "monetary_unit.n.01": "finance",
    "fund.n.01": "finance", "payment.n.01": "finance", "bank.n.01": "finance",
    "financial_institution.n.01": "finance", "debt.n.01": "finance", "tax.n.01": "finance",
    "investment.n.01": "finance", "market.n.01": "finance", "price.n.02": "finance",
}
DOMAIN_TOPICS = {
    "law.n.01": "law", "jurisprudence.n.01": "law",
    "finance.n.01": "finance", "economics.n.01": "finance", "banking.n.01": "finance",
    "commerce.n.01": "finance",
    "computer_science.n.01": "tech", "computer.n.01": "tech", "electronics.n.01": "tech",
    "medicine.n.01": "health", "pathology.n.02": "health",
    "biology.n.01": "academic", "chemistry.n.01": "academic", "physics.n.01": "academic",
    "mathematics.n.01": "academic", "linguistics.n.01": "academic", "philosophy.n.01": "academic",
    "psychology.n.01": "academic", "sociology.n.01": "academic", "statistics.n.01": "academic",
    "geology.n.01": "academic", "astronomy.n.01": "academic", "logic.n.01": "academic",
    "cooking.n.01": "food", "culinary_art.n.01": "food",
}
SLANG_DOMAINS = {"slang.n.02", "colloquialism.n.01"}


def load_cefr() -> dict[str, str]:
    order = ["A1", "A2", "B1", "B2", "C1", "C2"]
    out: dict[str, str] = {}
    files = [
        CACHE / "cefr" / "cefrj-vocabulary-profile-1.5.csv",
        CACHE / "cefr" / "octanove-vocabulary-profile-c1c2-1.0.csv",
    ]
    for f in files:
        if not f.exists():
            sys.exit(f"missing {f}; run scripts/fetch-data.sh")
        with f.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                for head in row["headword"].split("/"):
                    h = head.strip().lower()
                    lvl = row["CEFR"].strip().upper()
                    if not h or lvl not in order:
                        continue
                    if h not in out or order.index(lvl) < order.index(out[h]):
                        out[h] = lvl
    return out


def load_blocklist() -> set[str]:
    f = CACHE / "blocklist" / "en.txt"
    if not f.exists():
        sys.exit(f"missing {f}; run scripts/fetch-data.sh")
    return {
        line.strip().lower()
        for line in f.read_text(encoding="utf-8").splitlines()
        if line.strip() and " " not in line.strip()
    }


WORD_RE = re.compile(r"^[a-z]+(?:-[a-z]+)?$")
VOWEL_RE = re.compile(r"[aeiouy]")


def lowercase_lemma_pos(w: str) -> list[str]:
    """WordNet POS codes where `w` is a genuine lowercase lemma (not a proper noun)."""
    out = []
    for s in wn.synsets(w):
        for lem in s.lemmas():
            if lem.name() == w and s.pos() not in out:
                out.append(s.pos())
    return out


def main() -> None:
    cefr = load_cefr()
    blocked = load_blocklist()
    english = {w for w in nltk_words.words() if w.islower()}
    verb_exc_bases = set()
    for forms in wn._exception_map["v"].values():  # type: ignore[attr-defined]
        verb_exc_bases.update(forms)

    surface = wordfreq.top_n_list("en", SCAN)
    freq: dict[str, float] = defaultdict(float)
    stats = defaultdict(int)

    for w in surface:
        if not WORD_RE.match(w) or len(w) < 2 or not VOWEL_RE.search(w):
            stats["junk"] += 1
            continue
        if w in blocked:
            stats["blocked"] += 1
            continue
        f = wordfreq.word_frequency(w, "en")
        own = lowercase_lemma_pos(w.replace("-", "_"))
        if w in FUNCTION_WORDS:
            freq[w] += f
            continue
        # Inflected forms: credit the base form(s).
        bases: list[str] = []
        for p in ("v", "n", "a", "r"):
            b = wn.morphy(w, p)
            if b and b != w and "_" not in b and b not in bases:
                bases.append(b)
        if w in ("is", "are", "was", "were", "been", "being", "am"):
            bases = ["be"]
        if bases:
            keep_own = False
            if own:
                # Keep forms that are real headwords of their own: adjectives ("tired"),
                # nouns with several senses ("building", "meeting") and lexicalized plurals.
                if "a" in own or "s" in own:
                    keep_own = True
                elif "n" in own and len(wn.synsets(w, "n")) >= 2 and not w.endswith("s"):
                    keep_own = True
                elif "n" in own and w.endswith("s") and wn.morphy(w, "n") == w:
                    keep_own = True
            for b in bases[:1]:
                freq[b] += f
            if keep_own:
                freq[w] += f * 0.5
            stats["inflection"] += 1
            continue
        if own:
            freq[w] += f
            continue
        if w in english and len(w) > 2:
            freq[w] += f
            stats["nonwordnet_kept"] += 1
            continue
        stats["unknown"] += 1

    # Drop lemmas that are only proper nouns or not words at all once aggregated.
    candidates = []
    for lem, f in freq.items():
        if lem in blocked:
            continue
        if lem in FUNCTION_WORDS or lowercase_lemma_pos(lem.replace("-", "_")) or lem in english:
            candidates.append((lem, f))
    candidates.sort(key=lambda x: (-x[1], x[0]))
    candidates = candidates[:TARGET]

    # Stable ids.
    prev_ids: dict[str, int] = {}
    if OUT.exists():
        for e in json.loads(OUT.read_text(encoding="utf-8")):
            prev_ids[e["lemma"]] = e["id"]
    next_id = max(prev_ids.values(), default=0) + 1

    entries = []
    lemma_set = {lem for lem, _ in candidates}
    for rank, (lem, _f) in enumerate(candidates, start=1):
        key = lem.replace("-", "_")
        syns = wn.synsets(key)
        own_syns = [s for s in syns if any(l.name() == key for l in s.lemmas())]
        # POS ordered by usage count.
        pos_score: dict[str, float] = defaultdict(float)
        for s in own_syns:
            cnt = sum(l.count() for l in s.lemmas() if l.name() == key)
            pos_score[WN_POS[s.pos()]] += 1 + cnt
        pos = [p for p, _ in sorted(pos_score.items(), key=lambda x: -x[1])]
        for fp in FUNCTION_WORDS.get(lem, []):
            if fp not in pos:
                pos.insert(0, fp)
        if not pos:
            pos = [PTB_POS.get(pos_tag([lem])[0][1], "other")]
        senses = len(own_syns) if own_syns else None
        lex = [s.lexname() for s in own_syns]
        abstract = bool(lex) and lex[0] in ABSTRACT_LEX
        irregular = lem in verb_exc_bases
        level = cefr.get(lem)
        d = compute_difficulty(rank, level, len(lem), senses, irregular, abstract)

        tags: set[str] = set()
        # Topics come from the dominant sense only, so rare senses do not mislabel common words.
        primary = [s for s in own_syns if pos and WN_POS[s.pos()] == pos[0]] or own_syns
        for s in primary[:1]:
            if s.lexname() in LEX_TOPICS:
                tags.add(LEX_TOPICS[s.lexname()])
            for dom in s.topic_domains() + s.usage_domains():
                if dom.name() in DOMAIN_TOPICS:
                    tags.add(DOMAIN_TOPICS[dom.name()])
                if dom.name() in SLANG_DOMAINS:
                    tags.add("slang")
            for path in s.hypernym_paths()[:1]:
                for h in path:
                    if h.name() in HYPERNYM_TOPICS:
                        tags.add(HYPERNYM_TOPICS[h.name()])
        if level in ("B2", "C1", "C2") and abstract and d >= 45:
            tags.add("academic")

        lid = prev_ids.get(lem)
        if lid is None:
            lid = rank if not prev_ids else next_id
            if prev_ids:
                next_id += 1
        entry = {"id": lid, "lemma": lem, "rank": rank, "pos": pos[:3], "d": d, "band": band_of(d)}
        if level:
            entry["cefr"] = level
        if tags:
            entry["tags"] = sorted(tags)
        entries.append(entry)

    # Word families: derivational links in WordNet between inventory lemmas sharing a stem.
    parent: dict[str, str] = {e["lemma"]: e["lemma"] for e in entries}
    rank_of = {e["lemma"]: e["rank"] for e in entries}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        if rank_of[ra] <= rank_of[rb]:
            parent[rb] = ra
        else:
            parent[ra] = rb

    def stem_ok(a: str, b: str) -> bool:
        n = min(len(a), len(b), 4)
        sa = a[2:] if a.startswith(("un", "in", "im", "ir", "il", "dis", "re", "non")) else a
        sb = b[2:] if b.startswith(("un", "in", "im", "ir", "il", "dis", "re", "non")) else b
        return a[:n] == b[:n] or sa[:n] == b[:n] or sb[:n] == a[:n]

    for e in entries:
        key = e["lemma"].replace("-", "_")
        for s in wn.synsets(key):
            for l in s.lemmas():
                if l.name() != key:
                    continue
                for rel in l.derivationally_related_forms() + l.pertainyms():
                    other = rel.name()
                    if other in lemma_set and other != e["lemma"] and stem_ok(e["lemma"], other):
                        union(e["lemma"], other)
        for pre in ("un", "in", "im", "ir", "il", "dis", "non"):
            if e["lemma"].startswith(pre) and e["lemma"][len(pre):] in lemma_set:
                union(e["lemma"], e["lemma"][len(pre):])

    groups: dict[str, list[str]] = defaultdict(list)
    for e in entries:
        groups[find(e["lemma"])].append(e["lemma"])
    id_of = {e["lemma"]: e["id"] for e in entries}
    by_lemma = {e["lemma"]: e for e in entries}
    families = 0
    for root_lemma, members in groups.items():
        if 2 <= len(members) <= 25:
            families += 1
            for m in members:
                by_lemma[m]["family"] = id_of[root_lemma]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as fh:
        fh.write("[\n")
        for i, e in enumerate(entries):
            fh.write(json.dumps(e, ensure_ascii=False, separators=(",", ":")))
            fh.write(",\n" if i < len(entries) - 1 else "\n")
        fh.write("]\n")

    bands = defaultdict(int)
    for e in entries:
        bands[e["band"]] += 1
    tagged = sum(1 for e in entries if e.get("tags"))
    print(f"scanned {len(surface)} surface forms; filters: {dict(stats)}")
    print(f"lemmas written: {len(entries)}; with CEFR: {sum(1 for e in entries if 'cefr' in e)}")
    print(f"families: {families}; tagged: {tagged}; bands: {dict(sorted(bands.items()))}")
    print(f"file size: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
