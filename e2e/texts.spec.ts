import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Owner's report (0.9.0): Read mode opened empty cards for words outside the authored set
 * ("multimodal") and highlighted names (Anthropic, Meta, Mistral). Now: טקסטים. The dictionary
 * answers 404 for those words (like the real one) and Google translates, line by line.
 */

const TEXT = `Anthropic released a new multimodal model today, and Meta and Mistral answered quickly.
The researchers say the system can describe images and transcribe speech.
Critics argue that the benchmarks are not transparent enough.
Still, the company plans to publish the weights next month.`;

async function mockApis(page: Page) {
  await page.context().route(/mymemory\.translated\.net/, (r) => r.abort());
  await page.context().route(/dictionaryapi\.dev/, (r) =>
    r.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{"title":"No Definitions"}',
    }),
  );
  await page.context().route(/translate\.googleapis\.com/, (r: Route) => {
    const q = new URL(r.request().url()).searchParams.get('q') ?? '';
    const he = q
      .split('\n')
      .map((l, i) =>
        l.trim().split(/\s+/).length === 1 ? `מילה ${l.length}` : `משפט מתורגם ${i + 1}`,
      )
      .join('\n');
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify([[[he, q]]]) });
  });
}

const QUICK = { timeout: 2000 };

/** Answer everything until the summary shows (right or wrong does not matter here). */
async function playToEnd(page: Page) {
  const summary = page
    .getByRole('heading', { level: 1 })
    .filter({ hasText: /סיימת סשן|סשן מושלם/ });
  for (let i = 0; i < 120; i++) {
    if (await summary.isVisible()) return;
    const got = page.getByRole('button', { name: 'הבנתי', exact: true }).first();
    const next = page.getByRole('button', { name: 'הבא', exact: true, disabled: false }).last();
    const input = page.locator('input.en');
    if (await got.isVisible()) await got.click(QUICK).catch(() => undefined);
    else if (await next.isVisible()) await next.click(QUICK).catch(() => undefined);
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
          .click(QUICK)
          .catch(() => undefined);
    }
    await page.waitForTimeout(350);
  }
  await expect(summary).toBeVisible();
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|net::ERR/.test(msg.text()))
      errors.push(msg.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('texts: save, word cards for words outside the authored set, sentences, practice', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = trackErrors(page);
  await mockApis(page);
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

  // The old Read mode link lands on texts.
  await page.goto('/read');
  await expect(page).toHaveURL(/\/texts$/);
  await page.getByRole('button', { name: /טקסט חדש/ }).click();
  await page.getByTestId('text-body').fill(TEXT);
  await page.getByRole('button', { name: 'לשמור ולקרוא' }).click();
  await expect(page).toHaveURL(/\/texts\/[\w-]+$/);
  const view = page.getByTestId('text-view');
  await expect(view).toContainText('multimodal');

  // Names are never marked; the hard word is.
  for (const name of ['Anthropic', 'Meta', 'Mistral'])
    await expect(view.getByRole('button', { name, exact: true })).not.toHaveAttribute(
      'data-marked',
      '1',
    );
  await expect(view.getByRole('button', { name: 'multimodal', exact: true })).toHaveAttribute(
    'data-marked',
    '1',
  );

  // A word without authored content: a real card with Hebrew and the sentence from the text.
  await view.getByRole('button', { name: 'multimodal', exact: true }).click();
  const card = page.getByTestId('word-lookup');
  await expect(card.getByTestId('lookup-hebrew')).toContainText('מילה');
  await expect(card).toContainText('Anthropic released');
  await expect(card.getByRole('button', { name: 'להסיר סימון' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A lookup that truly fails shows a message and a retry, never an empty card.
  await page.context().unroute(/translate\.googleapis\.com/);
  await page.context().route(/translate\.googleapis\.com/, (r) => r.abort());
  await view.getByRole('button', { name: 'benchmarks', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('לא הצלחנו');
  await mockApis(page);
  await card.getByRole('button', { name: 'ניסיון נוסף' }).click();
  await expect(card.getByTestId('lookup-hebrew')).toBeVisible();
  await page.keyboard.press('Escape');

  // Sentence taps and the whole text.
  await page.getByRole('radio', { name: 'משפט' }).click();
  await view.getByTestId('sentence').nth(1).click();
  await expect(page.getByTestId('sentence-card')).toContainText('משפט מתורגם');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'לתרגם את כל הטקסט' }).click();
  await expect(view.locator('p[dir="rtl"]')).toHaveCount(4);

  // Add everything marked, then practice the text.
  await page.getByRole('button', { name: /^להוסיף .*ללמידה$/ }).click();
  await expect(page.getByText('כל המילים המסומנות כבר בלמידה')).toBeVisible();
  await page.getByRole('button', { name: 'לתרגל את הטקסט' }).click();
  await expect(page).toHaveURL(/\/session\/text/);
  await expect(page.getByRole('button', { name: 'הבנתי' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: 'test-results/texts-session.png' });
  await playToEnd(page);

  // Then the comprehension check, and the text's progress.
  await page.getByRole('button', { name: 'לבדיקת ההבנה' }).click();
  for (let i = 0; i < 6; i++) {
    if (await page.getByTestId('check-done').isVisible()) break;
    await page.getByTestId('check-options').getByRole('button').first().click();
    await page.getByRole('button', { name: 'המשך' }).click();
  }
  await expect(page.getByTestId('check-done')).toContainText('מתוך');
  await page.getByRole('button', { name: 'לטקסט' }).click();
  await expect(page.getByText(/בדיקת הבנה: \d/)).toBeVisible();
  await page.screenshot({ path: 'test-results/texts-read.png', fullPage: true });
  await page.goto('/texts');
  await expect(page.getByTestId('text-row')).toContainText('מילים נלמדו');
  expect(errors).toEqual([]);
});
