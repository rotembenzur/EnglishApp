# STATUS

**Live URL:** https://rotembenzur.github.io/EnglishApp/ (goes live after step 1 of `SETUP.md`)

Last updated: 2026-10-12 · version 0.3.0

## Waiting on owner

1. **Publish the app** (two minutes, `SETUP.md` step 1): make `claude/trusting-knuth-gbbnzv` the
   default branch and set Pages source to GitHub Actions. The repository's default branch is still
   the first session's branch and Pages is off, so the deploy job is skipped. Everything else
   (lint, typecheck, tests, build, e2e) runs and passes on every push.
2. **Sync backend** (optional, five minutes, `SETUP.md` step 3): needed for the live rivalry
   between two phones. The app is fully usable without it.
3. **Push reminders** (optional, `SETUP.md` step 4).

## Live now (in the code, deploys once Pages is on)

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

- [ ] Installs on iPhone from Safari and opens full screen (needs the live URL)
- [x] Works offline after first load: service worker precaches the shell and all content (2026-10-12, build check)
- [ ] Audio plays in standalone mode (needs a real iPhone)
- [x] RTL layout and bidi strings look right (2026-10-12, screenshots in `docs/screenshots/`)
- [x] Dark and light mode (2026-10-12, screenshots)
- [ ] Two profiles on two phones (needs the live URL)
- [x] Sync and rival card: merge rules covered by unit tests (2026-10-12); live check needs the backend
- [x] Export and import round trip (2026-10-12, unit test)
