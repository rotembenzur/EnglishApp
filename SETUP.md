# SETUP

Everything here is one-time. The app works fully in local mode without the optional parts.

## 1. Publish the app (done 2026-10-13)

The code lives on the branch `claude/trusting-knuth-gbbnzv`. The deploy job publishes the
repository's default branch to GitHub Pages, and Pages is not switched on yet.

1. Open https://github.com/rotembenzur/EnglishApp/settings
2. Under **Default branch**, click the switch-branches icon, choose `claude/trusting-knuth-gbbnzv`,
   and confirm with **Update**. (If you prefer a `main` branch, create `main` from
   `claude/trusting-knuth-gbbnzv` first and make `main` the default instead.)
3. Open https://github.com/rotembenzur/EnglishApp/settings/pages
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Open https://github.com/rotembenzur/EnglishApp/actions/workflows/ci.yml, click
   **Run workflow**, pick the default branch, and run it.
6. After about two minutes the app is live at https://rotembenzur.github.io/EnglishApp/

From then on every push to the default branch is tested and deployed automatically.

## 2. Install on both iPhones

1. Open https://rotembenzur.github.io/EnglishApp/ in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open LexBites from the home screen and pick your profile.

## 3. Sync for the two-player rivalry (server done 2026-10-13, one step left on each phone)

Done on the server: the Supabase project exists, `supabase/schema.sql` ran with your shared
passphrase, and the project URL and anon key are built into the app (`src/sync/config.ts`), so
neither phone needs them typed in. The anon key is public by design: without the passphrase every
table stays closed. The passphrase itself is not in the repository and must never be committed.

On each phone, once:

1. Open LexBites from the home screen. If **יש גרסה חדשה. לרענן?** shows, tap **לרענן**. At the
   bottom of **הגדרות** the version must be 0.3.1 or later.
2. Pick your profile, then open **הגדרות** and scroll to **סנכרון**.
3. Type the shared passphrase in **סיסמה משותפת** and tap **לחבר**.
4. A **מחובר** toast appears, the status next to **סנכרון** reads **מסונכרן**, and the dot at the top
   of the home screen turns green. Everything this phone practiced before is uploaded now.

If connecting fails, the message says why:

- **הסיסמה לא מתאימה**: the passphrase differs from the one in the SQL script (it is case
  sensitive). Type it again.
- **אין חיבור לשרת**: no internet, or the Supabase project is paused (free projects pause after
  a week without any use). Open https://supabase.com/dashboard, open the project, and tap
  **Restore project** if it shows.
- **החיבור נכשל**: the server answered with an error. Run `supabase/schema.sql` again in the SQL
  Editor. That is safe, and if the last line still says `CHANGE-ME` your passphrase is kept.

To change the passphrase later, run this in the SQL Editor with the new one, then connect both
phones again with it:

```sql
select lb_set_passphrase('new passphrase here');
```

The passphrase never leaves the phone in clear text: the app sends only a hash, and the database
accepts reads and writes only with the matching hash. **הגדרות**, **פרטי שרת (מתקדם)** shows the
built-in URL and key; change them only to move to a different Supabase project.

## 4. Push reminders (optional, later)

Push reminders are built behind a feature flag. They need a VAPID key pair and the sync backend.

1. Generate keys once: `npx web-push generate-vapid-keys` (on any computer with Node.js).
2. In the repository, open **Settings**, **Secrets and variables**, **Actions**:
   - add a **variable** `VITE_VAPID_PUBLIC_KEY` with the public key,
   - add **secrets** `VAPID_PRIVATE_KEY` (the private key), `SUPABASE_URL` and
     `SUPABASE_ANON_KEY` (the two values in `src/sync/config.ts`), and `LEXBITES_KEY_HASH` (shown
     in the app under **הגדרות**, **מזהה לתזכורות**, after connecting sync).
3. Push any commit (or re-run the workflow). The settings screen then shows **להפעיל התראות** on
   iPhones that run LexBites from the home screen (iOS 16.4 or later).
