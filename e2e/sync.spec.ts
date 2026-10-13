import { createECDH, createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Two phones against a real PostgREST running supabase/schema.sql (SETUP.md step 3 describes the
 * hosted project). The app is built with its normal config, so it talks to the Supabase project
 * URL with the built-in anon key; each request is forwarded to the local PostgREST with a locally
 * signed anon token. Skipped unless the backend is provided:
 *   LEXBITES_SYNC_REST=http://127.0.0.1:54330 LEXBITES_SYNC_JWT_SECRET=... LEXBITES_SYNC_PASS=...
 * The push test also needs the lexbites-push Edge Function served locally with Deno, pointed at
 * the same database (SUPABASE_URL to a gateway in front of PostgREST, VAPID_PRIVATE_KEY set):
 *   LEXBITES_PUSH_FN=http://127.0.0.1:8000/
 */
const REST = process.env.LEXBITES_SYNC_REST;
const SECRET = process.env.LEXBITES_SYNC_JWT_SECRET;
const PASS = process.env.LEXBITES_SYNC_PASS;
const PUSH_FN = process.env.LEXBITES_PUSH_FN;
const PROJECT = /^https:\/\/ngosxhpmudbgiiktqgoa\.supabase\.co\/rest\/v1\//;
const FUNCTION = /^https:\/\/ngosxhpmudbgiiktqgoa\.supabase\.co\/functions\/v1\/lexbites-push/;
const EXTERNAL = /dictionaryapi\.dev|mymemory\.translated\.net|translate\.googleapis\.com/;

test.skip(!REST || !SECRET || !PASS, 'needs a PostgREST backend (see the comment at the top)');
test.setTimeout(300_000);

function anonJwt(secret: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', exp: 4102444800 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

async function phone(browser: Browser, seen: Set<string>) {
  const ctx = await browser.newContext({
    ...devices['iPhone 14'],
    locale: 'he-IL',
    baseURL: 'http://localhost:4173/',
  });
  await ctx.route(EXTERNAL, (r) => r.abort());
  const token = anonJwt(SECRET!);
  await ctx.route(PROJECT, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    seen.add(req.headers()['apikey'] ?? '');
    const headers: Record<string, string> = { ...req.headers(), authorization: `Bearer ${token}` };
    delete headers['apikey'];
    const res = await route.fetch({
      url: `${REST}${url.pathname.replace('/rest/v1', '')}${url.search}`,
      headers,
    });
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'access-control-allow-origin': '*' },
    });
  });
  // The push server: the local Deno function when given, otherwise "not deployed".
  await ctx.route(FUNCTION, async (route) => {
    if (!PUSH_FN) return route.fulfill({ status: 404, body: '{"code":"NOT_FOUND"}' });
    const res = await route.fetch({ url: PUSH_FN });
    await route.fulfill({ response: res });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()))
      errors.push(m.text());
  });
  return { ctx, page };
}

const errors: string[] = [];

async function finishPlacement(page: Page, pattern: 'high' | 'low') {
  await page.getByRole('button', { name: 'למבחן רמה' }).click();
  await page.getByRole('button', { name: 'מתחילים' }).click();
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole('button', { name: 'יאללה, ללמוד' }).isVisible()) break;
    const know = page.getByRole('button', { name: 'מכיר', exact: true });
    if (await know.isVisible()) {
      if (pattern === 'low') await page.getByRole('button', { name: 'לא מכיר' }).click();
      else await (i % 3 === 2 ? page.getByRole('button', { name: 'לא מכיר' }) : know).click();
    } else {
      await page
        .locator('#root')
        .getByRole('button')
        .last()
        .click({ timeout: 3000 })
        .catch(() => undefined);
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(80);
  }
  await page.getByRole('button', { name: 'יאללה, ללמוד' }).click();
}

/** Answer whatever is on screen until the summary shows (or the step budget runs out). */
async function playSession(page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    if (
      await page
        .getByText('סיימת סשן')
        .isVisible()
        .catch(() => false)
    )
      return;
    const got = page.getByRole('button', { name: 'הבנתי' });
    const next = page.getByRole('button', { name: 'הבא' });
    const input = page.locator('input[lang="en"], input.en');
    const opts = page.locator('button.tap.rounded-2xl.border-2:not([disabled])');
    if (await got.isVisible().catch(() => false)) await got.click();
    else if (await next.isVisible().catch(() => false)) await next.click();
    else if (
      await input
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await input.first().fill('test');
      await page.keyboard.press('Enter');
    } else if (await opts.count()) await opts.first().click();
    await page.waitForTimeout(900);
  }
}

async function connect(page: Page, pass: string) {
  await page.goto('/settings#sync');
  await page.getByLabel('סיסמה משותפת').fill(pass);
  await page.getByRole('button', { name: 'לחבר', exact: true }).click();
}

/** What this phone has stored for a profile's today row (XP) and its duel result. */
function localFacts(page: Page, user: string) {
  return page.evaluate(async (u) => {
    const req = indexedDB.open('lexbites');
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all = <T>(store: string) =>
      new Promise<T[]>((res) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result as T[]);
      });
    const daily = (await all<{ userId: string; xp: number }>('dailyStats')).filter(
      (d) => d.userId === u,
    );
    const events = (await all<{ userId: string; type: string }>('events')).filter(
      (e) => e.userId === u,
    );
    return {
      xp: daily.reduce((a, d) => a + d.xp, 0),
      duels: events.filter((e) => e.type === 'duel').length,
      nudges: events.filter((e) => e.type === 'nudge').length,
    };
  }, user);
}

test('[sync] two phones: connect, rival card, weekly league, daily duel and nudges', async ({
  browser,
}) => {
  const seenKeys = new Set<string>();
  const a = await phone(browser, seenKeys); // rotem's phone
  const b = await phone(browser, seenKeys); // noa's phone

  // Phone A: some practice before sync exists, so connecting has to upload history.
  await a.page.goto('/welcome');
  await a.page.getByRole('button', { name: /רתם/ }).click();
  await finishPlacement(a.page, 'high');
  await a.page.getByRole('button', { name: /ללמוד/ }).first().click();
  await playSession(a.page, 14);

  // A wrong passphrase is refused with its own message and nothing is saved.
  await connect(a.page, `${PASS}-wrong`);
  await expect(a.page.getByText('הסיסמה לא מתאימה')).toBeVisible();
  await expect(a.page.getByTestId('sync-status')).toHaveText('לא מוגדר');

  await connect(a.page, PASS!);
  await expect(a.page.getByText('מחובר', { exact: true })).toBeVisible();
  await expect(a.page.getByTestId('sync-status')).toHaveText('מסונכרן', { timeout: 30_000 });

  // Daily duel and a nudge from A.
  await a.page.goto('/session/duel');
  await playSession(a.page, 40);
  await expect(a.page.getByText('סיימת סשן')).toBeVisible();
  await a.page.goto('/rivalry');
  await expect(a.page.getByText('מחכים לתוצאה של הצד השני')).toBeVisible();
  await a.page.getByRole('button', { name: 'nudge 👋' }).click();
  await expect(a.page.getByText('נשלח', { exact: true })).toBeVisible();
  await a.page.waitForTimeout(1500);
  const aFacts = await localFacts(a.page, 'rotem');
  expect(aFacts.xp).toBeGreaterThan(0);

  // Phone B: fresh install, connects with the passphrase only.
  await b.page.goto('/welcome');
  await b.page.getByRole('button', { name: /נועה/ }).click();
  await finishPlacement(b.page, 'low');
  await connect(b.page, PASS!);
  await expect(b.page.getByTestId('sync-status')).toHaveText('מסונכרן', { timeout: 30_000 });
  // The nudge arrives as a toast.
  await expect(b.page.getByText('רתם שלח לך 👋')).toBeVisible({ timeout: 15_000 });
  // Rival card on home.
  await b.page.goto('/');
  await expect(b.page.getByText('רתם כבר התאמן היום')).toBeVisible({ timeout: 15_000 });
  // B holds the same numbers for rotem that A has.
  expect(await localFacts(b.page, 'rotem')).toEqual(aFacts);
  // Weekly league on B shows A's XP.
  await b.page.goto('/rivalry');
  await expect(b.page.getByText(`${aFacts.xp} XP`).first()).toBeVisible();

  // B plays the same duel and sees the result; B nudges back.
  await b.page.goto('/session/duel');
  await playSession(b.page, 40);
  await expect(b.page.getByText('סיימת סשן')).toBeVisible();
  await b.page.goto('/rivalry');
  await expect(
    b.page.getByText(/ניצחת בדו־קרב היום|הפסדת בדו־קרב היום|תיקו בדו־קרב/),
  ).toBeVisible();
  await b.page.getByRole('button', { name: 'nudge 🔥' }).click();
  await b.page.waitForTimeout(1500);
  const bFacts = await localFacts(b.page, 'noa');

  // Back on A: reopening the app pulls B's duel, XP and nudge.
  await a.page.goto('/rivalry');
  await expect(a.page.getByText('נועה שלחה לך 🔥')).toBeVisible({ timeout: 15_000 });
  await expect(
    a.page.getByText(/ניצחת בדו־קרב היום|הפסדת בדו־קרב היום|תיקו בדו־קרב/),
  ).toBeVisible();
  expect(await localFacts(a.page, 'noa')).toEqual(bFacts);
  await expect(a.page.getByText(`${bFacts.xp} XP`).first()).toBeVisible();

  // Every request carried the anon key from the app config, nothing else.
  expect(seenKeys.size).toBe(1);
  expect([...seenKeys][0]).toMatch(/^eyJ/);
  expect(errors).toEqual([]);
  await Promise.all([a.ctx.close(), b.ctx.close()]);
});

test('[sync] push notifications: availability, enable, choices, test push, disable', async ({
  browser,
}) => {
  test.skip(!PUSH_FN, 'needs the lexbites-push function served locally (see the top comment)');
  // A push service stand-in that decrypts what the server sends to this "phone".
  const ece = createRequire(import.meta.url)('http_ece') as {
    decrypt(b: Buffer, p: object): Buffer;
  };
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const received: { title: string; body: string; kind: string }[] = [];
  const service = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const plain = ece.decrypt(Buffer.concat(chunks), {
        version: 'aes128gcm',
        privateKey: ua,
        authSecret: auth.toString('base64url'),
      });
      received.push(JSON.parse(plain.toString()));
      res.writeHead(201);
      res.end();
    });
  });
  await new Promise<void>((r) => service.listen(54334, '127.0.0.1', r));
  const sub = {
    endpoint: `http://127.0.0.1:54334/push/${randomBytes(6).toString('hex')}`,
    keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };

  const a = await phone(browser, new Set());
  // Headless Chromium has no push service: stand in for PushManager with the subscription above.
  await a.ctx.grantPermissions(['notifications']);
  await a.ctx.addInitScript((s) => {
    // Like a real phone, the subscription outlives a reload.
    const make = () => ({
      endpoint: s.endpoint,
      options: { applicationServerKey: null },
      toJSON: () => ({ endpoint: s.endpoint, expirationTime: null, keys: s.keys }),
      unsubscribe: async () => {
        localStorage.removeItem('e2e-push-sub');
        return true;
      },
    });
    PushManager.prototype.subscribe = async function () {
      localStorage.setItem('e2e-push-sub', '1');
      return make() as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async function () {
      return localStorage.getItem('e2e-push-sub') ? (make() as unknown as PushSubscription) : null;
    };
  }, sub);
  const pushRow = () =>
    fetch(`${REST}/lb_push?endpoint=eq.${encodeURIComponent(sub.endpoint)}&select=user_id,data`, {
      headers: {
        authorization: `Bearer ${anonJwt(SECRET!)}`,
        'x-lexbites-key': createHash('sha256').update(`lexbites:${PASS}`).digest('hex'),
      },
    }).then((r) => r.json() as Promise<{ user_id: string; data: Record<string, unknown> }[]>);

  await a.page.goto('/welcome');
  await a.page.getByRole('button', { name: /רתם/ }).click();
  await finishPlacement(a.page, 'high');

  // Before sync is connected the section explains what is missing.
  await a.page.goto('/settings');
  await expect(a.page.getByTestId('push-status')).toHaveText(/אחרי שמחברים את הסנכרון/);

  await connect(a.page, PASS!);
  await expect(a.page.getByTestId('sync-status')).toHaveText('מסונכרן', { timeout: 30_000 });
  const toggle = a.page.getByRole('switch', { name: 'התראות בטלפון הזה' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(a.page.getByText('ההתראות פועלות')).toBeVisible();
  await expect.poll(async () => (await pushRow())[0]?.data.reminderTime).toBe('20:00');
  const row = (await pushRow())[0]!;
  expect(row.user_id).toBe('rotem');
  expect(row.data).toMatchObject({ userId: 'rotem', streakAlert: true, nudges: true });
  expect(typeof row.data.tz).toBe('string');

  // Choices are saved to the server.
  await a.page.locator('input[type="time"]').fill('07:45');
  await expect
    .poll(async () => (await pushRow())[0]?.data.reminderTime, { timeout: 10_000 })
    .toBe('07:45');
  await a.page.getByRole('switch', { name: 'נקירות מנועה' }).click();
  await expect.poll(async () => (await pushRow())[0]?.data.nudges).toBe(false);

  // A test notification goes through the server, encrypted for this phone.
  await a.page.getByRole('button', { name: /לשלוח התראת בדיקה/ }).click();
  await expect(a.page.getByText('נשלחה. היא אמורה להגיע תוך כמה שניות')).toBeVisible();
  expect(received.at(-1)).toMatchObject({ kind: 'test', title: 'LexBites' });

  // The choice survives a reload.
  await a.page.reload();
  await expect(a.page.getByRole('switch', { name: 'התראות בטלפון הזה' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Turning off removes the subscription from the server.
  await a.page.getByRole('switch', { name: 'התראות בטלפון הזה' }).click();
  await expect.poll(async () => (await pushRow()).length).toBe(0);

  expect(errors).toEqual([]);
  await a.ctx.close();
  service.close();
});
