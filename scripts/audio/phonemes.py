"""
Phonemes for Kokoro (misaki notation) and helpers to compare pronunciations.

Kokoro v1.0 was trained on misaki phonemes: one letter per diphthong (A = eɪ, I = aɪ, W = aʊ,
Y = ɔɪ, O = oʊ, Q = əʊ), ʤ and ʧ as single symbols, ɹ for r, T for the American flap, and no
length marks in American English. Our authored IPA is ordinary dictionary IPA, so it is converted
here before it is fed to the model.
"""

from __future__ import annotations

import re
import unicodedata

VOWELS_US = "aeiouæɑɒɔəɚɛɜɝɪʊʌAIWYOQᵻᵊ"
STRESS = "ˈˌ"


def _first_variant(ipa: str) -> str:
    s = unicodedata.normalize("NFC", ipa).strip()
    s = s.split(",")[0].split(";")[0]
    s = s.replace("/", "").replace("[", "").replace("]", "")
    s = s.replace("̩", "").replace("̯", "").replace(".", "").replace("‿", "")
    s = s.replace("'", "ˈ").replace("ˑ", "")
    s = s.replace("(", "").replace(")", "")
    s = s.replace("ɫ", "l").replace("ɐ", "ə").replace("ɘ", "ə").replace("ʔ", "t")
    s = s.replace("g", "ɡ").replace("ɾ", "t").replace("ɹ", "r")
    s = s.replace("d͡ʒ", "ʤ").replace("t͡ʃ", "ʧ").replace("dʒ", "ʤ").replace("tʃ", "ʧ")
    return re.sub(r"\s+", " ", s).strip()


def ipa_to_misaki(ipa: str, british: bool) -> str:
    """Convert dictionary IPA (one word or a short phrase) to misaki phonemes."""
    s = _first_variant(ipa)
    if british:
        rules = [
            ("əʊ", "Q"), ("oʊ", "Q"), ("eɪ", "A"), ("aɪ", "I"), ("aʊ", "W"), ("ɔɪ", "Y"),
            ("eə", "ɛː"), ("ɛə", "ɛː"), ("ɛr", "ɛː"),
            ("ɝ", "ɜː"), ("ɚ", "ə"), ("ɜːr", "ɜː"),
            ("æ", "a"), ("e", "ɛ"), ("o", "ɒ"),
        ]
    else:
        rules = [
            ("oʊ", "O"), ("əʊ", "O"), ("eɪ", "A"), ("aɪ", "I"), ("aʊ", "W"), ("ɔɪ", "Y"),
            ("ɜːr", "ɜr"), ("ɝː", "ɜr"), ("ɝ", "ɜr"), ("ɚ", "ər"), ("ɜː", "ɜr"),
            ("iː", "i"), ("uː", "u"), ("ɑː", "ɑ"), ("ɔː", "ɔ"), ("ː", ""),
            ("ɒ", "ɑ"), ("e", "ɛ"), ("o", "O"), ("a", "ɑ"),
        ]
    for a, b in rules:
        s = s.replace(a, b)
    s = s.replace("r", "ɹ")
    if not british:
        # American flap: t between a vowel (or ɹ) and an unstressed vowel, as misaki writes it.
        s = re.sub(rf"(?<=[{VOWELS_US}ɹ])t(?=[əɪiOᵻᵊ])", "T", s)
    return s


def strip_stress(p: str) -> str:
    return re.sub(rf"[{STRESS}\s.,!?;:'\"“”—…-]", "", p)


def lev(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return max(len(a), len(b))
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def phone_distance(a: str, b: str) -> float:
    """Normalized edit distance between two phoneme strings, stress and spacing ignored."""
    x, y = strip_stress(a), strip_stress(b)
    if not x and not y:
        return 0.0
    return lev(x, y) / max(len(x), len(y))


def in_vocab(p: str, vocab: dict) -> bool:
    return all(ch in vocab for ch in p)
