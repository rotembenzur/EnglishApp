import { expect, test, type Page } from '@playwright/test';

const EXTERNAL = /dictionaryapi\.dev|mymemory\.translated\.net|translate\.googleapis\.com/;
const MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

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

/**
 * Both profiles placed; last month noa won 800 to 500, this month rotem leads 300 to 100.
 * Returns the index (0 to 11) of last month.
 */
async function seed(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('lexbites');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['users', 'dailyStats', 'kv'], 'readwrite');
    const settings = {
      dailyGoal: 1000,
      newPerDay: 8,
      accent: 'us',
      speechRate: 0.95,
      sounds: false,
      retention: 0.9,
      topics: [],
      disabledKinds: [],
      autoplay: true,
      largeText: false,
    };
    for (const [id, name] of [
      ['rotem', 'רתם'],
      ['noa', 'נועה'],
    ])
      tx.objectStore('users').put({
        id,
        name,
        settings,
        ability: { theta: 50, sigma: 8, answers: 120, assumedKnownBelow: 30 },
        badges: {},
        thetaHistory: [],
        createdAt: Date.now() - 60 * 86_400_000,
        updatedAt: Date.now(),
        deviceId: 'seed',
      });
    const day = (userId: string, date: Date, xp: number) =>
      tx.objectStore('dailyStats').put({
        userId,
        date: key(date),
        xp,
        newWords: 4,
        reviews: 10,
        correct: 12,
        ms: 300_000,
        sessions: 1,
        goal: 1000,
        goalReached: false,
        updatedAt: Date.now(),
        deviceId: 'seed',
      });
    day('rotem', lastMonth, 500);
    day('noa', lastMonth, 800);
    day('rotem', now, 300);
    day('noa', now, 100);
    tx.objectStore('kv').put({ key: 'currentUser', value: 'rotem' });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return lastMonth.getMonth();
  });
}

test('monthly league: the month race, last month winner picks the date', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/welcome');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('מי מתאמן');
  const last = MONTHS[await seed(page)]!;
  await page.goto('/rivalry');

  // The recap toast on the first open of the month.
  await expect(page.getByText(`סיכום חודשי: נועה ניצחה ב${last}`)).toBeVisible({ timeout: 15_000 });

  const card = page.getByTestId('month-league');
  await expect(page.getByRole('heading', { name: 'הליגה החודשית' })).toBeVisible();
  await expect(card.getByText(/על הכף: דייט/)).toBeVisible();
  await expect(card.getByText('300 XP')).toBeVisible();
  await expect(card.getByText('100 XP')).toBeVisible();
  await expect(card.getByText(/רתם מוביל ב\S*200/)).toBeVisible();
  await expect(card.getByText(`נועה ניצחה ב${last}`)).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('היא בוחרת דייט ומזמינה')).toBeVisible();
  await expect(card.getByText(/חודשים שניצחתם: רתם 0 · נועה 1/)).toBeVisible();

  // Second open in the same month: no second recap.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'הליגה החודשית' })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText(/סיכום חודשי/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
