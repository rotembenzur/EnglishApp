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
  a week without any use; step 5 keeps it awake). Open https://supabase.com/dashboard, open the project, and tap
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

## 4. Push notifications (two GitHub secrets, then one switch on each phone)

Everything is built and tested: daily reminder at the time each of you picks, the 20:00
"streak at risk" alert, and rival nudges delivered as notifications even when LexBites is closed.
The server part runs on the same free Supabase project. It goes live as soon as these two secrets
exist; nothing else in GitHub or Supabase needs to be touched.

### 4a. Secret 1: `VAPID_PRIVATE_KEY`

The key pair was generated on 2026-10-13. The public half is in the repository
(`supabase/functions/_shared/keys.ts`); the private half was given to rotem in the chat of that
session and is not stored anywhere in the repository.

1. Open https://github.com/rotembenzur/EnglishApp/settings/secrets/actions
2. Click **New repository secret**.
3. **Name**: `VAPID_PRIVATE_KEY`
4. **Secret**: paste the private key (43 characters, letters, digits, `-` and `_`, no spaces).
5. Click **Add secret**.

If the private key is ever lost, a session can generate a new pair: it commits the new public key
and gives you the new private key; both phones then switch notifications off and on once.

### 4b. Secret 2: `SUPABASE_ACCESS_TOKEN`

This lets the workflow deploy the push function and its schedule to your Supabase project.

1. Open https://supabase.com/dashboard/account/tokens (sign in if asked).
2. Click **Generate new token**. Name it `lexbites-github`. If an expiry is offered, pick the
   longest one (or none).
3. Copy the token (it starts with `sbp_`). Supabase shows it only once.
4. Open https://github.com/rotembenzur/EnglishApp/settings/secrets/actions again.
5. Click **New repository secret**. **Name**: `SUPABASE_ACCESS_TOKEN`. **Secret**: paste the
   token. Click **Add secret**.

### 4c. Start it

1. Open https://github.com/rotembenzur/EnglishApp/actions/workflows/push-server.yml
2. Click **Run workflow**, keep the default branch, click the green **Run workflow**.
3. After about two minutes the run is green and its summary says **Push server is live**.
   (Skipping this is fine too: the workflow checks once a day and deploys by itself.)

If the run is red, its first failing step says why. The usual one is a mistyped
`VAPID_PRIVATE_KEY`: open the secret, click **Update secret**, paste it again, run again.

### 4d. On each iPhone (iOS 16.4 or later)

Notifications work only in the app opened from the home screen icon, not in a Safari tab.

1. Open LexBites from the home screen. If **יש גרסה חדשה. לרענן?** shows, tap **לרענן**. The
   version at the bottom of **הגדרות** must be 0.4.1 or later.
2. Sync must be connected on this phone (step 3).
3. **הגדרות**, scroll to **התראות**, turn on **התראות בטלפון הזה**.
4. iOS asks whether LexBites may send notifications: tap **Allow** (אפשר).
5. Pick the **שעת תזכורת**. Leave **הרצף בסכנה (20:00)** and the nudges switch on, or turn off what
   you do not want.
6. Tap **לשלוח התראת בדיקה** and lock the phone: the test notification arrives within seconds.

If the test fails, the toast ends with the push service's answer in brackets (for example
`403 BadJwtToken`); that text tells a session exactly what to fix.

If the settings show a message instead of the switch, it says what is missing:

- "התראות עובדות אחרי שמחברים את הסנכרון למעלה": do step 3 first.
- "באייפון, התראות עובדות רק כשפותחים את LexBites ממסך הבית": open it from the home screen icon.
- "שרת ההתראות עוד לא הופעל": steps 4a to 4c are not done yet, or the workflow run failed.
- "ההתראות חסומות": open iPhone **Settings**, **Notifications**, **LexBites**, turn on
  **Allow Notifications**, then come back and turn the switch on.

A Focus mode (Sleep, Work) can hold notifications back; allow LexBites in that Focus if needed.

## 5. Keeping the free Supabase project awake (nothing to do)

Free Supabase projects pause after about a week without activity, which would silently stop sync.
`.github/workflows/keepalive.yml` makes real requests every 2 days (a small write that only stamps
a time, plus reads), with no secret needed. If a run ever fails, GitHub emails a notice; open
https://supabase.com/dashboard, open the project and tap **Restore project** if it shows.
