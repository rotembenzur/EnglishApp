# Architecture

## Folders

```
src/
  app/          App root, router
  engine/       Pure learning engine (difficulty, ability, selection, SRS, sessions). No UI, no IO.
  content/      Content loaders: lemma inventory, Tier A shards, Tier B runtime enrichment
  data/         Dexie database, repositories, migrations, export/import
  state/        Zustand stores (theme, profile, session UI state)
  sync/         Local-first sync layer (outbox, Supabase REST client, presence)
  audio/        Pronunciation: dictionary audio with service-worker cache, speechSynthesis fallback
  gamification/ XP, levels, streaks, badges
  ui/           Reusable components (shell, tab bar, cards, buttons, toasts)
  screens/      One file per screen (see docs/SCREENS.md)
  i18n/         Hebrew strings (he.ts); no UI text lives in components
  pwa/          Service worker registration and update flow
content/        Authoring source: lemmas.json, schema.json, shards/, curated/, families.json
public/content/ Generated runtime content (ignored in git, built by scripts/build-content.ts)
scripts/        Build and maintenance scripts (content pipeline, icons, enrich, reports, screenshots)
supabase/       schema.sql for the optional sync backend
docs/           Decisions, screens, voice, QA checklist, backlog
```

## Data flow

1. The app reads everything from IndexedDB (Dexie). Static content loads from `public/content/`
   and is precached by the service worker, so the first load pulls it once and it stays available offline.
2. Every graded answer appends a `reviews` row (the source of truth), updates the `userWords` row
   through the engine (FSRS card + crowns + leech flags), updates `dailyStats`, and nudges the user's
   ability `theta`.
3. Writes also land in an outbox. When a sync backend is configured and the device is online, the
   outbox pushes rows to Supabase and the app pulls the other user's rows (daily stats, presence,
   events) on open, on focus, every 60 seconds while open and after each session.

## Engine

The engine is a set of pure functions. It takes plain data in and returns plain data out, so every
rule in the spec has a unit test. Key modules (Phase 2): `difficulty`, `ability` (placement and
Elo-style updates), `selection` (new-word window and sampling), `srs` (FSRS wrapper and behavior
derived ratings), `session` (composer and exercise mix), `exercises` (distractors, typing tolerance).

## Content pipeline

- `scripts/build_lemmas.py` builds `content/lemmas.json` (50k+ lemmas with rank, POS, difficulty,
  band, tags, family) from open frequency data and WordNet.
- Tier A shards (`content/shards/NNNN.json`, 200 lemmas each) are authored in frequency order and
  validated by `scripts/validate-content.ts` against `content/schema.json` in CI.
- `scripts/build-content.ts` packs the inventory and shards into `public/content/` at build time.
- Tier B enrichment happens at runtime from free dictionary and translation endpoints and is cached
  locally.

## Sync

Local-first. Append-only tables (`reviews`, `events`) merge by union. Row tables (`userWords`,
`dailyStats`) use last-write-wins by `updatedAt`, and the review log can always rebuild them.
See `SETUP.md` for the backend steps.

## Deployment

GitHub Actions on every push: lint, typecheck, content validation, unit tests, production build with
`VITE_BASE=/EnglishApp/`, then deploy to GitHub Pages from the repository default branch.
