# STATUS

**Live URL:** https://rotembenzur.github.io/EnglishApp/

Last updated: 2026-10-13 · version 0.3.1

## Deployment

- Published to GitHub Pages from the default branch `claude/trusting-knuth-gbbnzv`.
- Latest deploy: CI and deploy run #25 on commit `4ad8c02` (2026-10-13), all three jobs green
  (lint/typecheck/test/build, Playwright smoke, Deploy to GitHub Pages); GitHub reports the
  `github-pages` deployment as successful at https://rotembenzur.github.io/EnglishApp/.
- Runs #23 and #24 failed in the Playwright job: with the dictionary APIs reachable on GitHub's
  runners, building a learning session took about 18 s (probe and plan-content lookups each waited
  online), and the test raced the loading skeleton. Fixed in `4ad8c02`: sessions now start in about
  3 s online, e2e blocks third-party APIs by default, and a new `[online]` test with slow mocked
  APIs guards the start time.
- How the deploy was verified: this build container's network policy blocks `*.github.io` and the
  artifact storage host, so the live URL could not be opened from here. Instead, the same commit
  was rebuilt with the CI command and served under `/EnglishApp/` by a GitHub Pages stand-in (real
  404s from `404.html`), with Chromium mapped to `rotembenzur.github.io`. Result: page loads in
  Hebrew RTL, manifest scope and start URL `/EnglishApp/`, icons and service worker served, all
  content loads (30 shards, 3 curated lists), deep links work warm and cold, zero errors.
  Opening the real URL on a phone is the remaining check (QA list below).

## Waiting on owner

1. **Type the shared passphrase on both phones** (`SETUP.md` step 3, one minute per phone), then
   run the phone checks in "Sync: what to test on the phones" below.
2. **Push reminders** (optional, `SETUP.md` step 4).

## Sync backend (connected 2026-10-13)

- Supabase project `ngosxhpmudbgiiktqgoa`; `supabase/schema.sql` was run by the owner with the
  shared passphrase. The project URL and anon key are built into the app (`src/sync/config.ts`);
  the passphrase is not in the repository. Each phone types it once in **הגדרות**, **סנכרון**.
- Not reachable from here: this build container's network policy refuses `*.supabase.co`
  (proxy answers 403 to CONNECT), so no request reached the real project from this session.
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

Both phones on 0.3.1 or later (bottom of **הגדרות**), both connected per `SETUP.md` step 3.

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
- Quality gates: Lighthouse mobile performance 95, accessibility 100, best practices 100; 118 unit tests (engine, sync, export/import, content), Playwright e2e (first run, all tabs, offline,
  resume, two-phone sync), zero console errors, app shell about 190 KB gzipped.

## Content progress

- Tier A: 6,000 words fully authored (30 shards, all validated in CI). 176 inventory entries
  that turned out to be names, inflected forms or spelling variants are excluded from teaching.
- Curated: 300 phrasal verbs, 300 idioms, 200 collocations, 120 confusable pairs, 363-word
  placement bank.

## Next

- Tier A content pass to 10,000 words (`pnpm enrich --from 6001 --to 10000`).
- Inventory cleanup pass (backlog B-005).
- Real-device QA (install, audio in standalone mode, two phones with sync).

## QA checklist

Run from `docs/QA_CHECKLIST.md`. Items verifiable without a phone are verified in a headless
iPhone 14 profile; items that need a real iPhone stay open until checked on the device.

- [ ] Installs on iPhone from Safari and opens full screen (URL is live; needs a check on a real iPhone)
- [x] Works offline after first load: service worker precaches the shell and all content (2026-10-12, e2e offline test; 2026-10-13, Pages-like build)
- [ ] Audio plays in standalone mode (needs a real iPhone)
- [x] RTL layout and bidi strings look right (2026-10-12, screenshots in `docs/screenshots/`)
- [x] Dark and light mode (2026-10-12, screenshots)
- [ ] Two profiles on two phones (URL is live; needs both phones)
- [x] Sync, rival card, league, duel, nudges: two-phone e2e against PostgREST with the real schema (2026-10-13)
- [ ] Sync against the hosted Supabase project on both phones (steps above)
- [x] Export and import round trip (2026-10-12, unit test)
