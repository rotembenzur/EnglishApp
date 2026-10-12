import { expect, test } from '@playwright/test';

test('home renders in Hebrew RTL with a PWA manifest', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('LexBites');
  const manifest = page.locator('link[rel="manifest"]');
  await expect(manifest).toHaveCount(1);
  const appleIcon = page.locator('link[rel="apple-touch-icon"]');
  await expect(appleIcon).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('bottom tab bar navigates between tabs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'מילים' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('מילים');
  await page.getByRole('link', { name: 'בית' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('LexBites');
});
