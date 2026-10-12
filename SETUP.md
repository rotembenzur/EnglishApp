# SETUP

Everything here is optional or one-time. The app works fully in local mode without any of it.

## 1. GitHub Pages (one time, about one minute)

The deploy workflow enables Pages automatically through the GitHub API when it can. If the live URL
shows a 404:

1. Open https://github.com/rotembenzur/EnglishApp/settings/pages
2. Under "Build and deployment", set **Source** to **GitHub Actions**.
3. Open the Actions tab and re-run the latest "CI and deploy" workflow, or push any commit.

The workflow deploys the repository's default branch. If you later create `main` and make it the
default branch, deployments follow it automatically.

## 2. Sync backend for the two-player rivalry (optional, about five minutes, free)

Until this is done, each phone keeps its own data and the rival card shows "סנכרון לא מוגדר".

1. Go to https://supabase.com and sign in with GitHub (free tier, no credit card).
2. Create a new project. Any name and region. Wait for it to finish provisioning.
3. In the project, open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
4. Open **Project Settings** then **API**. Copy the **Project URL** and the **anon public** key.
5. In LexBites, open **הגדרות** then **סנכרון**, paste the URL and the key, and choose a shared
   passphrase (the same one on both phones).
6. Repeat step 5 on the second phone.

Details of the sync design are in `docs/ARCHITECTURE.md`.

## 3. Push notifications (optional, later)

Push reminders ship behind a feature flag and need a VAPID key pair plus a scheduled sender. The
exact steps will be added here when that phase is live.
