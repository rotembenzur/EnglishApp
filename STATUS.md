# STATUS

**Live URL:** https://rotembenzur.github.io/EnglishApp/

Last updated: 2026-10-12

## Live now

- Phase 0, Foundation: PWA shell (manifest, service worker, icons, iOS splash), Hebrew RTL layout
  with dark and light themes, bottom tab bar, "coming soon" home with install instructions, CI that
  lints, typechecks, tests, builds and deploys to GitHub Pages.

## Next

- Phase 1, Content backbone: 50k+ lemma inventory with difficulty, content schema, first Tier A
  shards, enrich script, Tier B runtime enrichment, audio layer.
- Phase 2, Engine: placement, ability estimation, new-word selection, FSRS scheduling, session
  composer, exercise builders, unit tests.

## Waiting on owner

- Nothing blocking. See `SETUP.md` for the one-time GitHub Pages check and the optional sync backend.

## QA checklist

Run from `docs/QA_CHECKLIST.md`; ticked items carry the date they were last verified.

- [ ] Installs on iPhone from Safari and opens full screen
- [ ] Works offline after first load
- [ ] Audio plays in standalone mode
- [ ] RTL layout and bidi strings look right
- [ ] Dark and light mode
- [ ] Two profiles on two phones
- [ ] Sync and rival card
- [ ] Export and import round trip
