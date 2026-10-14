# STATUS

**Live URL:** https://rotembenzur.github.io/EnglishApp/

Last updated: 2026-10-14 · version 0.8.1

## Deployment

- Published to GitHub Pages from the default branch `claude/trusting-knuth-gbbnzv`.
- Latest deploy: 0.8.0, CI and deploy run #67 on commit `dd0007a` (2026-10-13), all three jobs
  (verify, e2e, deploy) green. The recordings came from Audio run #8 (full render, 20 parallel
  jobs, about 2.5 hours); Audio run #9 on the same push found nothing new and skipped publishing.
- Verified on the real URL: `audio/index.json`, both word indexes (33 packs, 6,799 entries each)
  and the sentence index (20,292) answer 200; packs answer range requests with 206; a sentence
  clip and slices of both voices' packs are valid AAC (24 kHz mono). Chromium (iPhone 14 profile)
  on a fresh profile: 0.8.0 at the bottom of **הגדרות**, the recordings card reads "6,799 מילים
  וביטויים, 20,292 משפטים", all 33 American packs stored, then **כל המילים שמורות במכשיר**, zero console
  errors. That Chromium build has no AAC decoder, so it fell back to the system voice online and
  offline, which also shows the fallback works; playback of the recordings themselves needs the
  iPhone check below.
- Verified on the real URL: the built JS carries 0.7.0; Chromium (iPhone 14 profile) on a fresh
  profile shows "/ 1000 XP" on home, **יעד יומי** 1000 XP with the 1000 preset selected and 0.7.0
  at the bottom of **הגדרות**, zero console errors. Server rows re-read at 15:40 UTC: both 1000.

## Waiting on owner

1. **Recorded audio on the iPhone** (0.8.0): the checks listed under "Audio: what to check on the
   iPhone" below.
2. **Daily goal of 1000 XP on the iPhone** (0.7.0): the checks listed under "Daily goal: what to
   check on the iPhone" below.
3. **Sessions after the daily cap on the iPhone** (0.6.0): the checks listed under "After the
   cap: what to check on the iPhone" below.
4. **RTL check on the iPhone** (0.5.0): the screens listed under "RTL and bidi: what to check on
   the iPhone" below.
5. **Push on the phones** (0.4.1): update the app, send a test notification, and check the
   nudges, as listed under "Push: what to test on the phones" below.

Done by the owner: Pages enabled, `supabase/schema.sql` run with the passphrase, both phones
installed and syncing, push secrets added and the Push server workflow run (2026-10-13).

## Recorded audio (0.8.0)

Reported: the default voice was acceptable, the other voices terrible.

- Every authored word, curated item and example sentence now plays a neural recording made at
  build time (Kokoro): American `af_heart` for everything, British `bf_emma` for words and items.
  Long press on a word plays a real slow recording. Without a recording (Read mode, notes, context
  paragraphs) the best installed system voice speaks.
- Coverage, quality and size, from the first full render (Audio run 38436027692, 2026-10-13):
  - American: all 6,000 words and all 800 curated items (6,799 clips: one item shares its text
    with a word), and all 20,400 example sentences (20,292 clips: 108 sentences appear twice).
  - British: all 6,000 words and 800 items. Slow versions confirmed by Whisper: 6,499 of 6,799
    American and 4,861 of 6,799 British. The rest (300 and 1,938) were left out after every retry
    missed; their long press plays the normal recording at 0.75 speed (pitch kept).
  - Whisper checked all 27,196 word clips (normal and slow) and a 10% sample of 1,991 sentences.
    Published word clips that still mismatch: 346 of 24,958 (1.4%): 42 American normal (0.6%),
    304 British normal (4.5%), no slow ones. Sentences: 0 of 1,991. 1,874 clips were re-rendered
    after a miss with another pronunciation (509 use the heteronym reading that matches our IPA,
    373 phonemes converted from our IPA).
  - 528.5 MB, 21.4 hours of audio, AAC 48 kbps mono.
- Hosting: the `audio-store` release of this repository holds the files (not the git history);
  every deploy copies them into the site under `audio/`. Pages limit 1 GB: the site is about
  540 MB (13 MB app, 528.5 MB audio).
- Offline: the words of your accent are stored on the phone in the background (91.5 MB American,
  87.4 MB British, 33 files); sentences are stored when played and prefetched for the next
  session.
- System voices: ranked by real quality (premium, enhanced, compact from the voice URI), novelty
  and Eloquence voices blocked, duplicates merged, best five shown. **הגדרות** explains how to
  download a Premium voice when none is installed.
- Future content: a push of new shards renders only the new clips (Audio workflow), publishes them
  and redeploys.

## Audio: what to check on the iPhone

0.8.1: recordings play through Web Audio, so no "Now Playing" panel should open in the Dynamic
Island when a word or sentence plays. Check that too, including with the silent switch on.

Update to 0.8.0 first (bottom of **הגדרות**). Then:

1. **הגדרות**, **שמע**: the **הקלטות** card shows the number of words and sentences, then "שומר מילים
   לשימוש בלי רשת" with a counter, and after a minute or two on Wi-Fi **כל המילים שמורות במכשיר ועובדות
   גם בלי רשת**. **לשמוע הקלטה** plays a recorded word.
2. Start a session: new words and the speaker buttons play the recorded voice (a natural female
   American voice), not the iPhone voice. Example sentences too.
3. Long press a word's speaker: a slower recording of the same voice. Long press a sentence: the
   same recording, slower.
4. Switch the accent to **בריטי**: words in a British voice, sentences stay American. Switch back.
5. Airplane mode: open a word you studied and play it, and play a sentence you played before; both
   work. A sentence never played falls back to the iPhone voice.
6. **קול המערכת**: at most five voices, each labeled (פרימיום, משופר, רגיל, בסיסי), no Bells, Zarvox or
   Grandpa. If no good voice is installed you see the short download guide; after downloading a
   Premium voice and reopening LexBites it is first in the list and the guide is gone.
7. If a clip sounds wrong: word page, **לדווח על בעיה**, **הגייה שגויה**. The report now records the
   exact clip.

## Daily goal of 1000 XP (0.7.0)

Reported: the default goal of 60 XP made no sense; a normal 20-item session earns several hundred.

- New default 1000 XP. **הגדרות**: 300 to 3000 XP in steps of 100, presets 500 / 1000 / 1500 /
  2500 and a line on what a session is worth.
- Existing users: a one-time migration on each phone (`src/data/migrations.ts`) sets רתם and נועה to
  1000 when the phone opens 0.7.0, then syncs. It is recorded per phone and inside each synced
  profile, so a goal changed by hand later is never overwritten, not even by the other phone
  updating later with an old copy (two-phone sync test).
- Server rows set directly on 2026-10-13 15:22 UTC (they were 300 for רתם and 100 for נועה, set by
  hand under the old range) and read back: both 1000, carrying the same migration marker, ability
  and badges intact. Stamped one millisecond newer than the stored row, so a phone write at the
  same moment would win instead of being overwritten. A phone still on 0.6.0 may push its old
  profile back once; its migration fixes that when it updates.
- Kept: today counts as met if it was met under 60 (home shows the ring full and **היעד הושלם ✓**),
  the streak and history are untouched, the celebration fires once when 1000 is crossed on a day
  not met yet.
- Rescaled: the level curve (base 1000 instead of 60; the shown level drops once, XP unchanged),
  push copy (XP left and about how many sessions, instead of "five minutes"; function version 6),
  a new 250,000 XP badge. The rival card now shows the rival's goal progress.
- Guards: migration unit tests (runs once, keeps a manual change, keeps today and the streak,
  stale copy on the other phone), default and range tests, level curve tests, reminder copy tests,
  and `e2e/goal.spec.ts`, which opens 0.7.0 on top of 0.6.0 data in Chromium.

## Daily goal: what to check on the iPhone

Update to 0.7.0 first (bottom of **הגדרות**). Then:

1. **Home**: the ring reads "/ 1000 XP". If you had already passed your old goal today, the ring is
   full with **היעד הושלם ✓** and the streak did not drop.
2. **הגדרות**, **יעד יומי**: 1000 XP, the **1000 רגיל** preset highlighted. The minus and plus buttons move
   by 100 between 300 and 3000.
3. Pick another preset, close LexBites completely and reopen it: your choice stays (the migration
   never runs twice). On the other phone, after a sync, the rival card shows your new goal under
   **XP היום**.
4. The level under your name on home is lower than before. That is expected: levels now follow a
   1000 XP day. Your XP total (**סטטיסטיקה**) is unchanged.
5. Reminders: the daily reminder and the 20:00 streak alert now read like "עוד 700 XP ליעד של
   היום. שני סשנים וזה סגור".
6. Play until you cross 1000 XP on a day not met yet: the 🎯 celebration shows once.

## Sessions after the daily cap (0.6.0)

Reported: from some point in the day, every session held a single word.

- Root cause (`src/engine/session.ts`): the learn composer took only due reviews, and its top-up
  with words that are not due yet ran for review and boss sessions only (`mode !== 'learn'`).
  Once the day's 8 new words were in and nothing was due, the plan was the sanity probe alone.
  Reproduced in a unit test first (the plan had exactly 1 item).
- Fix: learning, review and boss sessions fill to their normal size: due reviews, early reviews
  by lowest FSRS retrievability, the hard-words pool, words learned today, then the same words
  in other exercises (at most 5 times each, never back to back). A probe alone is never a
  session. Early reviews are scheduled by FSRS from the real elapsed time (no Easy bonus on a word
  that was not due) and stay out of the 7-day retention behind cap suggestions. Theta keeps its
  2-point daily budget.
- New: once the cap is reached, home, the session summary and an empty learn screen show a card
  with **עוד 5 מילים חדשות** (today only; the setting is untouched).
- Other modes: hard words, listening and speed repeat a small pool in other exercises; below 3
  learned words (4 for speed, 30 for the boss) the button is disabled and the screen explains
  why, with a button to a learning session. A brand-new user with a cap of 3 gets extra practice
  of the new words, so the first session is not cut short.
- Guards: composer unit tests (cap reached with no due and few due reviews, brand-new user,
  handful of learned words, every mode, a property sweep over 768 pool shapes and seeds), FSRS tests for
  early and same-day reviews, and `e2e/cap.spec.ts`, which plays five sessions in a row (two
  before the cap, three after) and gets 20 items every time, then taps the +5 card.

## After the cap: what to check on the iPhone

Update to 0.6.0 first (bottom of **הגדרות**). Then:

1. Play learning sessions until the day's new words are in (8 by default). Home shows the card
   **המילים החדשות של היום כבר אצלך** with **עוד 5 מילים חדשות**.
2. Tap **ללמוד** (or **עוד סשן** at the end of a session) three or four times in a row: every
   session runs about 20 items, the progress bar on top has about 20 steps, and no word comes
   twice in a row.
3. At the end of each of those sessions the same card shows under the results.
4. Tap **עוד 5 מילים חדשות**: a toast **נפתחו עוד 5 מילים חדשות להיום**, a session starts and new
   words (the **מילה חדשה** card) show up in it. **הגדרות**, new words per day, still shows your
   own number.
5. **מילים קשות**, **מצב האזנה** and **סיבוב מהיר** run a normal length too. On the other
   profile, or a fresh one with almost no words, their buttons are greyed out until a few words
   are learned.

## RTL and bidi audit (0.5.0)

Reported: on the iPhone, Hebrew mixed with English, numbers, XP, punctuation or emoji rendered in
the wrong order, and Hebrew prefixes on English words ("מ-LexBites") broke apart.

- Root causes found: Hebrew paragraphs shown with `dir="auto"` flipped to LTR when they started
  with an English word (1,388 of 1,587 memory hooks, 83 of 120 confusable explanations, toasts);
  number and English pairs swapped inside Hebrew ("(BadJwtToken 403)"); signs landed on the wrong
  side (+3, −0.3, ×3, ~25); pure-English badge texts read "XP 10,000"; English sentences inside
  RTL paragraphs right-aligned; an unlayered CSS rule cancelled `text-center` on English
  elements; push notifications and share cards had no bidi handling at all; charts ran in mixed
  directions.
- Fix: one helper for the app and the push server (`supabase/functions/_shared/bidi.ts`), with
  directional marks for plain text (WebKit ignores the Unicode isolate characters) and `<Ltr>` /
  `<He>` for the DOM. Every UI string passes through it at the source. Details and rules in
  `docs/DECISIONS.md`, "RTL and bidi".
- Guards: unit tests run every UI string and every notification through a reference bidi
  algorithm; a source scan fails on Hebrew mixed with English or digits outside the helper.
- Reviewed in screenshots: every screen on an iPhone 14 viewport, both profiles, light and dark
  (`pnpm tsx scripts/bidi-screens.ts <dir>` against `pnpm preview`).

## RTL and bidi: what to check on the iPhone

Update to 0.5.0 first (bottom of **הגדרות**). Then:

1. **Bidi test page**: open `https://rotembenzur.github.io/EnglishApp/dev/bidi` in Safari. Every
   card should read naturally right to left, English and numbers in their normal order. It also
   shows every push notification and both share cards.
2. **A new word card and a mistake card** in a session: the lightbulb tip (most start with the
   English word) reads right to left, the English sentence is left aligned.
3. **מילים מבלבלות**: open a pair; the explanation and tip read right to left.
4. **Home**: rival card ("XP היום", "מובילים ב־… XP השבוע"), word of the day.
5. **Summary** after a session: "+XP", "הרמה זזה ב־+0.4", share card (↗).
6. **יריבות**: last week's score (yours on the right), today's duel result line, nudge toast.
7. **סטטיסטיקה**: charts run right to left, the heatmap opens on this week.
8. **הגדרות**, test notification: if it fails, the error in brackets reads "(403 BadJwtToken)",
   not reversed. A real reminder or nudge on the lock screen reads right to left.

## Push: the failing test notification (fixed in 0.4.1)

Reported: on an iPhone with notifications allowed, **לשלוח התראת בדיקה** failed every time.

- What was checked from here (the container still cannot reach `web.push.apple.com`, and the
  function logs need `api.supabase.com`): the deployed function answers CORS and POST correctly
  and finds nothing with a wrong passphrase hash. A self-test endpoint added to the function
  (`?probe=1`) ran inside Supabase's runtime: the encryption round-trips, and Apple answered our
  real token with `400 BadDeviceToken` (a made-up device) while control tokens signed by a wrong
  key, or with an invalid subject, got `403 BadJwtToken`. So Apple checks the token before the
  device, and our signing, subject, audience, expiry and encryption are accepted.
- That leaves the device-specific checks. The one thing every test push carried that the others
  did not was the optional `Topic` header `lexbites-test`: 13 characters, a length no base64url
  string can have (Apple requires base64url topics; reminders and nudges used 14, 18 and 20).
  Apple checks topics only for real devices, so this could not be confirmed from here.
- Fix: no `Topic` header at all (the notification `tag` already replaces duplicates on the
  phone), VAPID tokens reused as Apple asks, and a self-repairing test that shows Apple's exact
  status and reason if anything still fails. Every delivery's answer is also stored in
  `lb_push.state.lastResult`.

## Push: what to test on the phones

1. Update to 0.4.1: open LexBites from the home screen, tap **לרענן** on the update prompt (it
   now reloads by itself). The bottom of **הגדרות** says 0.4.1.
2. **הגדרות**, **התראות**: tap **לשלוח התראת בדיקה**, lock the phone. Expect "LexBites: ככה נראית
   תזכורת. ההתראות עובדות ✓" within seconds and the toast **נשלחה**.
3. If it still fails, the toast now ends with Apple's answer in brackets (for example
   `403 BadJwtToken`). Report that text.
4. Tap the test button three times quickly: one toast at a time, never a stack.
5. Nudge from the other phone (**יריבות**, 👋) while LexBites is closed on this one: a
   notification arrives within seconds; tapping it opens **יריבות**.

## Push notifications (built 2026-10-13, live since the owner added the secrets)

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
- Quality gates: Lighthouse mobile performance 95, accessibility 100, best practices 100; 195 unit tests (engine, sync, export/import, content, bidi), Playwright e2e (first run, all tabs, offline,
  resume, five sessions past the daily cap, update to the 1000 XP goal, two-phone sync), zero console errors, app shell about 190 KB gzipped.

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
- [x] RTL layout and bidi strings look right (2026-10-13, full audit in 0.5.0: unit tests on every string and notification, screenshots of every screen; real iPhone check listed above)
- [x] Dark and light mode (2026-10-12, screenshots)
- [x] Two profiles on two phones (owner report, 2026-10-13)
- [x] Sync, rival card, league, duel, nudges: two-phone e2e against PostgREST with the real schema (2026-10-13)
- [x] Sync against the hosted Supabase project on both phones (owner report, 2026-10-13)
- [x] Push server end to end against PostgREST with the real schema, real function under Deno (2026-10-13)
- [ ] Push notifications on both iPhones (after `SETUP.md` step 4; QA list, push section)
- [x] Export and import round trip (2026-10-12, unit test)
