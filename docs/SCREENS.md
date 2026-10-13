# Screens

One paragraph of purpose and the key elements per screen. Routes are relative to the app base.

1. **Profile picker** (`/welcome`). First launch and profile switching. Two large cards, רתם and נועה,
   each in its own accent color, with the last-seen time and today's XP. Optional 4-digit PIN entry.
   Remembers the choice per device.
2. **Placement** (`/placement`). A two to three minute game that finds the starting level. Intro
   card, then one word at a time with "מכיר / לא בטוח / לא מכיר", every third item verified by a
   four-option meaning check, progress dots, result screen with band reveal and a progress bar
   inside the band.
3. **Home** (`/`). The daily launch pad. Daily goal ring with XP, streak flame with record, rival
   card (words today, XP today, streak, trained today or not), start buttons (למידה, חזרות, מילים
   קשות, סיבוב מהיר, מצב האזנה), word of the day, one-tap cap suggestions, sync dot. Once the
   day's new words are in, a card says so and offers **עוד 5 מילים חדשות** (today only).
4. **Session** (`/session/:kind`). The item view. Thin progress bar on top, exit button with
   confirmation only when mid-item, one exercise at a time with instant feedback and the full word
   card on mistakes, combo indicator, typing input that never zooms on iOS.
5. **Session summary** (shown at the end of `/session/:kind`). The win screen. XP earned, accuracy, new words, words
   strengthened, rival comparison for today, "word of the session" with audio, continue buttons.
6. **Word detail** (`/word/:id`). Everything about one word. Word in display font, IPA, POS, audio
   (tap, hold for slow), Hebrew meanings, sentences with Hebrew and audio, collocations, family,
   crowns, next review, notes and mnemonic, favorite, ignore, report.
7. **Library** (`/words`). Search in English and Hebrew, filters (new, learning, mastered, favorites,
   ignored, leeches, topic, band), sort by due date, crown distribution, next review time per word.
8. **Stats** (`/stats`). Words known by band, level over time, retention over time, review heatmap,
   minutes per day, accuracy by exercise type, due forecast for 14 days, raw theta for the curious.
9. **Rivalry** (`/rivalry`). Weekly league bar chart, trophy and all-time record, daily duel, nudges,
   rival profile (read-only stats), shared milestones.
10. **Settings** (`/settings`). Daily goal, new words per day, accent and voice, speed, sounds, theme,
    PIN, retake placement, topics, export, import, rebuild from log, reset with double confirmation
    and automatic backup, sync status and configuration, version.
11. **Today card** (`/today`). A compact read-only card with the goal ring, streak and rival line,
    meant as a Safari start page bookmark.
12. **Offline and update states**. Toasts: offline ready, new version available (never forces a
    reload mid-session), sync pending or offline.
