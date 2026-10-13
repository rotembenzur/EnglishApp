# LexBites: Personal English Vocabulary Trainer (PWA)

> **To the agent reading this (Claude Code):** this file is both your prompt and your product specification.
> You are the sole engineer, designer, content author and release manager of this project.
> The product owner (rotem) will not answer questions during the build. Read the "Autonomy contract" first, then build the entire product end to end.
> Working name: **LexBites**. You may rename it if you find something better. Decide alone.

---

## 0. Autonomy contract (read this first)

1. **You never ask the owner a question.** Every open point in this document is yours to decide. Pick the option that best serves the goals in section 1, write the decision down in `docs/DECISIONS.md` (one line: decision, why, alternatives rejected) and move on.
2. **You never stop with a plan and wait for approval.** You plan, then you execute the plan, then you verify, then you deploy, then you continue to the next phase.
3. **You never leave the product in a broken state.** `main` must always build, pass tests and deploy. Work in small commits. If something is half done at the end of a session, it is behind a feature flag or on a branch.
4. **If something truly requires the owner** (for example creating an account on a third-party service, pasting a credential), you do NOT block on it. You:
   - build everything else so the product works fully without it (local-first, see section 9),
   - write exact, numbered, five-minute instructions in `SETUP.md`,
   - add the item to `STATUS.md` under "Waiting on owner",
   - continue with the rest of the roadmap.
5. **You verify your own work.** Run it, test it, open it, click through it. Treat "it compiles" as the beginning of verification, not the end.
6. **You own quality.** The bar is: a product the owner would happily pay for. Not a demo. Not a prototype. Not "an MVP you can extend later". Polished, fast, delightful, correct.
7. **You keep the owner informed without needing them.** Keep `STATUS.md` current: what is live, what is next, what is waiting, the live URL.
8. **Scope is a floor, not a ceiling.** Everything in this file is required. You are expected to add improvements you believe in. Write them in `docs/DECISIONS.md` as well.
9. **No paid services.** Everything must run on free tiers, forever. No credit card. No trials that expire.
10. **Never destroy user data.** Every schema change ships with a migration. Export/import always works.

---

## 1. Mission and success criteria

**Mission:** a personal, bite-sized English vocabulary trainer for two people (rotem and noa) that:
- finds each user's real level and feeds them new words **slowly, just above their level**, so progress feels effortless and steady,
- **never forgets what they learned** and brings words back at the right moment (spaced repetition),
- draws from a word pool that is effectively **the whole English language**, not a fixed course,
- gives for every word: **audio, Hebrew translation, example sentences**,
- sometimes asks the user to **type/spell** the word, not just recognize it,
- is **fun** (gamified) and **social for two**: a permanent, friendly rivalry between ROTEM and NOA where each always sees the other's progress.

**Form factor:** a web app, installed as a **PWA on iPhone** (added to the home screen from Safari). Must feel like a native app. Hebrew, right-to-left UI. English content.

**Success criteria (your definition of done, all required):**
- Installs on iPhone from Safari "Add to Home Screen", opens full screen, works offline after first load.
- A brand-new user finishes placement and gets a sensible first session within 3 minutes.
- Daily use in 5 to 10 minutes gives a clear sense of progress and keeps retention high (target: 7-day recall above 85% on reviewed words, measured in-app).
- Both users can install the same URL on two phones, pick their profile, and see each other's live progress.
- Every word ever shown has audio, Hebrew meaning and at least two example sentences.
- Zero console errors. Lighthouse PWA audit passes. Performance score above 90 on mobile.
- All learning-engine logic covered by unit tests.

---

## 2. Users and context

- **Two fixed users:** `rotem` and `noa`. No open registration. A profile picker on first launch, remembered per device, optional 4-digit PIN per profile (set from settings; the point is to stop accidental use of the wrong profile, not security).
- Native language: **Hebrew**. Target language: **English** (American spelling and pronunciation by default, British selectable).
- Both users are adults learning for general fluency: everyday conversation, work (tech/business), travel, media.
- Expected level range: roughly B1 to C1 now, growing over time. The engine must not assume this; it must measure it.
- Context of use: short bursts on the phone (commute, coffee break, bed). Sessions must be interruptible at any moment and resume cleanly.
- Hebrew UI: all interface text in natural, modern, non-stilted Hebrew. Correct RTL for layout; English words, numbers and sentences inside Hebrew text must render in the correct direction (use `dir="auto"`, `unicode-bidi: isolate`, and explicit `dir="ltr"` on English content blocks).

---

## 3. Non-negotiable requirements (checklist)

- [ ] PWA installable on iOS Safari, standalone display, offline-capable after first load.
- [ ] Adaptive level estimation per user; new words chosen slowly around the user's level and drift upward only as evidence accumulates.
- [ ] Spaced repetition of all learned words (modern algorithm, see 4.5).
- [ ] Every word: pronunciation audio, IPA, part of speech, Hebrew translation (per sense when needed), 2 to 3 example sentences with Hebrew translations, sentence audio.
- [ ] Word pool: the full English lemma inventory (tens of thousands), ordered by real-world frequency, never "runs out".
- [ ] Typing/spelling exercises mixed into sessions.
- [ ] Gamification: XP, levels, streaks, daily goal, badges, combos.
- [ ] Two-player rivalry: each user sees the other's words today, streak, XP today, weekly score, at any time.
- [ ] Hebrew RTL UI, polished design, dark mode.
- [ ] Deployed to a public HTTPS URL from the GitHub repository on every push to `main`.
- [ ] Data never lost: local persistence, cloud sync (when configured), export/import.

---

## 4. Learning engine (the heart of the product)

Implement this as a pure, well-tested TypeScript module (`packages/engine` or `src/engine`) with no UI dependencies.

### 4.1 Word difficulty model

Every lemma gets a static difficulty `d` in the range 0 to 100 computed at build time from:
- **Frequency rank** (primary signal, roughly 70% of weight). Use a large, open frequency list (see 5.1). Map rank to difficulty with a log scale: rank 1 to 100 is around 0 to 5, rank 1,000 is around 25, rank 5,000 is around 50, rank 20,000 is around 75, rank 50,000+ is around 90 to 100.
- **CEFR tag** where available (A1 to C2) as a corrective signal (around 20%).
- **Minor signals** (around 10%): word length, number of senses, whether it is an irregular form, abstractness heuristics. Keep these small.

Store `d` with the word. Also store `band` (A1, A2, B1, B2, C1, C2, C2+) derived from `d` for display.

### 4.2 Ability estimation (per user)

Each user has an ability score `theta` in the same 0 to 100 scale, plus an uncertainty `sigma`.

- **Placement test on first use** (2 to 3 minutes, feels like a game, not an exam):
  - Adaptive: start at d = 40, show one word at a time with "I know it / Not sure / Don't know". Every 3rd item is verified with a quick 4-option meaning check so self-report cannot inflate the score.
  - Binary-search style narrowing over difficulty; stop after about 25 items or when sigma is small enough.
  - Result: initial `theta`, `sigma`. Everything below `theta - 20` is marked **assumed known** (not studied, but see 4.4 for occasional verification).
  - Can be retaken from settings; retaking never deletes learning history.
- **Continuous update** after every graded answer on a word with difficulty d (Elo-like, deliberately slow):
  - `expected = 1 / (1 + 10^((d - theta) / 20))`
  - `theta += K * (score - expected)` where `score` is 1 for correct, 0.5 for correct-with-hint or near-miss typo, 0 for wrong; `K` starts around 2.0 after placement and decays to around 0.6 as the review count grows. The owner explicitly wants **slow** movement: a good day should move theta by at most 1 to 2 points.
  - First-exposure answers on new words carry more weight for theta than repeat reviews (repeat reviews mostly inform the SRS, not the level).
- Show theta to the user as a friendly level (band + progress bar inside the band), never as a raw number by default (raw in stats screen for the curious).

### 4.3 New word selection (the "i+1" rule, slowly)

- Candidate pool: words not yet studied and not assumed-known, with `d` in the window `[theta - 4, theta + 12]`.
- Sampling weight peaks around `theta + 5` (slightly above level), tapering at the edges. Add a small share (around 10%) of "topic" words the user has favorited topics for (see 7.3).
- **Daily new-word cap:** default 8 new words per day, user adjustable between 3 and 25. The engine auto-suggests raising the cap only when the last 7 days show retention above 85% and the review queue is under control; it suggests lowering it when reviews pile up (due count above 60). Suggestions are one-tap in the home screen; never automatic.
- Never introduce more than 2 new words in a row in a session; interleave with reviews.
- Prefer lemmas that unlock families (for example introduce "decide" before "decisive").
- **"I already know this" shortcut** on a new word's intro card: ask a verification question; if passed, mark as known with a long initial interval and give a small theta nudge up. If failed, continue as a normal new word, no penalty.

### 4.4 Assumed-known verification

Every session includes, on average, one "sanity probe": a word from the assumed-known pool just below theta. If the user fails it, it enters normal learning and theta takes a small hit. This keeps the level honest and makes the "whole dictionary" promise real: nothing is ever permanently excluded.

### 4.5 Spaced repetition

- Use **FSRS** (Free Spaced Repetition Scheduler) via the `ts-fsrs` package. Do not hand-roll SM-2.
- Ratings (Again / Hard / Good / Easy) are **derived from behavior**, not self-reported:
  - Wrong answer: Again.
  - Correct after a hint, a near-miss typo, or slower than the user's own 80th-percentile response time for that exercise type: Hard.
  - Correct, normal speed: Good.
  - Correct, fast (below the user's 30th percentile) on a typing or listening exercise: Easy.
- Keep per-user FSRS parameters; run the FSRS optimizer on-device periodically (weekly, when there are enough reviews) to personalize.
- **Leech handling:** a word failed 6+ times gets flagged, shown with its mnemonic/notes, and surfaced in the "hard words" practice mode. Never silently dropped.
- Mastery tiers per word (shown as crowns, 0 to 5) derived from FSRS stability thresholds (for example 1 day, 7 days, 30 days, 120 days, 365 days).
- Retention target configurable (default 0.9).

### 4.6 Session composition

A standard session is about 20 items (around 5 minutes), always built as:
1. Due reviews first (oldest due first), capped so new words still fit.
2. New words interleaved (intro card, then within the same session: a recognition check a few items later, then a production check near the end).
3. One sanity probe (4.4).
4. Exercise type mix per session (approximate): 35% meaning recognition (EN to HE, HE to EN), 20% typing/spelling, 15% listening, 15% cloze in context, 10% match pairs, 5% speed items. Typing is mandatory at least every 5th item.
5. The last item of a session is always something the user is likely to get right (end on a win).
6. Sessions can be ended at any time; progress is saved per item, not per session.

Also provide:
- **Review-only session** (when new-word cap is reached or user wants just reviews).
- **Hard words session** (leeches and low-stability words).
- **Speed round** (60 seconds, rapid 4-option meaning checks, XP multiplier, counts as reviews with "Hard/Good" only).
- **Listening-only session** (hands-busy mode: hear word and sentence, pick meaning; large buttons).

### 4.7 Exercise types (implement all)

1. **Intro card** (new word): word, IPA, audio auto-plays after first user gesture in session, POS, Hebrew meaning(s), 2 example sentences with Hebrew, buttons: "הבנתי" / "כבר מכיר".
2. **EN to HE multiple choice**: 4 options, distractors from the same POS and similar difficulty, never the same Hebrew word twice, never an obviously wrong POS.
3. **HE to EN multiple choice**: same rules.
4. **Listening**: audio only (word, then on tap the sentence), choose meaning or the written word among 4.
5. **Typing**: Hebrew meaning (and optionally the sentence with a blank) shown, user types the English word. Tolerance: Levenshtein distance 1 for words of length 5+ counts as "כמעט" (Hard), show the correct spelling highlighted. Input: `autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off"`, font size 16px or larger (avoids iOS zoom), enter key submits.
6. **Cloze**: example sentence with the target blanked, user types or picks from 4. Sentence audio available.
7. **Match pairs**: 5 English and 5 Hebrew, tap to match, timed bonus.
8. **Speed item**: 4-option meaning check with a 6-second timer.
9. **Spell it from audio**: hear the word, type it (unlocks after the word reaches crown 2).

Every exercise shows instant feedback with the full word card on wrong answers (word, meaning, audio, sentence), so a mistake is a learning moment, not a dead end.

---

## 5. Content: the dictionary

### 5.1 Word inventory ("truly never ends")

- Build the master lemma list from an open, large frequency resource. Preferred: the `wordfreq` Python package (MIT) exported to a list of the top ~60,000 English lemmas, or the FrequencyWords `en_full` / `en_50k` list (open). Lemmatize (spaCy or NLTK WordNet lemmatizer), drop proper nouns, pure numbers, single letters, obvious OCR junk, and slurs. Keep contractions out; keep phrasal verbs as a separate curated list (see 5.4).
- Result: `content/lemmas.json` with `{lemma, rank, pos[], d, band}`. This is the backbone and must contain **at least 50,000 entries**.
- Add frequency-based **topic tags** (family, work, travel, food, tech, emotions, health, nature, law, finance, academic, slang, phrasal verbs, idioms) using open resources plus your own classification at enrichment time.

### 5.2 Enrichment tiers

Each lemma reaches one of three content tiers:

- **Tier A (fully authored):** Hebrew translation per sense (up to 3 senses), IPA, POS, 3 example sentences (natural, modern, B1 to C1 register, varied contexts) each with a Hebrew translation, a short English definition, collocations (2 to 4), a one-line memory hook in Hebrew when useful, topic tags.
- **Tier B (API enriched, cached):** definition, IPA, audio URL from a free dictionary API; Hebrew translation from a free translation endpoint; sentences generated from the API examples when present. Marked `auto: true` in the UI with a tiny indicator and a "report" button.
- **Tier C (lemma only):** exists in the inventory, enriched on demand to Tier B when first selected, and queued for Tier A authoring.

**Authoring plan:**
- You (Claude Code) author Tier A content yourself, directly, as JSON shards of 200 lemmas each (`content/shards/0000.json` ...), in frequency order. Validate each shard against a JSON schema (`content/schema.json`) in CI. Commit each shard.
- Launch minimum: the top **3,000** lemmas at Tier A. Then continue in later passes to 6,000, then 10,000. Add a repeatable script `pnpm enrich --from N --to M` that prints the exact authoring task for a shard and validates the result, so future passes are mechanical.
- If an `ANTHROPIC_API_KEY` happens to be available in the environment, the enrich script may call the API to author shards in bulk; otherwise author them directly. Never require the key.
- Quality rules for Hebrew: use the lemma form (infinitive for verbs, singular masculine for adjectives unless the English is inherently plural), modern everyday Hebrew, no niqqud, include a second translation when the English word is ambiguous ("bank": בנק; גדה), gender-neutral phrasing where natural. Example sentences must be ones a real person would say or read, not textbook filler, and must use the word in its most common sense first.

### 5.3 Audio

- Primary for words: audio file URL from the free dictionary API when available (cache the file in the service worker on first play).
- Fallback for words and primary for sentences: **Web Speech API** (`speechSynthesis`) with the best available English voice (prefer enhanced/premium voices on iOS: for example "Samantha", "Ava", "Daniel" for British). Let the user pick accent and speed in settings. Pre-load voices on app start; on iOS the first play must happen inside a user gesture, so trigger it from the session's first tap and then allow auto-play for the rest of the session.
- Every word card and every sentence has a speaker button. Tap-and-hold plays slowly.

### 5.4 Beyond single words

- Curated lists (author them): top 300 phrasal verbs, top 300 idioms, top 200 collocation patterns. These enter the pool as items with their own difficulty and are tagged so the user can enable/disable them.
- Word families: link lemmas sharing a root (decide, decision, decisive, undecided). Show the family on the word detail screen; prefer introducing families gradually.

### 5.5 Content governance

- "Report a problem" button on every card (wrong translation, bad sentence, audio wrong). Reports are stored and synced; a `content/reports.json` export plus a `pnpm reports` command lets you fix them in bulk in a later pass.
- Users can add their own notes and mnemonics per word; also "favorite" words and "ignore" words (ignored words never appear again but are reversible from the library).

---

## 6. Gamification and the two-player rivalry

### 6.1 Progress mechanics
- **XP:** per correct answer by exercise type (recognition 10, listening 12, cloze 14, typing 18, speed 6) with a **combo multiplier** inside a session (x1.0, x1.2, x1.5, x2.0 at 3, 6, 10 consecutive correct; reset on mistake). New word learned (first production success): +25.
- **Daily goal:** default 60 XP, adjustable. Progress ring on home. Hitting it triggers a satisfying animation and sound (sounds optional, off by default on first run, toggle in settings).
- **Streak:** days with goal reached. One streak-freeze earned per 7-day streak, max 2 banked, auto-applied. Streak shown with a flame and the record streak.
- **Levels:** XP thresholds with a gentle curve; a title per level in Hebrew (for example: מתחיל, סקרן, אספן מילים, ...). Level-up celebration.
- **Crowns per word** (section 4.5). Word library shows crown distribution.
- **Badges:** at least 30, including: first session, 100/500/1,000/5,000 words studied, 7/30/100/365-day streak, perfect session, 50 typed words correct, speed round above X, learned a word at 06:00 (early bird), 23:00 (night owl), retook placement and leveled up, completed a topic, reported 10 content issues (quality guardian), beat the rival 4 weeks in a row, and more you invent.

### 6.2 Rivalry: ROTEM vs NOA (always on, always friendly)
- **Rival card on the home screen**, always visible: the other user's avatar, words today, XP today, streak, and whether they have trained today ("נועה כבר התאמנה היום", "רתם עדיין לא התחיל"). Updates live via sync; shows "last seen" time when offline.
- **Weekly league:** Monday to Sunday, XP race, bar chart of each day for both users, trophy for the winner, all-time head-to-head record (wins, draws, longest winning run). A small weekly recap on Monday morning.
- **Daily duel:** both users get the same 10-word speed challenge each day (seeded by date); compare score and time. Optional, no penalty for skipping.
- **Nudges:** a button to send the rival a predefined emoji nudge (a wave, a fire, a sleeping face, a trophy). Delivered through sync and shown as a toast on next open (and as a push notification if push is configured, see 9.6).
- **Shared milestones:** "together you have learned 2,400 words".
- Every user can see the other's full stats page (read-only). No private data exists in this app; design accordingly.

### 6.3 Tone
Warm, playful, a bit cheeky, never nagging. Micro-copy in Hebrew that a real person would write. Write a `docs/VOICE.md` with 20 example strings and use it consistently.

---

## 7. Feature list

### 7.1 Core (must ship in the first release)
- Profile picker (rotem / noa), optional PIN, remember device.
- Placement test.
- Session engine with all 9 exercise types.
- Word card with audio, IPA, POS, Hebrew, sentences, family, notes, favorite, ignore, report.
- Home: daily ring, streak, rival card, start buttons (Learn, Review, Hard words, Speed round, Listening mode).
- Session summary: XP, accuracy, new words, words strengthened, rival comparison for today, one "word of the session" to re-hear.
- Library: search (English and Hebrew), filters (new / learning / mastered / favorites / ignored / leeches / by topic / by band), sort by due date, next review time per word.
- Stats: words known by band, ability (theta) over time, retention over time, review heatmap (GitHub style), minutes per day, accuracy by exercise type, forecast of due reviews for the next 14 days.
- Rivalry screen: weekly league, history, duels, nudges.
- Settings: daily goal, new words per day, accent, voice, speed, sound effects, dark/light/auto, PIN, retake placement, export JSON, import JSON, reset (with double confirmation and automatic backup export first), sync status.
- Offline-first, sync when online.
- Deployed PWA.

### 7.2 Extended (ship as soon as core is solid; still required)
- **Topics:** choose favorite topics to bias new words (section 4.3).
- **Word of the day** on the home screen (a slightly-above-level word, shared by both users, with sentence and audio).
- **Smart reminders:** a daily local reminder time (push, when configured) with copy that references the rival ("נועה כבר ב-40 XP היום").
- **Context mode:** short paragraph (3 to 4 sentences, authored at Tier A for the top words) with the target word, to read and hear.
- **Review forecast and "clear the queue" planning:** "You have 48 due, around 12 minutes".
- **Share card:** generate an image (canvas) of today's result or weekly league to share in WhatsApp.
- **Home screen widgets substitute:** a lightweight `/today` route rendering a compact card, usable as a Safari start page bookmark.
- **Accessibility:** large-text mode, reduced motion respects `prefers-reduced-motion`, 44px tap targets, full keyboard support on desktop.
- **Desktop layout:** works nicely in a browser too (centered phone-width column with keyboard shortcuts for 1 to 4 options and Enter).

### 7.3 Ideas you should evaluate and implement if they are good (your call, document the decision)
- Synonym/antonym mini-exercises for C1 words.
- "Explain the difference" cards for confusable pairs (affect/effect, borrow/lend) authored at Tier A.
- Weekly "boss review": a 30-item mixed session with a special badge.
- Pronunciation self-check using the Web Speech recognition API where supported (Safari support is limited; feature-detect).
- Importing a word list (paste text, the app extracts unknown lemmas above the user's level and offers to add them).
- "Read mode": paste an English text, tap any word to see its card and add it.

---

## 8. UX and UI specification

### 8.1 Design direction
- Mobile-first, phone-width layout, bottom tab bar (בית, למידה, מילים, יריבות, סטטיסטיקה) with safe-area padding.
- Visual style: clean, bold, warm. One accent color per user (rotem and noa get distinct accents so you always know whose profile is open). Rounded cards, generous spacing, big readable English words (display font for English, Hebrew UI font such as Heebo or Rubik, self-hosted for offline).
- Motion: short, meaningful transitions (card flip for reveal, confetti on goal, subtle shake on wrong). Respect reduced motion.
- Dark mode first-class, auto by system.
- Never a loading spinner for local data; skeletons only for sync.
- No marketing fluff, no onboarding carousel longer than one screen.

### 8.2 Screens (minimum)
1. Profile picker.
2. Placement (intro, items, result with level reveal).
3. Home.
4. Session (item view, progress bar on top, exit with confirmation only if mid-item).
5. Session summary.
6. Word detail.
7. Library (list, filters, search).
8. Stats.
9. Rivalry (league, duel, nudges, rival profile).
10. Settings.
11. `/today` compact card.
12. Offline/update toast states.

Write a short `docs/SCREENS.md` with a one-paragraph purpose and the key elements per screen before implementing them.

### 8.3 RTL and bidi rules
- `<html lang="he" dir="rtl">`.
- English words, sentences, IPA: wrap in an element with `dir="ltr"` and left-aligned text inside an RTL layout.
- Mixed Hebrew sentences containing English terms: `dir="auto"` plus `unicode-bidi: plaintext` on the container.
- Numbers and punctuation at the edge of Hebrew strings must be checked visually; add a tiny bidi test page in dev mode listing tricky strings.
- Icons that imply direction (back, next) must mirror in RTL.

---

## 9. Technical architecture

Decide the exact stack yourself; the following is the recommended default. Deviate only with a documented reason.

### 9.1 Stack
- **Vite + React + TypeScript (strict)**, Tailwind CSS, Zustand (or similar) for state, React Router.
- **Dexie (IndexedDB)** for local persistence. All reads from local; sync is an additive layer.
- `ts-fsrs` for scheduling.
- `vite-plugin-pwa` (Workbox) for the service worker: precache the app shell and content shards, runtime-cache audio files and API responses (cache-first with expiry).
- Vitest for unit tests, Playwright for a smoke e2e (install flow cannot be automated on iOS; test the web flows).
- pnpm, ESLint, Prettier, Husky pre-commit (lint, typecheck, test).

### 9.2 Data model (local and remote share the same shape)
- `users`: id, name, pinHash?, accent, voice, settings{}, theta, sigma, fsrsParams, createdAt.
- `lemmas` (static, bundled): id, lemma, rank, pos[], d, band, tags[], family?.
- `content` (static shards + runtime cache): lemmaId, tier, hebrew[], ipa, definition, sentences[{en, he}], collocations[], hook?, audioUrl?, auto.
- `userWords`: userId, lemmaId, state (new/learning/review/known/ignored), fsrs card fields, crowns, lapses, isLeech, favorite, note, firstSeenAt, lastReviewAt, nextDueAt.
- `reviews` (append-only log): id, userId, lemmaId, exerciseType, rating, correct, responseMs, at. This log is the source of truth; everything else is derivable.
- `dailyStats`: userId, date, xp, newWords, reviews, minutes, goalReached, streakFreezeUsed.
- `events` (append-only, for sync): nudges, badges, duel results, reports.
- Every row has `updatedAt` and a `deviceId` for conflict resolution.

### 9.3 Sync (two phones, one truth) and the backend decision
The product must work 100% without any backend (single device). The rivalry needs a shared store. Decision tree:

1. Prefer any approach that requires **zero owner action**. If none exists at zero cost, go to 2.
2. Use **Supabase** (free tier, Postgres, REST over HTTPS, works from a static site with the public anon key). Build the full sync layer against it. Tables mirror 9.2 with `user_id`. Since this is a private two-person app, protect the project with a simple shared passphrase stored in the app settings that is sent as a header and checked by RLS policy or an edge function (document the choice). Write `SETUP.md`: create project, run the provided `supabase/schema.sql`, paste the URL and anon key into `public/config.json` (or the in-app settings screen), done. Keep the app fully functional in local mode until then; show a clear "סנכרון לא מוגדר" state with a one-tap link to the instructions.
3. If Supabase is unavailable for any reason, Firebase Realtime Database or Cloudflare Workers + KV are acceptable alternatives with the same local-first contract.

Sync rules:
- Local-first: every write goes to IndexedDB immediately, then to an outbox, then pushed when online.
- Pull on app open, on focus, every 60 seconds while open, and after each session.
- Conflict policy: `reviews` and `events` are append-only (union). `userWords` and `dailyStats` use last-write-wins by `updatedAt`, but `reviews` can always rebuild them; provide a "rebuild from log" maintenance action in settings.
- The rival card uses the other user's `dailyStats` for today plus a `presence` row (lastSeenAt, inSession).
- Show sync status unobtrusively (small dot: green synced, grey offline, orange pending).

### 9.4 Deployment
- Repository on GitHub (the owner connects it). Deploy with **GitHub Actions to GitHub Pages** on every push to `main`: install, lint, typecheck, test, build, deploy. Configure the Vite `base` for the Pages path (or for a custom domain if one is set later), add a `404.html` SPA fallback, and make sure the manifest `start_url` and `scope` are correct for the subpath.
- If the `gh` CLI is authenticated in your environment, enable Pages and set the source to GitHub Actions yourself; otherwise document the one toggle in `SETUP.md` and continue.
- Put the live URL at the top of `README.md` and `STATUS.md`.
- Versioning: semantic version in `package.json`, `CHANGELOG.md` updated per release, the version visible in settings.
- App updates: the service worker checks for updates on open; show a small "גרסה חדשה זמינה, לרענן?" toast; never force reload mid-session.

### 9.5 iOS PWA checklist (all required)
- `manifest.webmanifest`: name, short_name, `display: standalone`, `start_url`, `scope`, `theme_color`, `background_color`, icons 192, 512 and a maskable icon.
- `<link rel="apple-touch-icon">` 180px, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` (`black-translucent` with safe-area aware header), `apple-mobile-web-app-title`.
- `viewport-fit=cover`, padding with `env(safe-area-inset-*)`, use `100dvh` not `100vh`.
- `overscroll-behavior: none`, no pull-to-refresh, no rubber band on the app shell, scrolling only inside content panes.
- Inputs 16px or larger (prevents zoom). Disable double-tap zoom via `touch-action: manipulation`.
- Splash: generate iOS splash images for common sizes or use a solid background with the icon.
- Audio: unlock `speechSynthesis` on first gesture; test that it works in standalone mode, not just Safari tab.
- Test for the iOS 7-day storage eviction risk: data is synced, and the app prompts for an export if sync is not configured and it has been 5+ days.
- Design app icons (simple, bold, recognizable at 60px) and generate them with a script in the repo.

### 9.6 Push notifications (web push on iOS 16.4+, standalone only)
Implement behind a feature flag with a VAPID key pair and a small sender (Supabase Edge Function or a GitHub Actions scheduled workflow calling the push endpoints with the stored subscriptions). If the backend is not configured, the feature stays hidden. Reminders: daily at a chosen time, rival nudges, "your streak is at risk" at 20:00 if goal not met.

### 9.7 Security and privacy
- No analytics, no third-party trackers.
- Secrets never committed except the backend's public anon key (which is designed to be public) and the VAPID public key.
- PIN is a convenience lock, hashed locally.

---

## 10. Quality bar and definition of done

Before you call any phase done:
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green in CI.
- Engine tests cover: difficulty mapping, placement convergence (simulate users at theta 20, 50, 80 and verify estimates land within 8 points), slow theta drift (a simulated perfect day moves theta less than 2 points), new-word window sampling, daily cap, FSRS rating derivation from behavior, session composition rules, leech detection, typing tolerance, distractor selection validity.
- Content tests: every Tier A shard validates against the schema; no duplicate lemmas; every Tier A entry has 2+ sentences with Hebrew; Hebrew strings contain Hebrew characters; English strings contain no Hebrew.
- Manual verification script in `docs/QA_CHECKLIST.md` (install on iPhone, offline, audio, RTL, dark mode, two profiles, sync, rival card, export/import) that you run and tick in `STATUS.md` with the date.
- Lighthouse (mobile): PWA installable, performance above 90, accessibility above 90.
- Bundle: app shell under 400 KB gzipped; content shards loaded lazily.
- No `any`, no TODO without an issue reference in `docs/BACKLOG.md`.

---

## 11. Working process (how you run this project)

Work in phases. Each phase ends with: tests green, deployed to `main`, `STATUS.md` and `CHANGELOG.md` updated, `docs/DECISIONS.md` updated. Do not wait between phases.

- **Phase 0, Foundation:** repo structure, tooling, CI, PWA shell deployed with a "coming soon" home that already installs on iOS. Icons. `STATUS.md`, `SETUP.md`, `docs/DECISIONS.md`, `docs/SCREENS.md`, `docs/VOICE.md`.
- **Phase 1, Content backbone:** lemma inventory (50k+), difficulty model, schema, first 1,000 Tier A shards, enrich script, Tier B runtime enrichment, audio layer.
- **Phase 2, Engine:** ability estimation, placement, selection, FSRS integration, session composer, all exercise types as pure logic, full unit tests.
- **Phase 3, Core UI:** profile picker, placement, session, summary, home, word card, library, settings, export/import. Hebrew RTL, dark mode. Deploy. Run the QA checklist.
- **Phase 4, Gamification:** XP, combos, goal, streaks, levels, badges, crowns, celebrations, sounds.
- **Phase 5, Rivalry and sync:** backend per 9.3, sync layer, rival card, league, duel, nudges, presence, `SETUP.md` finalized.
- **Phase 6, Extended features:** section 7.2, Tier A to 3,000 then 6,000, push notifications behind flag, share cards, desktop polish.
- **Phase 7, Hardening:** performance pass, bundle budget, accessibility pass, bidi test page, update flow, FSRS optimizer, content reports tooling, final QA.
- **Ongoing:** content passes (shards), backlog from `docs/BACKLOG.md`, section 7.3 ideas.

Conventions:
- Conventional commits. Small, frequent commits with meaningful messages.
- A `docs/ARCHITECTURE.md` explaining folders, data flow, sync and the engine, kept in sync with reality.
- `README.md`: what it is, live URL, how to install on iPhone (with screenshots you generate from the running app via Playwright), how to run locally, how to run content passes.

---

## 12. Decisions you make alone (examples, not an exhaustive list)
Framework details, state library, folder layout, exact XP numbers, badge list, color palette, fonts, icon design, voice selection logic, exact frequency source, the backend vendor, naming, copy, animation timings, which 7.3 ideas to ship. Document each in `docs/DECISIONS.md` and keep going.

## 13. Things you must never do
- Ask the owner a question or wait for approval.
- Leave `main` broken or undeployed.
- Use a paid service or anything that needs a credit card.
- Hard-cap the word pool or ship a "course" with a fixed end.
- Let theta jump quickly; the owner explicitly wants slow, trustworthy progression.
- Self-reported difficulty ratings as the main SRS signal.
- Ship English UI text where Hebrew was required, or Hebrew that reads like machine translation.
- Delete or silently migrate user data without a backup export path.
- Commit secrets.

## 14. Deliverables (what "finished" looks like)
1. Live PWA URL, installable on both phones, documented in `README.md` and `STATUS.md`.
2. Full source in the repository with green CI on `main`.
3. `SETUP.md` with the only owner actions ever needed (ideally: enable Pages once, create the free backend project once, paste two values once).
4. `STATUS.md` with the current state, what is waiting on the owner (if anything), and the QA checklist ticked.
5. `docs/` folder: DECISIONS, ARCHITECTURE, SCREENS, VOICE, QA_CHECKLIST, BACKLOG.
6. At least 3,000 Tier A words at first release and a mechanical path to grow to the whole inventory.
7. A product the owner opens every morning because it is a pleasure, not a chore.

Start now. Begin with Phase 0. Do not report back until Phase 0 is deployed; then keep going.
