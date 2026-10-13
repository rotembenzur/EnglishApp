# Changelog

All notable changes to LexBites. Versions follow semantic versioning.

## 0.4.1 (2026-10-13)

- Push: the test notification failed every time on iPhone. The sender no longer sends the
  optional `Topic` header (the test push used `lexbites-test`, 13 characters, which is not a valid
  base64url length; Apple validates it only for real devices). The VAPID token is reused for up to
  11 hours, as Apple asks. Apple's answer (status and reason) is stored with each subscription
  and shown in the toast when a test fails, and the test repairs what a phone can repair: a
  missing subscription row is stored again, a subscription Apple rejects is replaced, once each.
  A 404 `BadPath` no longer deletes the subscription.
- Push server self-test (`?probe=1`): the encryption round trip inside Supabase's runtime and
  Apple's verdict on our token, checked after every deploy.
- Toasts never stack: a repeated message or a new error replaces the one on screen, feedback to a
  tap shows at once, and a rival's nudge it interrupts is shown again right after.
- The update prompt's **לרענן** now reloads into the new version on iPhone (it used to activate
  the new version silently and leave the page on the old one until the app was closed).

## 0.4.0 (2026-10-13)

- Push notifications, end to end: a daily reminder at the time each user picks (mentioning the
  rival's progress), the 20:00 "streak at risk" alert, and rival nudges delivered within seconds
  even when the app is closed. New **התראות** section in settings with per-phone switches, a time
  picker and a test notification; it explains what is missing (sync, home screen install, server,
  blocked permission) instead of failing.
- Push server: a Supabase Edge Function (`lexbites-push`) with Web Push implemented on WebCrypto,
  called by pg_cron every 5 minutes and by a trigger on new nudges. Deployed by the new
  `push-server.yml` workflow once two GitHub secrets exist. Replaces the GitHub Actions sender
  (`push-reminders.yml`, `scripts/send-push.ts`), which ran every 30 minutes at best.
- Supabase keepalive workflow every 2 days, no secret needed, so the free project never pauses
  between uses. `supabase/schema.sql` gains `lb_keepalive()`.
- The passphrase hash no longer shows in settings (push does not need it any more).
- `LEXBITES_SPEC.md` (the product specification) and `CLAUDE.md` (rules for every session) are in
  the repository root.
- Tests: Web Push crypto checked against independent implementations, every reminder rule, and a
  browser test that enables push against the real function and decrypts the test notification.

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
