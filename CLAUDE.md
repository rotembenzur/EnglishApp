# CLAUDE.md

Read these first, every session:

1. `LEXBITES_SPEC.md`: the original prompt and full product specification, including the
   autonomy contract (section 0). Follow it: decide alone, record decisions in `docs/DECISIONS.md`,
   never leave the deployed app broken.
2. `STATUS.md`: what is live, what is waiting on the owner, what is next.
3. `SETUP.md`, `docs/DECISIONS.md` and `docs/ARCHITECTURE.md` when the task touches setup, sync,
   push or deployment.

## Hard rules

- **Never print, sample or display raw word lists or data files** (`content/lemmas.json`,
  `content/shards/`, `content/curated/`, `content/placement.json`, `content/confusables.json`,
  `content/families.json`, `public/content/`, the downloaded source lists in `scripts/.cache`).
  Report only counts and sizes. Use `jq length`, `wc -c` or a script that prints totals.
- **The repository is public. Never commit the sync passphrase, the VAPID private key, a Supabase
  access token or any other secret.** Only these are public by design and live in the repo: the
  Supabase project URL and anon key (`src/sync/config.ts`) and the VAPID public key. Secrets live in
  GitHub repository secrets (see `SETUP.md`) and are passed to Supabase by CI.
- The owner's name is rotem (רתם in Hebrew, never with a ו). Hebrew UI copy follows `docs/VOICE.md`.
- No paid services, no credit cards (spec 0.9). No analytics.

## Branches and deploys

- The default branch is `claude/trusting-knuth-gbbnzv`. Every push to it runs
  `.github/workflows/ci.yml` (lint, typecheck, content validation, unit tests, build, Playwright)
  and then deploys to GitHub Pages: https://rotembenzur.github.io/EnglishApp/
- A session may be told to develop on another branch. Push the work there, and once the same
  checks pass locally, fast-forward the default branch to it
  (`git push origin HEAD:claude/trusting-knuth-gbbnzv`) so it deploys. Never force-push the default
  branch.
- Run before pushing: `pnpm lint && pnpm typecheck && pnpm content:validate && pnpm test && pnpm build`
  and `pnpm test:e2e` (Playwright uses the preinstalled Chromium locally).

## Verifying a deploy

1. Check the "CI and deploy" run for the pushed commit on the default branch (GitHub MCP tools:
   `actions_list` / `actions_get`); all three jobs (verify, e2e, deploy) must be green.
2. Open the live site: `curl -s https://rotembenzur.github.io/EnglishApp/` and fetch the hashed
   `assets/index-*.js` it references; the new version string from `package.json` must be in the
   built JS. For a real check, load it in Playwright's Chromium and assert zero console errors.
3. The version is also shown at the bottom of **הגדרות** in the app.

## Backend facts

- Supabase project `ngosxhpmudbgiiktqgoa`. Tables `lb_*` from `supabase/schema.sql` (run by the
  owner). Every table is closed by RLS unless the `x-lexbites-key` header carries
  sha256('lexbites:' + passphrase). Without the passphrase you can still verify the backend is up:
  selects return `[]` with status 200, writes return 401, `rpc/lb_authorized` returns `false`.
- Push notifications: Supabase Edge Function `lexbites-push` plus `supabase/push.sql` (pg_cron and
  a nudge trigger), deployed by `.github/workflows/push-server.yml` using GitHub secrets. Keepalive:
  `.github/workflows/keepalive.yml`.

## Lessons learned

- This container's network is policy-limited. Allowed now: `rotembenzur.github.io`, `*.supabase.co`,
  `api.dictionaryapi.dev`, `translate.googleapis.com` (it often answers 429 to this container's IP).
  Blocked: `api.mymemory.translated.net`, `api.supabase.com`, push services such as
  `web.push.apple.com`. Check with `curl -sS "$HTTPS_PROXY/__agentproxy/status"`.
- e2e tests block third-party APIs by default; with real dictionary APIs reachable, session start
  used to wait on network and raced the test (fixed in 0.3.0, guarded by an `[online]` test).
- Sync pulls re-read a two-minute overlap behind the cursor, because `server_at` is stamped inside
  the writing transaction and a late commit can land behind the other phone's cursor.
- Never delete or renumber inventory entries: lemma ids and shard membership are by rank. Mark
  non-teachable entries instead (see `docs/DECISIONS.md`, content).
- Opening a deep link cold on GitHub Pages (for example `/EnglishApp/settings`) answers HTTP 404
  through the `404.html` bounce by design; judge console errors on the real site with that in mind.
- Every schema change ships with a migration; export/import must keep working (spec 0.10).
- Apple's push service is unreachable from this container, but the deployed function can reach it:
  `curl -s https://ngosxhpmudbgiiktqgoa.supabase.co/functions/v1/lexbites-push?probe=1` shows the
  encryption self-test and Apple's verdict on our token (`real` must be `400 BadDeviceToken`).
  Each subscription's last delivery answer is in `lb_push.state.lastResult`.
- The function deploys only through `.github/workflows/push-server.yml` (pushes to the default
  branch that touch `supabase/functions/**`); bump `VERSION` in the function to see the new one live.
- GitHub disables scheduled workflows in public repos after 60 days without commits; the keepalive
  workflow re-enables the scheduled workflows on every run.
