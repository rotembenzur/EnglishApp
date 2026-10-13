import { expect, test, type Page } from '@playwright/test';

/**
 * Owner's bug report (0.6.0): after the daily new-word cap, every session had a single item.
 * This plays session after session past the cap and checks each one has a normal length, then
 * uses the one-tap "עוד 5 מילים חדשות" to keep learning new words.
 */

const EXTERNAL = /dictionaryapi\.dev|mymemory\.translated\.net|translate\.googleapis\.com/;
const MIN_SESSION = 15;
/** Items advance on their own, so a button can vanish mid-click: never wait long for one. */
const QUICK = { timeout: 2000 };

test.beforeEach(async ({ context }) => {
  await context.route(EXTERNAL, (r) => r.abort());
});

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|net::ERR/.test(msg.text()))
      errors.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const summary = (page: Page) =>
  page.getByRole('heading', { level: 1 }).filter({ hasText: /סיימת סשן|סשן מושלם/ });

/** Wait for the first exercise, then read the session length from the progress bar. */
async function sessionLength(page: Page): Promise<number> {
  await expect(
    page
      .getByRole('button', { name: 'הבנתי' })
      .or(page.locator('button.tap.rounded-2xl.border-2'))
      .or(page.locator('input.en'))
      .first(),
  ).toBeVisible({ timeout: 20_000 });
  return Number(await page.getByRole('progressbar').first().getAttribute('aria-valuemax'));
}

/** Answer everything until the summary shows (right or wrong does not matter here). */
async function playToEnd(page: Page) {
  for (let i = 0; i < 120; i++) {
    if (await summary(page).isVisible()) return;
    const got = page.getByRole('button', { name: 'הבנתי', exact: true }).first();
    const next = page.getByRole('button', { name: 'הבא', exact: true, disabled: false }).last();
    const input = page.locator('input.en');
    if (await got.isVisible()) await got.click(QUICK).catch(() => undefined);
    else if (await next.isVisible()) await next.click(QUICK).catch(() => undefined);
    else if (await page.getByText('מתאימים זוגות').isVisible()) await solveMatch(page);
    else if (await input.first().isVisible()) {
      await input
        .first()
        .fill('x', QUICK)
        .catch(() => undefined);
      await page.keyboard.press('Enter');
    } else {
      const opts = page.locator('button.tap.rounded-2xl.border-2:not([disabled])');
      if (await opts.count())
        await opts
          .first()
          .click({ timeout: 2000 })
          .catch(() => undefined);
    }
    await page.waitForTimeout(350);
  }
  await expect(summary(page)).toBeVisible();
}

/** Match board: try each English word against each Hebrew one until it pairs. */
async function solveMatch(page: Page) {
  const grid = page.locator('div.grid.grid-cols-2').first();
  const left = grid.locator('div[dir="ltr"] button');
  const right = grid.locator('> div:not([dir]) button');
  const n = await left.count();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (await left.nth(i).isDisabled()) break;
      if (await right.nth(j).isDisabled()) continue;
      await left
        .nth(i)
        .click(QUICK)
        .catch(() => undefined);
      await right
        .nth(j)
        .click(QUICK)
        .catch(() => undefined);
      await page.waitForTimeout(80);
    }
  }
  await page.waitForTimeout(1500);
}

test('sessions keep a normal length after the daily new-word cap', async ({ page }) => {
  test.setTimeout(300_000);
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

  // Sessions 1 and 2 introduce the day's 8 new words (5, then 3); 3 to 5 come after the cap.
  await page.getByRole('button', { name: /ללמוד/ }).first().click();
  const lengths: number[] = [];
  for (let s = 0; s < 5; s++) {
    lengths.push(await sessionLength(page));
    await playToEnd(page);
    if (s >= 1) await expect(page.getByTestId('cap-card')).toBeVisible();
    if (s < 4) await page.getByRole('button', { name: 'עוד סשן' }).click();
  }
  for (const n of lengths) expect(n).toBeGreaterThanOrEqual(MIN_SESSION);

  // Home says so too, and one tap brings 5 more new words for today.
  await page.getByRole('button', { name: 'לבית' }).click();
  await expect(page.getByTestId('cap-card')).toBeVisible();
  await page
    .getByTestId('cap-card')
    .getByRole('button', { name: /עוד 5 מילים חדשות/ })
    .click();
  await expect(page).toHaveURL(/session\/learn/);
  expect(await sessionLength(page)).toBeGreaterThanOrEqual(MIN_SESSION);
  // A new word shows up within the first few items (new words are interleaved with reviews).
  let sawIntro = false;
  for (let i = 0; i < 8 && !sawIntro; i++) {
    if (await page.getByRole('button', { name: 'הבנתי', exact: true }).isVisible()) sawIntro = true;
    else {
      const opts = page.locator('button.tap.rounded-2xl.border-2:not([disabled])');
      const next = page.getByRole('button', { name: 'הבא', exact: true, disabled: false }).last();
      const input = page.locator('input.en');
      if (await next.isVisible()) await next.click(QUICK).catch(() => undefined);
      else if (await input.first().isVisible()) {
        await input
          .first()
          .fill('x', QUICK)
          .catch(() => undefined);
        await page.keyboard.press('Enter');
      } else if (await opts.count())
        await opts
          .first()
          .click(QUICK)
          .catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
  expect(sawIntro).toBe(true);
  console.info(`session lengths after placement: ${lengths.join(', ')}`);
  expect(errors).toEqual([]);
});

test('optional modes explain themselves instead of starting a tiny session', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  // A fresh profile has no learned words: the mode buttons stay disabled on home...
  await expect(page.getByRole('button', { name: 'מילים קשות' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'סיבוב מהיר' })).toBeDisabled();
  // ...and opening one directly shows why, with a way forward.
  await page.goto('/session/hard');
  await expect(page.getByTestId('session-empty')).toContainText('מילים קשות נפתחות');
  await expect(page.getByRole('button', { name: 'לסשן למידה' })).toBeVisible();
  expect(errors).toEqual([]);
});
