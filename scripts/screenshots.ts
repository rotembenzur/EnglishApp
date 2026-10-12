/**
 * Captures README screenshots by driving the real app through a first-run flow:
 * profile picker, placement, home, a learning session, summary, library, stats, rivalry.
 * Run: pnpm build && pnpm preview (other terminal), then: pnpm screenshots [outDir]
 */
import { chromium, devices, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = (process.env.SHOT_BASE ?? 'http://localhost:4173/').replace(/\/$/, '');
const outDir = process.argv[2] ?? 'docs/screenshots';
const localChromium = '/opt/pw-browsers/chromium';

async function flow(page: Page, shot: (name: string) => Promise<void>) {
  await page.goto(`${base}/welcome`);
  await page.waitForTimeout(600);
  await shot('01-welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  await page.getByRole('button', { name: 'למבחן רמה' }).click();
  await page.getByRole('button', { name: 'מתחילים' }).click();
  await page.waitForTimeout(400);
  await shot('02-placement');
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole('button', { name: 'יאללה, ללמוד' }).isVisible()) break;
    const know = page.getByRole('button', { name: 'מכיר', exact: true });
    if (await know.isVisible())
      await (i % 4 === 3 ? page.getByRole('button', { name: 'לא מכיר' }) : know).click();
    else {
      await page.locator('#root').getByRole('button').last().click();
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  await shot('03-level');
  await page.getByRole('button', { name: 'יאללה, ללמוד' }).click();
  await page.waitForTimeout(700);
  await shot('04-home');
  await page.getByRole('button', { name: /ללמוד/ }).first().click();
  await page
    .locator('[aria-busy="true"]')
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => undefined);
  let introShot = false;
  let choiceShot = false;
  let typingShot = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(700);
    if (
      await page
        .getByText('סיימת סשן')
        .isVisible()
        .catch(() => false)
    )
      break;
    const got = page.getByRole('button', { name: 'הבנתי' });
    const next = page.getByRole('button', { name: 'הבא' });
    const input = page.locator('input.en');
    const opts = page.locator('button.tap.rounded-2xl.border-2:not([disabled])');
    if (await got.isVisible().catch(() => false)) {
      if (!introShot) await shot('05-new-word');
      introShot = true;
      await got.click();
    } else if (await next.isVisible().catch(() => false)) await next.click();
    else if (
      await input
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await input.first().fill('wrogn');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      if (!typingShot) await shot('07-mistake');
      typingShot = true;
    } else if (await opts.count()) {
      if (!choiceShot) await shot('06-question');
      choiceShot = true;
      await opts.first().click();
    }
  }
  await page.waitForTimeout(800);
  await shot('08-summary');
  for (const [name, route] of [
    ['09-words', '/words'],
    ['10-stats', '/stats'],
    ['11-rivalry', '/rivalry'],
  ] as const) {
    await page.goto(base + route);
    await page.waitForTimeout(800);
    await shot(name);
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch(
    existsSync(localChromium) && !process.env.CI ? { executablePath: localChromium } : {},
  );
  for (const scheme of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({
      ...devices['iPhone 14'],
      deviceScaleFactor: 2,
      colorScheme: scheme,
      locale: 'he-IL',
    });
    const page = await ctx.newPage();
    await flow(page, async (name) => {
      await page.screenshot({ path: path.join(outDir, `${scheme}-${name}.png`) });
    });
    await ctx.close();
  }
  await browser.close();
  console.info(`screenshots written to ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
