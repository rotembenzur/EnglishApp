# Changelog

All notable changes to LexBites. Versions follow semantic versioning.

## 0.8.1 (2026-10-14)

- Recordings play through Web Audio instead of a media element, so the iPhone no longer opens a
  "Now Playing" panel in the Dynamic Island for every word or sentence. Offline playback, the
  slow long press and the fallback to the system voice work as before; slowed playback keeps its
  pitch.

## 0.8.0 (2026-10-13)

Real recordings instead of the phone's robot voice.

- Every authored word (6,000), curated item (phrasal verbs, idioms, collocations: 800) and
  example sentence (20,400) now plays a pre-rendered neural recording (Kokoro). American voice
  for everything; British voice for words and items (with the accent on UK, sentences use the
  American recording). 528.5 MB in total; the full numbers are in STATUS.md.
- A long press on a word plays a real slow recording (rendered at 0.75 speed), not stretched
  synthesis. A long press on a sentence slows its recording down with the pitch kept.
- Offline: the words of your accent are stored on the phone in the background (about 90 MB);
  sentences are stored when played and prefetched for the current and the next session. Works in
  the home screen app without a connection.
- Quality: every word clip was checked automatically by speech recognition (Whisper), with a
  second and third opinion and a re-render in another pronunciation when it heard something else.
  1.4% of the published word clips still mismatch (0.6% American, 4.5% British), 0 of 1,991
  sampled sentences. Slow clips Whisper could not confirm were left out; their long press plays
  the normal recording slowed down. Silence,
  loudness and length are checked on every clip. Heteronyms (read, lead, live, record...) follow
  the pronunciation on the card.
- System voice (the fallback for Read mode, notes and anything without a recording): the best
  installed voice is picked by its real quality (premium, enhanced, compact). Novelty and
  Eloquence voices (Bells, Zarvox, Grandpa...) are gone from the list, duplicates are merged, the
  best five are shown with their quality, and the list refreshes when a voice is downloaded.
  Without a good voice installed, **הגדרות** shows how to download one.
- **הגדרות** shows the recordings: how many, whether the words are stored for offline use, and a
  button to hear one. The test button for the system voice stays.
- "Report a problem" now records which clip you heard (recording or voice), so a bad one can be
  re-rendered.
- Fixed: dictionary audio for runtime words landed in the API cache, and offline playback of
  cached audio could fail on Safari (range requests). Recordings play from stored data, never by
  streaming a cached URL.
- New audio pipeline: `scripts/audio` and the Audio workflow render only new or changed text,
  publish to the `audio-store` release and redeploy. Future authored words get audio
  automatically on the next push.

## 0.7.0 (2026-10-13)

A daily goal that matches what a day of practice really earns: 1000 XP instead of 60.

- The default daily goal is 1000 XP. A normal 20-item session earns about 300 to 500 XP, so the
  goal is two or three sessions. In **הגדרות** the goal now runs from 300 to 3000 XP in steps of
  100, with four presets (500 קליל, 1000 רגיל, 1500 רציני, 2500 אינטנסיבי) and a hint of what a
  session is worth.
- Existing profiles: a one-time migration on each phone sets both goals to 1000 when it opens
  0.7.0 and syncs the change up. It runs once per phone and once per profile (a marker in the
  synced profile), so a goal you change afterwards is never touched again, even by the other
  phone updating later with an old copy. The server rows were also set to 1000 directly.
- Today and the streak are kept: a day already met under the old goal stays met (home shows it as
  done, the streak keeps counting it), and days in the history are untouched.
- Levels are rescaled to a 1000 XP day: level 2 after the first full day, level 10 after about a
  month of goal days, the last title after about a year. The old curve assumed 60 XP a day and
  passed through all 16 titles in about a month. Levels shown today will be lower; XP is unchanged.
- New badge **רבע מיליון** (250,000 XP), a long-term XP milestone next to 10,000 and 50,000.
- Push reminders no longer promise "five minutes": the daily reminder and the 20:00 streak alert
  say how much XP is left for today's goal and about how many sessions that is.
- The rival card shows the rival's progress toward their own goal, with ✓ once it is met.
- Tests: the migration (runs once, keeps a manual change, keeps today and the streak, a stale copy
  on the other phone never undoes a manual change through sync), the new default, the goal range,
  the level curve, the reminder copy, and an e2e test that opens 0.7.0 on top of 0.6.0 data.

## 0.6.0 (2026-10-13)

Keep playing after the daily new-word cap. Sessions no longer shrink to a single word.

- Fixed: once the day's new words were in and few reviews were due, every learning session held
  only the sanity probe. Learning, review and boss sessions now fill to their normal size: due
  reviews, then early reviews of the words you are most likely to forget (FSRS retrievability),
  then the hard-words pool, then practice of words learned today, then the same words again in
  other exercises.
- Early reviews are scheduled by FSRS from the real elapsed time: a word you clearly know barely
  changes, and its next review only moves later. A fast answer on a word that was not due counts
  as Good, not Easy. Early answers stay out of the 7-day retention behind the cap suggestions.
- New: once the cap is reached, home and the end of a session say so and offer **עוד 5 מילים
  חדשות**, which adds 5 new words for today only (the setting stays as it is).
- Hard words, listening and the speed round repeat a small pool in other exercises instead of
  stopping after a few items; with too few learned words their buttons are disabled, and opening
  them explains why with a way forward. Speed rounds never repeat a word back to back.
- A brand-new user with a low cap gets extra practice of the new words, so the first session is
  not cut short.
- Tests: composer cases for the cap with no and few due reviews, a brand-new user, a handful of
  learned words, every other mode, a property check over many pool shapes, FSRS checks for early
  and same-day reviews, and an e2e test that plays five sessions in a row past the cap.

## 0.5.0 (2026-10-13)

RTL and bidi, everywhere. Hebrew mixed with English, numbers, XP, signs, emoji or URLs now renders
in the right visual order on every screen, in toasts, on the share cards and in push notifications.

- One shared bidi helper for the app and the push server, with plain-text rules that work in
  WebKit (directional marks; iPhone Safari ignores the Unicode isolate characters) and two React
  components: `<Ltr>` for an LTR fragment and `<He>` for Hebrew paragraphs that carry English.
- Memory hooks, confusable explanations and tips, sentence translations, translations, placement
  options and toasts render as Hebrew paragraphs. Most hooks start with the English word, and they
  used to flip the whole paragraph left to right.
- A Hebrew prefix stays attached to its English word and on the same line ("מ-LexBites",
  "ב־40 XP"). Numbers keep their units and signs in order: "(403 BadJwtToken)" in the push test
  error, "+0.4" and "−0.3" for level changes, "×3" combos, "~25" in placement, "+8" on the learn
  hub, "10,000 XP" badges, "XP היום".
- English sentences (word of the day, cloze, mistakes) are left-aligned LTR blocks again, and
  English elements that ask to be centered are centered (the placement check word, match cards).
- Push notifications: every title and body goes through the helper on the server (function
  version 5), so "נועה כבר ב־40 XP היום" and "LexBites: …" read right to left on the lock screen.
- Share cards: Hebrew drawn right to left with the same marks, stats in the app's order (XP on the
  right), the week shown as "12.10".
- Charts: time runs right to left on every chart (minutes, forecast, retention, heatmap, level over
  time), the heatmap opens on the current week, retention dates read "5.10". The last week's score
  reads in the players' order. The duel result is written in Hebrew with both names.
- Header titles that are English words (word detail) are isolated LTR. Library and confusables
  search fields read RTL while empty and follow what is typed; confusables search also finds
  Hebrew. The session timer reads "56 שנ׳".
- Nudge toasts no longer show the emoji twice. Inline Hebrew strings moved into `he.ts`.
- Icon and splash links resolve from the app root, so a nested screen no longer requests
  `dev/icons/favicon.svg` (a console 404) and adding to the home screen from any page keeps the
  icon.
- Regression guards: unit tests check every UI string and every notification against a reference
  Unicode Bidirectional Algorithm; a source scan fails on Hebrew mixed with English or digits
  outside the helper; `pnpm tsx scripts/bidi-screens.ts` photographs every screen on an iPhone
  viewport (both profiles, light and dark). The bidi test page (`/dev/bidi`) lists every tricky
  string, Hebrew content with English, every notification and both share cards.

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
