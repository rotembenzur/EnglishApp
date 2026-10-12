# Backlog

Issues referenced from TODO comments in code and ideas not yet scheduled. Format: `B-NNN`.

- B-001: Trim Fontsource subsets (Heebo ships symbols and math subsets we do not need).
- B-002: Section 7.3 ideas to evaluate after Phase 6: synonym/antonym exercises, confusable pairs,
  weekly boss review, pronunciation self-check, word list import, read mode.
- B-003: Synonym/antonym mini-exercises for C1 words (needs authored synonym sets).
- B-004: Pronunciation self-check with SpeechRecognition where supported (feature-detect, not Safari standalone).
- B-005: Inventory cleanup pass in `scripts/build_lemmas.py`: merge leftover inflected forms into
  their base lemma, drop first names and spelling variants. Needs a rank remap for already authored
  shards (shard membership is by rank). Until then, `scripts/build-content.ts` marks entries whose
  Tier A definition reveals them as not teachable (`manifest.skip`) and selection never introduces them.
