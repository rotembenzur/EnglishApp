import { expect, test, type Page } from '@playwright/test';

const EXTERNAL = /dictionaryapi\.dev|mymemory\.translated\.net|translate\.googleapis\.com/;

// Third-party APIs are blocked by default so CI never depends on them; tests tagged [online]
// install their own deterministic mocks.
test.beforeEach(async ({ context }, info) => {
  if (!info.title.includes('[online]')) await context.route(EXTERNAL, (r) => r.abort());
});

/** Wait until the session shows its first exercise (intro card, options or a typing field). */
async function waitForExercise(page: Page, timeout = 20_000) {
  await expect(
    page
      .getByRole('button', { name: 'הבנתי' })
      .or(page.locator('button.tap.rounded-2xl.border-2'))
      .or(page.locator('input.en'))
      .first(),
  ).toBeVisible({ timeout });
}

/** Finish placement: "know" most words, so the level lands above the authored range. */
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

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    // Remote enrichment endpoints are unreachable in CI sandboxes; that is not an app error.
    if (msg.type() === 'error' && !/Failed to load resource|net::ERR/.test(msg.text()))
      errors.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('first launch: profile picker in Hebrew RTL with a PWA manifest', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page).toHaveURL(/welcome/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('מי מתאמן');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('new user: placement, then a learning session with answers saved', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('רתם');
  await page.getByRole('button', { name: 'למבחן רמה' }).click();
  await page.getByRole('button', { name: 'מתחילים' }).click();

  // Answer the placement: know the first ones, then a mix, with meaning checks when asked.
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole('button', { name: 'יאללה, ללמוד' }).isVisible()) break;
    const know = page.getByRole('button', { name: 'מכיר', exact: true });
    if (await know.isVisible()) {
      await (i % 3 === 2 ? page.getByRole('button', { name: 'לא מכיר' }) : know).click();
    } else {
      // Meaning check: pick the first option.
      await page.locator('main, #root').getByRole('button').last().click();
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(80);
  }
  await expect(page.getByRole('button', { name: 'יאללה, ללמוד' })).toBeVisible();
  await page.getByRole('button', { name: 'יאללה, ללמוד' }).click();

  await page.getByRole('button', { name: /ללמוד/ }).first().click();
  await expect(page).toHaveURL(/session\/learn/);
  await waitForExercise(page);
  // Work through a few items.
  for (let i = 0; i < 12; i++) {
    const got = page.getByRole('button', { name: 'הבנתי' });
    const input = page.locator('input[lang="en"], input.en');
    const next = page.getByRole('button', { name: 'הבא' });
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
    } else {
      const opts = page.locator('button.tap.rounded-2xl.border-2:not([disabled])');
      if (await opts.count()) await opts.first().click();
    }
    await page.waitForTimeout(1300);
    if (
      await page
        .getByText('סיימת סשן')
        .isVisible()
        .catch(() => false)
    )
      break;
  }
  const saved = await page.evaluate(async () => {
    const req = indexedDB.open('lexbites');
    const db: IDBDatabase = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const count = (store: string) =>
      new Promise<number>((res) => {
        const r = db.transaction(store).objectStore(store).count();
        r.onsuccess = () => res(r.result);
      });
    return { words: await count('userWords'), reviews: await count('reviews') };
  });
  expect(saved.words).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('tabs navigate and settings opens', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/welcome');
  await page.getByRole('button', { name: /נועה/ }).click();
  await page.getByRole('link', { name: 'מילים', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('המילים שלי');
  await page.getByRole('link', { name: 'יריבות', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('יריבות');
  await page.getByRole('link', { name: 'סטטיסטיקה', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('סטטיסטיקה');
  await page.getByRole('link', { name: 'בית', exact: true }).click();
  await page.getByRole('link', { name: 'הגדרות' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('הגדרות');
  expect(errors).toEqual([]);
});

test('works offline after the first load', async ({ page, context }) => {
  await page.goto('/welcome');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Wait until the precache has finished and the page is controlled.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 })
    .toBe(true);
  await page.getByRole('button', { name: /נועה/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('נועה');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('נועה');
  await page.getByRole('link', { name: 'מילים', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('המילים שלי');
  await context.setOffline(false);
});

test('an interrupted session can be resumed from home', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/welcome');
  await page.getByRole('button', { name: /נועה/ }).click();
  await page.getByRole('button', { name: 'למבחן רמה' }).click();
  await page.getByRole('button', { name: 'מתחילים' }).click();
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole('button', { name: 'יאללה, ללמוד' }).isVisible()) break;
    const dont = page.getByRole('button', { name: 'לא מכיר' });
    if (await dont.isVisible()) await dont.click();
    await page.waitForTimeout(60);
  }
  await page.getByRole('button', { name: 'יאללה, ללמוד' }).click();
  await page.getByRole('button', { name: /ללמוד/ }).first().click();
  await waitForExercise(page);
  // Acknowledge the first new word, then leave abruptly (like closing the app).
  const got = page.getByRole('button', { name: 'הבנתי' });
  if (await got.isVisible()) await got.click();
  await page.waitForTimeout(500);
  await page.goto('/');
  await page.getByText('להמשיך מאיפה שעצרת?').click();
  await expect(page).toHaveURL(/session\/resume/);
  await waitForExercise(page);
  await expect(page.getByRole('progressbar').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('[online] a session starts within seconds even when dictionary APIs are slow', async ({
  page,
  context,
}) => {
  const errors = trackErrors(page);
  // Slow but working enrichment endpoints, like a real phone on a mediocre connection.
  await context.route(/dictionaryapi\.dev/, async (r) => {
    const word = decodeURIComponent(r.request().url().split('/').pop() ?? 'word');
    await new Promise((x) => setTimeout(x, 1500));
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          word,
          phonetic: '/wɜrd/',
          phonetics: [],
          meanings: [
            {
              partOfSpeech: 'noun',
              definitions: [
                { definition: 'a test meaning', example: `the ${word} was there yesterday` },
                { definition: 'another meaning', example: `we talked about the ${word} today` },
              ],
            },
          ],
        },
      ]),
    });
  });
  await context.route(/mymemory\.translated\.net|translate\.googleapis\.com/, async (r) => {
    await new Promise((x) => setTimeout(x, 1200));
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ responseData: { translatedText: 'מילה' }, responseStatus: 200 }),
    });
  });
  await page.goto('/welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  await finishPlacement(page, 'high');
  const started = Date.now();
  await page.getByRole('button', { name: /ללמוד/ }).first().click();
  await waitForExercise(page, 15_000);
  expect(Date.now() - started).toBeLessThan(9_000);
  expect(errors).toEqual([]);
});
