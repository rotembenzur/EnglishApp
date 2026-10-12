/**
 * Captures phone-sized screenshots of the built app for README and QA.
 * Run: pnpm preview (in another terminal) then: pnpm tsx scripts/screenshots.ts [outDir]
 */
import { chromium, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.SHOT_BASE ?? 'http://localhost:4173/';
const outDir = process.argv[2] ?? 'docs/screenshots';
const routes = (process.env.SHOT_ROUTES ?? '/').split(',');
const localChromium = '/opt/pw-browsers/chromium';

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch(
    existsSync(localChromium) && !process.env.CI ? { executablePath: localChromium } : {},
  );
  for (const scheme of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({
      ...devices['iPhone 14'],
      colorScheme: scheme,
      locale: 'he-IL',
    });
    const page = await ctx.newPage();
    for (const r of routes) {
      await page.goto(base.replace(/\/$/, '') + r);
      await page.waitForTimeout(600);
      const name =
        (r === '/' ? 'home' : r.replace(/^\//, '').replace(/\//g, '-')) + `-${scheme}.png`;
      await page.screenshot({ path: path.join(outDir, name) });
      console.info('saved', name);
    }
    await ctx.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
