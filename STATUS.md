# STATUS

**Live URL:** https://rotembenzur.github.io/EnglishApp/

Last updated: 2026-10-13 · version 0.4.0

## Deployment

- Published to GitHub Pages from the default branch `claude/trusting-knuth-gbbnzv`.
- Latest deploy: 0.4.0, CI and deploy run #31 on commit `3134127` (2026-10-13), all three jobs
  green (lint/typecheck/test/build, Playwright smoke, Deploy to GitHub Pages). The Push server
  workflow run on the same commit is green and skipped deploying, as designed, until the secrets
  exist.
- Verified on the real URL from this container (now allowed): the page serves the new build, the
  settings chunk carries 0.4.0, and Chromium (iPhone 14 profile) loads it in Hebrew RTL with the
  service worker registered, the version 0.4.0 in settings and no JavaScript errors. The only
  failed requests are expected: cold deep links answer 404 through the `404.html` bounce by
  design, and the push function answers 404 until `SETUP.md` step 4 is done (the settings screen
  then says the push server is not on yet).

## Waiting on owner

1. **Push notifications: add two GitHub secrets** (`SETUP.md` steps 4a to 4c, about five minutes):
   `VAPID_PRIVATE_KEY` (given in the chat of the 2026-10-13 session) and `SUPABASE_ACCESS_TOKEN`
   (created in the Supabase dashboard), then run the **Push server** workflow once. Then on each
   iPhone: **הגדרות**, **התראות**, turn on, allow, send a test (`SETUP.md` step 4d).

Done by the owner: Pages enabled, `supabase/schema.sql` run with the passphrase, both phones
installed and syncing (reported 2026-10-13).

## Push notifications (built 2026-10-13, live once the secrets exist)

- Daily reminder at the time each user picks (copy mentions the rival's XP), 20:00 streak alert
  when a streak is alive and the goal is open, rival nudges within seconds even with the app
  closed. Per-phone switches and a test button in **הגדרות**, **התראות**.
- Server: Supabase Edge Function `lexbites-push` + `supabase/push.sql` (pg_cron every 5 minutes,
  nudge trigger), deployed by `.github/workflows/push-server.yml`. Until the secrets exist the
  workflow ends green with a notice and the settings section says the server is not on yet.
- Verified here (2026-10-13): the real function under Deno 2.9 against Postgres 16 + PostgREST 12
  with `schema.sql` and `push.sql` applied (pg_net and pg_cron replaced by recording stand-ins),
  and a push service stand-in that verifies every VAPID token and decrypts every message: 29 of 29
  checks (reminder with rival copy, no duplicates, dead subscriptions removed, server state kept
  when a phone refreshes, nudge trigger fires once per nudge and never for other events, nudges
  off, old nudges skipped, test push, wrong passphrase sees nothing, delete needs the passphrase,
  keepalive). Browser test: the production build enables push, saves choices, sends a test
  notification through the function and turns off again, zero console errors.
- Not verifiable from here: delivery through Apple's push service (`web.push.apple.com` is blocked
  in this container) and the deploy itself (needs the owner's secrets). The QA list below has the
  phone checks.

## Supabase keepalive

`.github/workflows/keepalive.yml` every 2 days, no secret: a write through `rpc/lb_keepalive`
(after `push.sql` or a re-run of `schema.sql` installs it), a table read and `rpc/lb_authorized`.
It also re-enables the scheduled workflows so GitHub's 60-day rule cannot switch them off. Until
`lb_keepalive` exists the reads alone keep the project active.

## Network check from this container (2026-10-13)

- https://rotembenzur.github.io/EnglishApp/ answers 200 (page, manifest, `sw.js`, `sw-push.js`).
- Supabase project: REST answers; every table returns `[]` without the passphrase, writes are
  refused (401), `lb_config` is unreadable, `lb_set_passphrase` is not callable, CORS allows the
  `x-lexbites-key` header, the push function is not deployed yet (404, expected).
- `api.dictionaryapi.dev` answers 200. `translate.googleapis.com` is reachable (it answers 429 to
  this container's address; phones are not affected).
- Still blocked here: `api.mymemory.translated.net` (the first translation source),
  `api.supabase.com` (Management API, used only by the deploy workflow on GitHub's runners) and
  push services such as `web.push.apple.com`.

## Sync backend (connected 2026-10-13)

- Supabase project `ngosxhpmudbgiiktqgoa`; `supabase/schema.sql` was run by the owner with the
  shared passphrase. The project URL and anon key are built into the app (`src/sync/config.ts`);
  the passphrase is not in the repository. Each phone types it once in **הגדרות**, **סנכרון**.
- Reachable from the build container since 2026-10-13 (see the network check above).
- Verified instead against a real backend with the same stack: Postgres 16 with Supabase's roles
  and default grants, `supabase/schema.sql` applied (and re-applied), PostgREST 12. Results:
  - RLS: a wrong passphrase hash reads nothing and every write is refused (401); `lb_config` is
    never readable and `lb_set_passphrase` cannot be called through the API; CORS preflight
    allows the `x-lexbites-key` header.
  - Last-write-wins trigger keeps the newer row when an older write arrives.
  - Two-phone e2e (`e2e/sync.spec.ts`, two iPhone 14 browser contexts, the production build with
    the built-in URL and key, requests forwarded to the local PostgREST): rotem practices offline,
    a wrong passphrase is refused with its own message, the right one connects and uploads the
    history; rotem plays the daily duel and nudges; noa installs fresh, connects, gets the nudge
    toast, the home rival card shows "רתם כבר התאמן היום", the weekly league shows rotem's XP, and
    noa holds exactly rotem's XP, duel and nudge rows; noa plays the same duel and sees the result;
    rotem reopens and gets noa's nudge, duel result and XP. Zero console errors.
- Fixed while connecting: a push committing while the other phone pulled could be skipped for
  good (lost duel results or nudges); pulls now re-read a two-minute overlap. The first connect
  uploads all offline history in one run. Connecting tells a wrong passphrase from no network.

## Sync: what to test on the phones

Both phones on 0.3.1 or later (bottom of **הגדרות**), both connected per `SETUP.md` step 3. The
owner reported sync working on both phones on 2026-10-13.

1. Phone A (רתם): connect. Expect the **מחובר** toast, **מסונכרן** next to **סנכרון**, a green dot
   on home. A wrong passphrase must show **הסיסמה לא מתאימה**.
2. Phone B (נועה): connect the same way. Within a few seconds the rival card on home shows רתם's
   words, XP and streak for today, and "נראה לאחרונה".
3. Phone A: play the daily duel (**יריבות**, **דו־קרב יומי**, **לשחק**). It then says
   **מחכים לתוצאה של הצד השני**. Tap 👋 under **נקירות**.
4. Phone B: close and reopen LexBites. Expect the toast **רתם שלח לך 👋**. On **יריבות**, the weekly
   league shows the same XP for רתם as phone A shows for itself.
5. Phone B: play the duel. Both phones then show the result (win, loss or draw) after reopening.
6. Phone B: tap 🔥. Phone A gets **נועה שלחה לך 🔥** on next open.
7. Phone A: turn on airplane mode, do a few answers, turn it off. The dot is grey while offline
   and green again a few seconds after reconnecting; phone B sees the new XP after reopening.

## Live now

- Profile picker (רתם / נועה) with optional PIN, remembered per device.
- Placement test: adaptive, about 25 words with meaning checks, level reveal.
- Learning sessions with all 9 exercise types, review-only, hard words, speed round, listening
  mode, weekly boss, daily duel. Progress saved per answer, sessions resume after interruption.
- Home: daily ring, streak with freezes, rival card, mode buttons, cap suggestions, word of the day,
  backup reminder when sync is off.
- Word detail, library with search and filters, stats (level over time, retention, heatmap,
  forecast, accuracy by type, badges), rivalry (weekly league, head to head, duel, nudges).
- Settings: goal, new words per day, retention, topics, item kinds, accent, voice, speed, sounds,
  theme, large text, PIN, retake placement, FSRS tuning, sync, export, import, rebuild, reset.
- Content: 62,000-lemma inventory, Tier A authored words (see below), 300 phrasal verbs, 300
  idioms, 200 collocations, placement bank, Tier B runtime enrichment with background prefetch.
- Read mode with word import, confusable pairs.
- Push notifications and the Supabase keepalive (see above).
- Quality gates: Lighthouse mobile performance 95, accessibility 100, best practices 100; 132 unit tests (engine, sync, export/import, content), Playwright e2e (first run, all tabs, offline,
  resume, two-phone sync), zero console errors, app shell about 190 KB gzipped.

## Content progress

- Tier A: 6,000 words fully authored (30 shards, all validated in CI). 176 inventory entries
  that turned out to be names, inflected forms or spelling variants are excluded from teaching.
- Curated: 300 phrasal verbs, 300 idioms, 200 collocations, 120 confusable pairs, 363-word
  placement bank.

## Next

- Tier A content pass to 10,000 words (`pnpm enrich --from 6001 --to 10000`).
- Inventory cleanup pass (backlog B-005).
- Real-device QA (audio in standalone mode, push notifications).

## QA checklist

Run from `docs/QA_CHECKLIST.md`. Items verifiable without a phone are verified in a headless
iPhone 14 profile; items that need a real iPhone stay open until checked on the device.

- [ ] Installs on iPhone from Safari and opens full screen (URL is live; needs a check on a real iPhone)
- [x] Works offline after first load: service worker precaches the shell and all content (2026-10-12, e2e offline test; 2026-10-13, Pages-like build)
- [ ] Audio plays in standalone mode (needs a real iPhone)
- [x] RTL layout and bidi strings look right (2026-10-12, screenshots in `docs/screenshots/`)
- [x] Dark and light mode (2026-10-12, screenshots)
- [x] Two profiles on two phones (owner report, 2026-10-13)
- [x] Sync, rival card, league, duel, nudges: two-phone e2e against PostgREST with the real schema (2026-10-13)
- [x] Sync against the hosted Supabase project on both phones (owner report, 2026-10-13)
- [x] Push server end to end against PostgREST with the real schema, real function under Deno (2026-10-13)
- [ ] Push notifications on both iPhones (after `SETUP.md` step 4; QA list, push section)
- [x] Export and import round trip (2026-10-12, unit test)
