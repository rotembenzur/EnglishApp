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

## 3. Sync for the two-player rivalry (optional, about five minutes, free)

Until this is done, each phone keeps its own data and the rival card shows "סנכרון לא מוגדר".

1. Go to https://supabase.com and sign in with GitHub (free tier, no credit card).
2. Create a new project. Any name and region. Wait for it to finish provisioning.
3. Open **SQL Editor**, paste the whole of `supabase/schema.sql` from this repository.
4. On the last line, replace `CHANGE-ME` with a passphrase you choose. Run the script.
5. Open **Project Settings**, then **API**. Copy the **Project URL** and the **anon public** key.
6. In LexBites on the first phone: **הגדרות**, then **סנכרון**. Paste the URL and the key, type the
   passphrase, and tap **לחבר**. A green dot means it worked.
7. Repeat step 6 on the second phone with the same three values.

The passphrase never leaves the phone in clear text: the app sends only a hash, and the database
accepts reads and writes only with the matching hash.

## 4. Push reminders (optional, later)

Push reminders are built behind a feature flag. They need a VAPID key pair and the sync backend.

1. Generate keys once: `npx web-push generate-vapid-keys` (on any computer with Node.js).
2. In the repository, open **Settings**, **Secrets and variables**, **Actions**:
   - add a **variable** `VITE_VAPID_PUBLIC_KEY` with the public key,
   - add **secrets** `VAPID_PRIVATE_KEY` (the private key), `SUPABASE_URL`, `SUPABASE_ANON_KEY`
     and `LEXBITES_KEY_HASH` (shown in the app under **הגדרות** after connecting sync).
3. Push any commit (or re-run the workflow). The settings screen then shows **להפעיל התראות** on
   iPhones that run LexBites from the home screen (iOS 16.4 or later).
