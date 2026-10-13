# Changelog

All notable changes to LexBites. Versions follow semantic versioning.

## 0.3.1 (2026-10-13)

- Sync backend connected: the Supabase project URL and anon key are built into the app, so each
  phone only types the shared passphrase once (Settings, סנכרון). Server details stay editable under
  an advanced toggle.
- Connecting tells a wrong passphrase apart from no network.
- Fix: a push that committed while the other phone was pulling could be skipped for good (lost duel
  results or nudges). Pulls now re-read a short overlap.
- The first connect uploads all offline history in one run instead of 8,000 rows per minute.
- `supabase/schema.sql`: re-running it with `CHANGE-ME` still in place keeps the passphrase.
- New two-phone e2e test (connect, rival card, weekly league, daily duel, nudges) against a local
  PostgREST running the same schema.

## 0.3.0 (2026-10-12)

- Tier A content reaches 6,000 fully authored words (Hebrew, IPA, 3 sentences, context paragraph,
  collocations, memory hooks), plus 300 idioms, 200 collocations and 120 confusable-pair cards.
- Read mode: paste English text, see which words are new at your level, add them in one tap.
- Confusables screen and "don't confuse with" cards on word pages.
- Accessibility 100 and performance 95 on Lighthouse mobile; theme-aware accessible palette.
- Push reminders behind a flag (scheduled GitHub Actions sender), weekly on-device FSRS tuning,
  level-up celebration, audio unlocked on the first tap, background prefetch of upcoming words.
- Fixes: known-word cards no longer break the scheduler; idioms get idiom distractors; names,
  inflected forms and spelling variants are never introduced as new words.

## 0.2.0 (2026-10-12)

- Content backbone: 62,000-lemma inventory with difficulty, bands, CEFR, topics and word families;
  Tier A shard schema, validation and the `pnpm enrich` authoring pipeline; first Tier A shards;
  300 curated phrasal verbs; a 363-word placement bank; Tier B runtime enrichment.
- Learning engine: adaptive placement, slow ability updates, i+1 new word selection, FSRS with
  behavior-derived ratings, crowns, leeches, session composer, all exercise types, 102 unit tests.
- App: profile picker with PIN, placement, home with daily ring, streak and rival card, sessions
  with all 9 exercise types, summary, word detail, library, stats, rivalry (league, duel, nudges),
  settings, export/import, `/today` card, Supabase sync, share cards, sound effects.

## 0.1.0 (2026-10-12)

- Phase 0, Foundation: Vite + React + TypeScript project, Tailwind theme with per-user accents,
  Hebrew RTL app shell with bottom tab bar, PWA manifest, service worker with update toast, icons
  and iOS splash screens, CI with lint, typecheck, tests, build and GitHub Pages deploy.
