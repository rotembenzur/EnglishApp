/**
 * RTL/bidi review screenshots (spec 8.3): every screen and state on an iPhone 14 viewport, for
 * both profiles, light and dark. Sync is simulated (Supabase answers empty, the rival's day, a
 * nudge and last week's league are seeded locally) so the rival card, league, toasts and
 * settings show real mixed-direction text. Review every image for visual order problems.
 *
 * Run: pnpm build && pnpm preview (other terminal), then: pnpm tsx scripts/bidi-screens.ts <outDir>
 */
import { chromium, devices, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = (process.env.SHOT_BASE ?? 'http://localhost:4173/').replace(/\/$/, '');
const outDir = process.argv[2] ?? 'bidi-screens';
const localChromium = '/opt/pw-browsers/chromium';
const DAY = 86_400_000;

type User = 'rotem' | 'noa';
const NAME: Record<User, string> = { rotem: 'רתם', noa: 'נועה' };

async function mockBackend(ctx: BrowserContext) {
  // tsx keeps function names with a __name helper that page.evaluate code does not have.
  await ctx.addInitScript('window.__name = (f) => f;');
  await ctx.route(/supabase\.co\/functions\//, (r) =>
    r.fulfill({ status: 404, body: '{"code":"NOT_FOUND"}' }),
  );
  await ctx.route(/supabase\.co\/rest\//, async (r) => {
    const req = r.request();
    if (req.url().includes('/rpc/')) return r.fulfill({ status: 200, body: 'true' });
    if (req.method() === 'GET')
      return r.fulfill({ status: 200, body: '[]', contentType: 'application/json' });
    return r.fulfill({ status: 201, body: '[]', contentType: 'application/json' });
  });
  await ctx.route(/dictionaryapi|googleapis|mymemory/, (r) => r.abort());
}

/** Seeds the rival's activity, last week's league and a nudge straight into IndexedDB. */
async function seed(page: Page, me: User) {
  const rival: User = me === 'rotem' ? 'noa' : 'rotem';
  await page.evaluate(
    async ({ me, rival, DAY }) => {
      const key = (ts: number) => {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('lexbites');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction(['kv', 'dailyStats', 'events', 'presence'], 'readwrite');
      const now = Date.now();
      tx.objectStore('kv').put({ key: 'syncConfig', value: { keyHash: 'x'.repeat(64) } });
      const day = (userId: string, ts: number, xp: number) =>
        tx.objectStore('dailyStats').put({
          userId,
          date: key(ts),
          xp,
          newWords: Math.round(xp / 12),
          reviews: Math.round(xp / 6),
          correct: Math.round(xp / 7),
          ms: 6 * 60_000,
          sessions: 1,
          goal: 60,
          goalReached: xp >= 60,
          updatedAt: now,
          deviceId: 'seed',
        });
      for (let i = 1; i <= 12; i++) {
        day(rival, now - i * DAY, 40 + ((i * 37) % 90));
        day(me, now - i * DAY, 30 + ((i * 53) % 100));
      }
      day(rival, now, 1250);
      tx.objectStore('presence').put({
        userId: rival,
        lastSeenAt: now - 20 * 60_000,
        inSession: false,
        updatedAt: now,
        deviceId: 'seed',
      });
      tx.objectStore('events').put({
        id: `seed-nudge-${now}`,
        userId: rival,
        type: 'nudge',
        to: me,
        payload: { emoji: '👋' },
        at: now - 60_000,
        deviceId: 'seed',
      });
      for (const [userId, correct, ms] of [
        [me, 7, 7200],
        [rival, 6, 8100],
      ] as const)
        tx.objectStore('events').put({
          id: `seed-duel-${userId}-${now}`,
          userId,
          type: 'duel',
          payload: { date: key(now), correct, ms },
          at: now - 3600_000,
          deviceId: 'seed',
        });
      await new Promise((res) => (tx.oncomplete = res));
      db.close();
    },
    { me, rival, DAY },
  );
}

async function scrollPane(page: Page, to: 'bottom' | number) {
  await page.evaluate((to) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.scroll-pane'))) {
      el.scrollTop = to === 'bottom' ? el.scrollHeight : to;
    }
  }, to);
  await page.waitForTimeout(250);
}

async function shotsAlongPane(page: Page, shot: (n: string) => Promise<void>, name: string) {
  const height = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('main.scroll-pane, .scroll-pane');
    return el ? { h: el.scrollHeight, v: el.clientHeight } : { h: 0, v: 1 };
  });
  const pages = Math.min(8, Math.max(1, Math.ceil(height.h / Math.max(1, height.v - 80))));
  for (let i = 0; i < pages; i++) {
    await scrollPane(page, i * (height.v - 80));
    await shot(`${name}-${i + 1}`);
  }
  await scrollPane(page, 0);
}

async function placement(page: Page, shot: (n: string) => Promise<void>) {
  await page.getByRole('button', { name: 'למבחן רמה' }).click();
  await page.waitForTimeout(400);
  await shot('03-placement-intro');
  await page.getByRole('button', { name: 'מתחילים' }).click();
  await page.waitForTimeout(400);
  await shot('04-placement-item');
  let checkShot = false;
  for (let i = 0; i < 45; i++) {
    if (await page.getByRole('button', { name: 'יאללה, ללמוד' }).isVisible()) break;
    const know = page.getByRole('button', { name: 'מכיר', exact: true });
    if (await know.isVisible()) {
      await (i % 4 === 3 ? page.getByRole('button', { name: 'לא מכיר' }) : know).click();
    } else {
      if (!checkShot) await shot('05-placement-check');
      checkShot = true;
      await page.locator('#root').getByRole('button').last().click();
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(400);
  await shot('06-placement-result');
  await page.getByRole('button', { name: 'יאללה, ללמוד' }).click();
  await page.waitForTimeout(700);
}

/** Runs a session, photographing each new exercise kind and a wrong answer for each. */
async function session(
  page: Page,
  shot: (n: string) => Promise<void>,
  route: string,
  tag: string,
  seen: Set<string>,
) {
  await page.goto(base + route);
  await page
    .locator('[aria-busy="true"]')
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => undefined);
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(450);
    if (
      await page
        .getByText(/סיימת סשן|סשן מושלם/)
        .isVisible()
        .catch(() => false)
    )
      break;
    if (
      await page
        .getByText('אין כרגע מה לתרגל כאן')
        .isVisible()
        .catch(() => false)
    ) {
      await shot(`${tag}-empty`);
      return;
    }
    // allTextContents does not wait: intro cards have no prompt line.
    const prompt = (
      await page.locator('p.text-center.text-sm.font-semibold').allTextContents()
    ).join(' ');
    const kind = (await page
      .getByRole('button', { name: 'הבנתי' })
      .isVisible()
      .catch(() => false))
      ? 'intro'
      : prompt.includes('זוגות')
        ? 'match'
        : prompt.includes('השלימו')
          ? 'cloze'
          : prompt.includes('כתבו')
            ? 'typing'
            : prompt.includes('שומעים')
              ? 'spell-audio'
              : prompt.includes('מקשיבים')
                ? 'listening'
                : prompt.includes('איזו מילה')
                  ? 'he-en'
                  : prompt.includes('מה הפירוש')
                    ? 'en-he'
                    : '';
    const first = kind && !seen.has(kind);
    if (first) {
      seen.add(kind);
      await shot(`${tag}-${kind}`);
    }
    const got = page.getByRole('button', { name: 'הבנתי' });
    const next = page.getByRole('button', { name: 'הבא' });
    const input = page.locator('input.en');
    const opts = page.locator('button.tap.rounded-2xl.border-2:not([disabled])');
    if (await next.isVisible().catch(() => false)) {
      await next.click();
    } else if (await got.isVisible().catch(() => false)) {
      await got.click();
    } else if (
      await input
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await input.first().fill(first ? 'wrogn' : 'x');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(600);
      if (first) await shot(`${tag}-${kind}-wrong`);
    } else if (kind === 'match') {
      const left = page.locator('div[dir="ltr"] > button:not([disabled])');
      const right = page.locator('div.grid-cols-2 > div:not([dir]) > button:not([disabled])');
      if ((await left.count()) && (await right.count())) {
        await left.first().click();
        await right.last().click();
      } else await page.waitForTimeout(400);
    } else if (await opts.count()) {
      await opts.last().click();
      await page.waitForTimeout(700);
      if (first && (await next.isVisible().catch(() => false))) await shot(`${tag}-${kind}-wrong`);
    }
  }
  await page.waitForTimeout(900);
  await shot(`${tag}-summary`);
  await shotsAlongPane(page, shot, `${tag}-summary-scroll`);
}

async function flow(page: Page, me: User, shot: (n: string) => Promise<void>) {
  await page.goto(`${base}/welcome`);
  await page.waitForTimeout(600);
  await shot('01-welcome');
  await page.getByRole('button', { name: new RegExp(NAME[me]) }).click();
  await page.waitForTimeout(500);
  await shot('02-home-new');
  await placement(page, shot);
  await seed(page, me);
  await page.reload();
  await page.waitForTimeout(1500);
  await shot('07-home-toast');
  await page.waitForTimeout(5500);
  await shotsAlongPane(page, shot, '08-home');

  const seen = new Set<string>();
  await session(page, shot, '/session/learn', '10-learn', seen);
  await session(page, shot, '/session/learn', '11-learn2', seen);
  await session(page, shot, '/session/review', '12-review', seen);
  await session(page, shot, '/session/hard', '13-hard', seen);
  await session(page, shot, '/session/listening', '14-listening', new Set());
  // Speed: photograph the timer and combo mid-run.
  await page.goto(base + '/session/speed');
  await page.waitForTimeout(2500);
  await shot('15-speed');
  for (let i = 0; i < 4; i++) {
    const opts = page.locator('button.tap.rounded-2xl.border-2:not([disabled])');
    if (await opts.count()) await opts.first().click();
    await page.waitForTimeout(500);
  }
  await shot('15-speed-2');
  await page
    .getByRole('button', { name: 'סגירה' })
    .first()
    .click()
    .catch(() => undefined);
  await page.waitForTimeout(400);
  await shot('15-speed-exit');

  for (const [name, route] of [
    ['20-learnhub', '/learn'],
    ['21-library', '/words'],
    ['23-stats', '/stats'],
    ['24-rivalry', '/rivalry'],
    ['25-settings', '/settings'],
    ['26-confusables', '/confusables'],
    ['28-today', '/today'],
    ['29-bidi', '/dev/bidi'],
  ] as const) {
    await page.goto(base + route);
    await page.waitForTimeout(1500);
    await shotsAlongPane(page, shot, name);
  }
  // Library search in both languages, and a word card with an English memory hook.
  await page.goto(base + '/words');
  await page.waitForTimeout(800);
  await page.getByRole('textbox').first().fill('תו');
  await page.waitForTimeout(500);
  await shot('21-library-search-he');
  await page.getByRole('textbox').first().fill('dec');
  await page.waitForTimeout(500);
  await shot('21-library-search-en');
  await page.goto(base + '/word/1');
  await page.waitForTimeout(1200);
  await shotsAlongPane(page, shot, '22-word');
  // Confusables: open the first pair.
  await page.goto(base + '/confusables');
  await page.waitForTimeout(1000);
  await page.locator('button.card').first().click();
  await page.waitForTimeout(400);
  await shot('26-confusables-open');
  // Read mode with a pasted text and a word sheet.
  await page.goto(base + '/read');
  await page.waitForTimeout(600);
  await page
    .locator('textarea')
    .fill('The committee will scrutinize every proposal before the deadline, then decide.');
  await page.getByRole('button', { name: 'לנתח את הטקסט' }).click();
  await page.waitForTimeout(800);
  await shot('27-read');
  await page.locator('div.card button').first().click();
  await page.waitForTimeout(900);
  await shot('27-read-sheet');
  // Rivalry: nudge toast; settings: a toast with an English detail.
  await page.goto(base + '/rivalry');
  await page.waitForTimeout(900);
  await scrollPane(page, 'bottom');
  await page.getByRole('button', { name: /נקירה/ }).first().click();
  await page.waitForTimeout(300);
  await shot('24-rivalry-nudge-toast');
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch(
    existsSync(localChromium) && !process.env.CI ? { executablePath: localChromium } : {},
  );
  const only = process.env.ONLY?.split(',');
  for (const me of ['rotem', 'noa'] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      if (only && !only.includes(`${me}-${scheme}`)) continue;
      const ctx = await browser.newContext({
        ...devices['iPhone 14'],
        deviceScaleFactor: 2,
        colorScheme: scheme,
        locale: 'he-IL',
        timezoneId: 'Asia/Jerusalem',
      });
      await mockBackend(ctx);
      const page = await ctx.newPage();
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await flow(page, me, async (name) => {
        await page.screenshot({ path: path.join(outDir, `${me}-${scheme}-${name}.png`) });
      });
      console.info(`${me}-${scheme}: done, console errors: ${errors.length}`);
      for (const e of errors.slice(0, 5)) console.info('  ', e.slice(0, 200));
      await ctx.close();
    }
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
