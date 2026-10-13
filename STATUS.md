# STATUS

**Live URL:** https://rotembenzur.github.io/EnglishApp/

Last updated: 2026-10-13 · version 0.3.0

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

1. **Sync backend** (optional, five minutes, `SETUP.md` step 3): needed for the live rivalry
   between two phones. The app is fully usable without it.
2. **Push reminders** (optional, `SETUP.md` step 4).

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
- Quality gates: Lighthouse mobile performance 95, accessibility 100, best practices 100; 113 unit tests (engine, sync, export/import, content), Playwright e2e (first run, all tabs, offline,
  resume), zero console errors, app shell about 190 KB gzipped.

## Content progress

- Tier A: 6,000 words fully authored (30 shards, all validated in CI). 176 inventory entries
  that turned out to be names, inflected forms or spelling variants are excluded from teaching.
- Curated: 300 phrasal verbs, 300 idioms, 200 collocations, 120 confusable pairs, 363-word
  placement bank.

## Next

- Tier A content pass to 10,000 words (`pnpm enrich --from 6001 --to 10000`).
- Inventory cleanup pass (backlog B-005).
- Real-device QA once the app is live (install, audio in standalone mode, two phones with sync).

## QA checklist

Run from `docs/QA_CHECKLIST.md`. Items verifiable without a phone are verified in a headless
iPhone 14 profile; items that need a real iPhone stay open until checked on the device.

- [ ] Installs on iPhone from Safari and opens full screen (URL is live; needs a check on a real iPhone)
- [x] Works offline after first load: service worker precaches the shell and all content (2026-10-12, e2e offline test; 2026-10-13, Pages-like build)
- [ ] Audio plays in standalone mode (needs a real iPhone)
- [x] RTL layout and bidi strings look right (2026-10-12, screenshots in `docs/screenshots/`)
- [x] Dark and light mode (2026-10-12, screenshots)
- [ ] Two profiles on two phones (URL is live; needs both phones)
- [x] Sync and rival card: merge rules covered by unit tests (2026-10-12); live check needs the backend
- [x] Export and import round trip (2026-10-12, unit test)
