import { createHmac } from 'node:crypto';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Two phones against a real PostgREST running supabase/schema.sql (SETUP.md step 3 describes the
 * hosted project). The app is built with its normal config, so it talks to the Supabase project
 * URL with the built-in anon key; each request is forwarded to the local PostgREST with a locally
 * signed anon token. Skipped unless the backend is provided:
 *   LEXBITES_SYNC_REST=http://127.0.0.1:54330 LEXBITES_SYNC_JWT_SECRET=... LEXBITES_SYNC_PASS=...
 */
const REST = process.env.LEXBITES_SYNC_REST;
const SECRET = process.env.LEXBITES_SYNC_JWT_SECRET;
const PASS = process.env.LEXBITES_SYNC_PASS;
const PROJECT = /^https:\/\/ngosxhpmudbgiiktqgoa\.supabase\.co\/rest\/v1\//;
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
