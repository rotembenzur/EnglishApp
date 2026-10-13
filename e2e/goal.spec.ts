import { expect, test, type Page } from '@playwright/test';

const EXTERNAL = /dictionaryapi\.dev|mymemory\.translated\.net|translate\.googleapis\.com/;

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
 * The state a phone on 0.6.0 left behind: both profiles with the old 60 XP goal, rotem already
 * past 60 XP today with a 3-day streak, sync connected. No migration flag (0.6.0 had none).
 */
async function seedOldVersion(page: Page) {
  await page.evaluate(async () => {
    const key = (ts: number) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('lexbites');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction(['users', 'dailyStats', 'kv'], 'readwrite');
    const now = Date.now();
    const settings = {
      dailyGoal: 60,
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
        createdAt: now - 5 * 86_400_000,
        updatedAt: now - 3_600_000,
        deviceId: 'old',
      });
    for (let i = 0; i <= 2; i++)
      tx.objectStore('dailyStats').put({
        userId: 'rotem',
        date: key(now - i * 86_400_000),
        xp: i === 0 ? 80 : 300,
        newWords: 4,
        reviews: 10,
        correct: 12,
        ms: 300_000,
        sessions: 1,
        goal: 60,
        goalReached: true,
        updatedAt: now - 3_600_000,
        deviceId: 'old',
      });
    tx.objectStore('kv').delete('migration:goal-1000');
    tx.objectStore('kv').put({ key: 'currentUser', value: 'rotem' });
    tx.objectStore('kv').put({ key: 'syncConfig', value: { keyHash: 'x'.repeat(64) } });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  });
}

test('update from 0.6.0: goal becomes 1000 once, syncs up, keeps today and the streak', async ({
  page,
  context,
}) => {
  const errors = trackErrors(page);
  // A stand-in Supabase: records what the phone pushes, returns nothing on pulls.
  const pushedUsers: { id: string; data: { settings: { dailyGoal: number } } }[] = [];
  await context.route(/supabase\.co\/rest\/v1\//, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      if (req.url().includes('/lb_users')) pushedUsers.push(...JSON.parse(req.postData() ?? '[]'));
      return route.fulfill({ status: 201, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/welcome');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('מי מתאמן');
  await seedOldVersion(page);
  await page.goto('/');

  // Home: the new goal, today still counted as met, the streak intact.
  const ring = page.locator('.card').filter({ hasText: 'היעד הושלם' });
  await expect(ring.getByText('/ 1000 XP')).toBeVisible();
  await expect(ring.getByText('היעד הושלם ✓')).toBeVisible();
  await expect(ring.locator('.text-2xl.font-black').last()).toHaveText('3');
  // The rival card shows noa's goal too.
  await expect(page.locator('a[href$="/rivalry"]').getByText('/ 1000 XP')).toBeVisible();

  // Both migrated profiles went up to the server.
  await expect
    .poll(
      () =>
        new Set(pushedUsers.filter((u) => u.data.settings.dailyGoal === 1000).map((u) => u.id))
          .size,
    )
    .toBe(2);

  // Settings: 1000 is selected; pick another preset by hand.
  await page.getByRole('link', { name: 'הגדרות' }).click();
  await expect(page.getByText('1000 XP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^1000/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^1500/ }).click();
  await expect(page.getByText('1500 XP', { exact: true })).toBeVisible();

  // Reopening the app never runs the migration again.
  await page.goto('/');
  await expect(page.getByText('/ 1500 XP').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('/ 1500 XP').first()).toBeVisible();
  expect(errors).toEqual([]);
});
