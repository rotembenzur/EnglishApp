# QA checklist

Run on a real iPhone before marking a phase done. Tick the matching items in `STATUS.md` with the
date.

## Install and shell

- [ ] Open the live URL in Safari, Share, Add to Home Screen. Icon and name "LexBites" look right.
- [ ] Opens full screen, no Safari chrome, status bar area is safe.
- [ ] Turn on airplane mode, reopen from the home screen: app loads and the home screen works.
- [ ] Rotate: layout stays portrait friendly, nothing clipped under the notch or home indicator.
- [ ] No rubber banding on the shell; only content panes scroll.

## Learning flow

- [ ] Profile picker shows both profiles; picking one is remembered after relaunch.
- [ ] Placement finishes in under 3 minutes and shows a sensible band.
- [ ] A standard session has about 20 items, mixes types, and has typing at least every 5th item.
- [ ] Typing input does not zoom the page, Enter submits, autocorrect is off.
- [ ] Wrong answers show the full word card with audio.
- [ ] Exiting mid-session and returning keeps per-item progress.

## Audio

- [ ] Word audio plays in standalone mode after the first tap.
- [ ] Sentence audio plays through speechSynthesis with an English voice.
- [ ] Tap-and-hold plays slowly.

## RTL and bidi

- [ ] Hebrew text aligns right; English words, IPA and sentences render LTR and left aligned.
- [ ] Mixed sentences in the dev bidi page look right, including numbers and punctuation at edges.
- [ ] Back and next icons mirror.

## Theme

- [ ] Dark, light and auto all render; no flash of the wrong theme on launch.
- [ ] rotem and noa have distinct accents.

## Two profiles and sync

- [ ] Same URL installed on two phones, each with a different profile.
- [ ] With sync configured, the rival card updates within a minute of the other user's session.
- [ ] Nudges arrive as a toast on the next open.
- [ ] Sync dot shows green, grey offline, orange pending.

## Data safety

- [ ] Export JSON downloads; import of that file restores everything.
- [ ] Reset asks twice and exports a backup first.
