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
  audio/        Pronunciation: recordings (packs, sentence clips, offline cache), dictionary audio,
                system voice ranking and speechSynthesis fallback
  gamification/ XP, levels, streaks, badges
  ui/           Reusable components (shell, tab bar, cards, buttons, toasts)
  screens/      One file per screen (see docs/SCREENS.md)
  i18n/         Hebrew strings (he.ts); no UI text lives in components
  pwa/          Service worker registration and update flow
content/        Authoring source: lemmas.json, schema.json, shards/, curated/, families.json
public/content/ Generated runtime content (ignored in git, built by scripts/build-content.ts)
scripts/        Build and maintenance scripts (content pipeline, icons, enrich, reports, screenshots)
supabase/       schema.sql (sync backend), push.sql and functions/ (push server), config.toml
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
4. One-time data migrations (`src/data/migrations.ts`) run at app start, before the profile
   loads. Each one changes local rows, queues them in the outbox and records itself per phone
   (`kv`) and per profile (`profile.migrations`, synced), so it never runs twice and never
   undoes a later manual change. First one: the daily goal moved to 1000 XP (0.7.0).

## Engine

Pure functions in `src/engine/` (no IO, no DOM, the caller passes `now`), each with unit tests:

- `difficulty`: rank, CEFR and minor signals to `d` (0..100) and bands. Mirrors `scripts/build_lemmas.py`.
- `ability`: Bayesian placement (grid posterior, adaptive item difficulty, meaning checks that
  lower trust in self-report), Elo-like updates with a K schedule, per-answer weights and a daily
  movement budget.
- `selection`: the i+1 window, gaussian sampling around theta + 5, Tier A boost, topic share,
  family ordering, daily cap and cap suggestions, assumed-known probes.
- `srs`: ts-fsrs wrapper, behavior-derived ratings from per-user speed percentiles, crowns, leeches.
- `optimizer`: on-device FSRS personalization (coordinate descent on log loss).
- `session`: composer for learn, review, hard, listening, speed, boss and duel sessions. Short
  queues are filled (due, early reviews by retrievability, hard pool, today's words, repeats) so a
  session keeps its normal length; optional modes have a minimum pool (`MODE_MIN`).
- `exercises`: distractors, typing tolerance (Levenshtein, US/UK spellings), spelling diff, cloze
  blanking with inflections, match boards.
- `learn`: the single answer transition (word, behavior) to (word, review row, ability, XP), plus
  ignore/unignore and rebuild-from-log.
- `game`: XP, combos, levels, streaks with freezes, 40 badges. `stats`: recall after a gap, league,
  head to head, duel seeding, forecasts.

## Session runtime

`src/session/build.ts` turns the engine plan into a ready session: selection, probe, content for
every item (local first, online enrichment within a 4 second budget), distractor pool.
`src/session/runner.ts` is the live state machine: each answer is written in one IndexedDB
transaction (word row, review row, profile) and the plan position is persisted for resume.
`src/session/prefetch.ts` enriches upcoming words while the app is idle.

## Content pipeline

- `scripts/fetch-data.sh` downloads the open sources into `scripts/.cache/` (git-ignored).
- `scripts/build_lemmas.py` builds `content/lemmas.json`: 62,000 lemmas with rank, POS, `d`, band,
  CEFR, topics and families. Ids are stable across rebuilds.
- Tier A shards (`content/shards/NNNN.json`, 200 lemmas each, shard N = ranks N*200+1..N*200+200)
  are authored through `pnpm enrich` and validated by `scripts/validate-content.ts` and
  `scripts/content.test.ts` in CI.
- `content/curated/*.json`: phrasal verbs, idioms, collocations (ids from 1,000,000).
- `content/placement.json`: the placement bank with checked Hebrew meanings.
- `scripts/build-content.ts` packs everything into `public/content/` at build time; the service
  worker precaches it.
- Tier B enrichment happens at runtime (`src/content/enrich.ts`: dictionaryapi.dev, MyMemory,
  Google gtx fallback) and is cached in IndexedDB and the service worker. A word without Hebrew and
  two real example sentences is never shown.
- Audio follows content: a push of new or edited shards or curated lists to the default branch
  renders their recordings (see Audio below). `pnpm audio:plan` shows locally what would render.

## Audio

Recordings are rendered at build time, not by the phone (details and reasons: `docs/DECISIONS.md`,
recorded audio).

- `scripts/audio/plan.ts` lists every clip: words and curated items in two voices (Kokoro
  `af_heart`, `bf_emma`), normal and slow; example sentences in the American voice. Each clip has
  a generation hash; clips already in the store are skipped.
- `.github/workflows/audio.yml` renders the rest in 18 parallel jobs with
  `scripts/audio/generate.py` (Kokoro ONNX, misaki G2P, IPA fallback from `phonemes.py`, silence
  and loudness checks, Whisper checks, AAC encoding), then `assemble.ts` builds word packs,
  sentence tars, indexes, `store.json` and a quality report, publishes them to the `audio-store`
  release and starts a deploy. `scripts/audio/place.sh` lays them into `dist/audio/` during the
  deploy.
- In the app, `src/audio/recordings.ts` reads `audio/index.json`, keeps the word packs of the
  chosen accent in Cache Storage, caches and prefetches sentence clips, and returns Blobs;
  `speech.ts` plays them through Web Audio, then generated clips (below), then dictionary audio and
  the system voice (`voices.ts` ranks those). Clips are found by `clipKey(text)` (`key.ts`).

### Text audio (0.10.0)

Saved texts get the same voices for everything that has no recording.

- `src/audio/textAudio.ts` lists a text's units (sentences without a recording, then words without
  one, in the accent's voice), adds a job to `lb_tts_jobs` with the sync passphrase hash and calls
  the `lexbites-tts` Edge Function, which dispatches `.github/workflows/tts.yml` when it has its
  GitHub token (otherwise the workflow's five-minute schedule finds the job).
- `scripts/tts/render.py` (on the runner) renders with `scripts/audio/generate.py`'s voices, G2P,
  loudness and checks, uploads base64 m4a clips to `lb_tts_clips` four at a time and updates the
  job's progress. It prints counts only: the logs are public, the texts are not.
- A background watcher on the phone polls every 5 seconds while a job is open (any screen, resumed
  at app start), downloads new clips into Cache Storage (`generated.ts`) and marks clips still on
  their way as pending (`pending.ts`), so speaker buttons show "preparing" instead of using the
  system voice.

## Sync

Local-first (`src/sync/engine.ts`). Every write goes to IndexedDB and an outbox. `syncNow()` pushes
the outbox as upserts and pulls each table incrementally by the server's `server_at`. Row tables
(`users`, `userWords`, `dailyStats`, `presence`) are last-write-wins by `updatedAt`, enforced on the
server by a trigger; `reviews` and `events` are append-only unions. Pulls run on open, on focus,
every 60 seconds and after each session. Each pull starts two minutes behind the stored cursor,
because a row is stamped before its transaction commits and could otherwise be skipped when both
phones push at once. Access is gated by RLS on an `x-lexbites-key` header (sha256 of the shared
passphrase). The project URL and anon key are built in (`src/sync/config.ts`, values in
`supabase/functions/_shared/keys.ts`); a phone stores only
the passphrase hash. Schema: `supabase/schema.sql`. Steps: `SETUP.md`. The two-phone e2e test
(`e2e/sync.spec.ts`) runs against a local PostgREST with the same schema.

## Push

Web push (spec 9.6), live once the owner adds two GitHub secrets (`SETUP.md` step 4).

- Phone: `src/sync/push.ts` subscribes with the VAPID public key (`supabase/functions/_shared/keys.ts`)
  and upserts its subscription and choices (daily reminder time or off, streak alert, nudges, IANA
  time zone) into `lb_push.data`. It refreshes the row on every app open (endpoints can rotate, the
  time zone can change). The settings section shows a reason instead of the switch until sync is
  connected, the app runs from the home screen, and the server reports ready.
- Server: the Edge Function `supabase/functions/lexbites-push` (Deno, no dependencies). Web Push
  encryption (RFC 8291) and VAPID (RFC 8292) are implemented with WebCrypto in
  `_shared/webpush.ts`; the rules for what to send are pure functions in `_shared/schedule.ts`.
  It reads and writes through PostgREST with the anon key and the passphrase hash from the caller,
  so RLS limits it exactly like a phone. Its send state lives in `lb_push.state`, a column the
  phones never write.
- Triggers (`supabase/push.sql`): pg_cron calls the function every 5 minutes (`{"kind":"tick"}`:
  daily reminders, the 20:00 streak alert); an `AFTER INSERT` trigger on `lb_events` calls it for
  every new nudge through pg_net, so nudges arrive within seconds. Both read the hash from
  `lb_config`, which the API can never read.
- Deploy: `.github/workflows/push-server.yml` (secrets `VAPID_PRIVATE_KEY`,
  `SUPABASE_ACCESS_TOKEN`) checks the key pair, deploys the function, sets its secret, runs
  `push.sql` through the Management API and smoke-tests the function.
- Service worker: imports `public/sw-push.js` (shows every push, opens the right screen on tap).
- Tests: `scripts/webpush.test.ts` (crypto against http_ece and node:crypto),
  `src/sync/push-server.test.ts` (scheduling rules), `e2e/sync.spec.ts` push test (real function
  under Deno, local PostgREST, a push service stand-in that decrypts every message).

## Keepalive

`.github/workflows/keepalive.yml` runs every 2 days: `rpc/lb_keepalive` (a write that only stamps
`lb_config.keepalive_at`, callable without the passphrase), a table read and `rpc/lb_authorized`.
It needs no secret. It also re-enables the scheduled workflows, which GitHub turns off in public
repositories after 60 days without commits.

## Deployment

GitHub Actions on every push: lint, typecheck, content validation, unit tests, production build with
`VITE_BASE=/EnglishApp/`, Playwright smoke, then deploy to GitHub Pages from the repository default
branch.
