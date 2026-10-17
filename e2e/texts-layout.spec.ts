import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Owner's report (0.10.0): screens and sheets of טקסטים overflowed on the iPhone (content under
 * the tab bar, buttons out of reach, no scroll), worst with the keyboard up. This walks every
 * screen of the feature on an iPhone 14 viewport and checks that every button, link and field
 * can be scrolled to and is really on top there (not under the tab bar, a sheet or a sticky
 * header). The keyboard is emulated by shrinking the visible area by its height (336 px).
 */

const KEYBOARD = 336;

const LONG = Array.from(
  { length: 14 },
  (_, i) =>
    `Paragraph ${i + 1}: Anthropic released a new multimodal model today, and Meta and Mistral answered quickly with their own announcements. The researchers say the system can describe images and transcribe speech, although critics argue that the benchmarks are not transparent enough.`,
).join('\n\n');

/**
 * The iPhone way: the page keeps its full height and only the visual viewport shrinks (fixed
 * elements stay put, so whatever is pinned to the bottom ends up behind the keyboard).
 */
async function iosKeyboard(page: Page, up: boolean) {
  await page.evaluate(
    ({ up, kb }) => {
      const vv = window.visualViewport!;
      if (up) {
        const full = window.innerHeight;
        Object.defineProperty(vv, 'height', { configurable: true, get: () => full - kb });
      } else {
        // Back to the real getter on the prototype.
        delete (vv as unknown as Record<string, unknown>).height;
      }
      vv.dispatchEvent(new Event('resize'));
    },
    { up, kb: KEYBOARD },
  );
  await page.waitForTimeout(100);
}

/** The element's bottom edge is above the keyboard. */
async function aboveKeyboard(page: Page, name: string) {
  const box = await page.getByRole('button', { name, exact: true }).boundingBox();
  const limit = (page.viewportSize()?.height ?? 664) - KEYBOARD;
  expect(box, name).not.toBeNull();
  expect(box!.y + box!.height, `${name} above the keyboard`).toBeLessThanOrEqual(limit);
}

async function mockApis(page: Page) {
  await page.context().route(/mymemory|r\.jina\.ai/, (r) => r.abort());
  await page.context().route(/dictionaryapi\.dev/, (r) => r.fulfill({ status: 404, body: '{}' }));
  await page.context().route(/translate\.googleapis\.com/, (r: Route) => {
    const q = new URL(r.request().url()).searchParams.get('q') ?? '';
    const he = q
      .split('\n')
      .map((l, i) =>
        l.trim().split(/\s+/).length === 1
          ? `מילה`
          : `זה משפט מתורגם ארוך למדי כדי לבדוק גלישה של שורות ${i + 1}`,
      )
      .join('\n');
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify([[[he, q]]]) });
  });
}

/** Every visible button and input can be scrolled to and is really on top (not under the tab bar). */
async function reachable(page: Page, name: string) {
  const bad = await page.evaluate(async () => {
    const out: string[] = [];
    const scope = document.querySelector('[role=dialog]') ?? document;
    const els = Array.from(
      scope.querySelectorAll('button, a[href], input, textarea, [role=button]'),
    ).filter((e) => !(e as HTMLElement).className.includes('absolute inset-0')) as HTMLElement[];
    for (const el of els) {
      const r0 = el.getBoundingClientRect();
      if (!r0.width || !r0.height || getComputedStyle(el).visibility === 'hidden') continue;
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 30));
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
      const y = r.top + Math.min(r.height / 2, 10);
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el)))
        out.push(
          `${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" y=${Math.round(y)} hit=${hit?.tagName}.${(hit as HTMLElement)?.className?.toString().slice(0, 40)}`,
        );
    }
    return out;
  });
  expect(bad, name).toEqual([]);
}

test('texts: every control reachable on every screen, also with the keyboard up', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await mockApis(page);
  await page.goto('/welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  await page.getByRole('button', { name: 'למבחן רמה' }).click();
  await page.getByRole('button', { name: 'מתחילים' }).click();
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole('button', { name: 'יאללה, ללמוד' }).isVisible()) break;
    const k = page.getByRole('button', { name: 'לא מכיר' });
    if (await k.isVisible()) await k.click();
    await page.waitForTimeout(60);
  }
  await page.getByRole('button', { name: 'יאללה, ללמוד' }).click();
  await page.goto('/texts');
  await page.getByRole('button', { name: /טקסט חדש/ }).click();
  await page.getByTestId('text-body').fill(LONG);
  await page.getByTestId('text-body').focus();
  await iosKeyboard(page, true);
  await aboveKeyboard(page, 'לשמור ולקרוא');
  await iosKeyboard(page, false);
  await page.getByTestId('text-body').focus();
  // Keyboard: the visible area shrinks by 336 px.
  await page.setViewportSize({ width: 390, height: 664 - KEYBOARD });
  await reachable(page, 'new-keyboard');
  await expect(page.getByRole('button', { name: 'לשמור ולקרוא' })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 664 });
  await reachable(page, 'new');
  await page.getByRole('button', { name: 'לשמור ולקרוא' }).click();
  await expect(page).toHaveURL(/\/texts\/[\w-]+$/);
  await reachable(page, 'read');
  await page.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight));
  await page
    .getByTestId('text-view')
    .getByRole('button', { name: 'multimodal', exact: true })
    .first()
    .click();
  await reachable(page, 'word-sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'משפט' }).click();
  await page.getByTestId('sentence').first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'לתרגם את כל הטקסט' }).click();
  await page.waitForTimeout(800);
  await reachable(page, 'translated');
  await page.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight));
  // Rename with the keyboard up.
  await page.locator('main').evaluate((m) => m.scrollTo(0, 0));
  await page.getByRole('button', { name: 'לשנות את הכותרת' }).click();
  await page.getByTestId('rename-input').focus();
  await iosKeyboard(page, true);
  await aboveKeyboard(page, 'שמירה');
  await iosKeyboard(page, false);
  await page.setViewportSize({ width: 390, height: 664 - KEYBOARD });
  await reachable(page, 'rename-keyboard');
  await expect(page.getByRole('button', { name: 'שמירה' })).toBeInViewport();
  await page.getByTestId('rename-input').fill('My short title');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await page.setViewportSize({ width: 390, height: 664 });
  await page.getByRole('button', { name: 'למחוק את הטקסט' }).click();
  await reachable(page, 'delete');
  await page.getByRole('button', { name: 'ביטול' }).click();
  await page.goto('/texts');
  await page.getByTestId('text-row').first().click();
  await page.getByRole('link', { name: /רק בדיקת הבנה/ }).click();
  await page.waitForTimeout(1000);
  await reachable(page, 'check');
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId('check-done').isVisible()) break;
    await page.getByTestId('check-options').getByRole('button').first().click();
    await reachable(page, `check-${i}`);
    await page.getByRole('button', { name: 'המשך' }).click();
  }
  await page.getByRole('button', { name: 'לטקסט' }).click();
  await page.getByRole('button', { name: 'לתרגל את הטקסט' }).click();
  await page.waitForTimeout(3000);
  await reachable(page, 'session');
});
