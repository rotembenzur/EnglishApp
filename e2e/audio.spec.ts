import { expect, test, type Page } from '@playwright/test';
import { clipKey } from '../src/audio/key';

/**
 * Recorded audio: the root index, a word pack precached for offline use, playback from a slice
 * of the pack (online and offline), and the system-voice fallback for text without a recording.
 * The fixture clip is a WAV so the test does not depend on the browser's AAC support.
 */

function wav(ms = 300): Buffer {
  const rate = 8000;
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(3000 * Math.sin(i / 3)), 44 + i * 2);
  return b;
}

const normal = wav(300);
const slow = wav(400);
const pack = Buffer.concat([normal, slow]);
const files: Record<string, { body: Buffer | string; type: string }> = {
  'index.json': {
    type: 'application/json',
    body: JSON.stringify({
      v: 1,
      pipeline: 1,
      builtAt: '2026-10-13T00:00:00Z',
      voices: { us: 'af_heart', uk: 'bf_emma' },
      w: { us: 'w-us-test.json', uk: 'w-uk-test.json' },
      s: 's-test.json',
      bytes: pack.length,
    }),
  },
  'w-us-test.json': {
    type: 'application/json',
    body: JSON.stringify({
      packs: [
        { f: 'w-us-0000-test.pack', k: clipKey('wonderful'), l: [normal.length, slow.length] },
      ],
    }),
  },
  'w-uk-test.json': { type: 'application/json', body: JSON.stringify({ packs: [] }) },
  's-test.json': { type: 'application/json', body: JSON.stringify({ k: '' }) },
  'w/w-us-0000-test.pack': { type: 'application/octet-stream', body: pack },
};

async function serveAudio(page: Page, seen: string[]) {
  await page.route('**/audio/**', async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.replace(/^.*\/audio\//, '');
    seen.push(name);
    const f = files[name];
    if (!f) return route.fulfill({ status: 404, body: 'not found' });
    const range = route.request().headers()['range'];
    const body = typeof f.body === 'string' ? Buffer.from(f.body) : f.body;
    if (range) {
      const [a, b] = range.replace('bytes=', '').split('-').map(Number);
      return route.fulfill({
        status: 206,
        contentType: f.type,
        headers: { 'content-range': `bytes ${a}-${b}/${body.length}` },
        body: body.subarray(a!, b! + 1),
      });
    }
    return route.fulfill({ status: 200, contentType: f.type, body });
  });
}

const plays = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __lexbitesAudio: { recentPlays: () => { source: string; key?: string; slow: boolean }[] };
    };
    return w.__lexbitesAudio.recentPlays().map((p) => ({ ...p }));
  });

test('recordings: precached word pack plays online and offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const seen: string[] = [];
  await serveAudio(page, seen);
  await page.goto('/welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('רתם');
  await page.goto('/settings');
  await expect(page.getByText('הקלטות', { exact: true })).toBeVisible();
  // The pack of the chosen accent is stored in the background (after about 5 seconds).
  await expect(page.getByText('כל המילים שמורות במכשיר')).toBeVisible({ timeout: 20_000 });
  expect(seen).toContain('w/w-us-0000-test.pack');

  await page.getByRole('button', { name: /לשמוע הקלטה/ }).click();
  await expect.poll(async () => (await plays(page)).at(-1)?.source).toBe('recording');
  expect((await plays(page)).at(-1)?.key).toBe(clipKey('wonderful'));

  // Offline: the clip comes from Cache Storage, no request leaves the page.
  const before = seen.length;
  await context.setOffline(true);
  await page.getByRole('button', { name: /לשמוע הקלטה/ }).click();
  await expect.poll(async () => (await plays(page)).length).toBe(2);
  expect((await plays(page)).at(-1)?.source).toBe('recording');
  expect(seen.filter((s) => s.startsWith('w/')).length).toBe(
    seen.slice(0, before).filter((s) => s.startsWith('w/')).length,
  );
  await context.setOffline(false);

  // The system-voice test button never uses a recording.
  await page.getByRole('button', { name: /לשמוע את קול המערכת/ }).click();
  await expect.poll(async () => (await plays(page)).at(-1)?.source).toBe('system');
  expect(errors).toEqual([]);
});
