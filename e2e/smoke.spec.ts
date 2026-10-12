import { expect, test, type Page } from '@playwright/test';

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
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
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
      const opts = page.locator('button.tap.rounded-2xl.border-2');
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
