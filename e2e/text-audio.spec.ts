import { expect, test, type Page, type Route } from '@playwright/test';
import { clipKey } from '../src/audio/key';

/**
 * Natural audio for saved texts (0.10.0). Supabase is a stand-in that renders on command: the test
 * decides when each clip is "rendered", and clips are WAV so Chromium can decode them. Recorded
 * audio comes from the same fixture idea as e2e/audio.spec.ts: one recorded word and one recorded
 * sentence, which must never be sent for rendering.
 */

const PROJECT = 'https://ngosxhpmudbgiiktqgoa.supabase.co';
const KEY = 'a'.repeat(64);
const TEXT = `The model is multimodal and surprisingly quick.
The weights are open.
Critics want transparent benchmarks.`;
const SENTENCES = [
  'The model is multimodal and surprisingly quick.',
  'The weights are open.',
  'Critics want transparent benchmarks.',
];

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
const clip = wav(250);

/** Recordings: "model" (word) and "The weights are open." (sentence). */
async function serveRecordings(page: Page) {
  const files: Record<string, { body: Buffer | string; type: string }> = {
    'index.json': {
      type: 'application/json',
      body: JSON.stringify({
        v: 1,
        pipeline: 1,
        builtAt: '2026-10-13T00:00:00Z',
        voices: { us: 'af_heart', uk: 'bf_emma' },
        w: { us: 'w-us-t.json', uk: 'w-uk-t.json' },
        s: 's-t.json',
        bytes: clip.length,
      }),
    },
    'w-us-t.json': {
      type: 'application/json',
      body: JSON.stringify({
        packs: [{ f: 'w-us-0000-t.pack', k: clipKey('model'), l: [clip.length, 0] }],
      }),
    },
    'w-uk-t.json': { type: 'application/json', body: JSON.stringify({ packs: [] }) },
    's-t.json': {
      type: 'application/json',
      body: JSON.stringify({ k: clipKey('The weights are open.') }),
    },
    [`s/${clipKey('The weights are open.')}.m4a`]: { type: 'audio/mp4', body: clip },
    'w/w-us-0000-t.pack': { type: 'application/octet-stream', body: clip },
  };
  await page.route('**/audio/**', async (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^.*\/audio\//, '');
    const f = files[name];
    if (!f) return route.fulfill({ status: 404, body: 'not found' });
    const body = typeof f.body === 'string' ? Buffer.from(f.body) : f.body;
    const range = route.request().headers()['range'];
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

interface Unit {
  k: string;
  v: string;
  t: string;
  w?: boolean;
}

/** A Supabase stand-in: sync tables answer empty, the text audio tables render on command. */
function fakeSupabase() {
  const state = {
    units: [] as Unit[],
    ready: new Set<string>(),
    status: 'pending' as 'pending' | 'running' | 'done' | 'failed',
    kicks: 0,
    keys: [] as (string | undefined)[],
  };
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    state.keys.push(req.headers()['x-lexbites-key']);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path.endsWith('/functions/v1/lexbites-tts')) {
      state.kicks++;
      return json({ dispatched: true });
    }
    if (path.endsWith('/rest/v1/lb_tts_jobs')) {
      if (req.method() === 'POST') {
        state.units = (req.postDataJSON() as { units: Unit[] }).units;
        return route.fulfill({ status: 201, body: '' });
      }
      const done = state.units.filter((u) => state.ready.has(`${u.v}:${u.k}`)).length;
      return json([{ status: state.status, done, failed: 0, total: state.units.length }]);
    }
    if (path.endsWith('/rest/v1/lb_tts_clips')) {
      const v = url.searchParams.get('v')!.replace('eq.', '');
      const keys = url.searchParams
        .get('k')!
        .replace(/^in\.\(|\)$/g, '')
        .split(',');
      return json(
        keys
          .filter((k) => state.ready.has(`${v}:${k}`))
          .map((k) => ({ k, v, audio: clip.toString('base64') })),
      );
    }
    if (path.includes('/rest/v1/rpc/')) return json(true);
    if (req.method() === 'GET') return json([]);
    return route.fulfill({ status: 201, body: '' });
  };
  return { state, handler };
}

const plays = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __lexbitesAudio: { recentPlays: () => { text: string; source: string }[] };
      }
    ).__lexbitesAudio
      .recentPlays()
      .map((p) => ({ text: p.text, source: p.source })),
  );

async function tapSpeaker(page: Page, scope: ReturnType<Page['getByTestId']>) {
  const b = scope.getByRole('button', { name: /השמע/ }).first();
  await b.dispatchEvent('pointerdown');
  await b.dispatchEvent('pointerup');
}

async function start(page: Page) {
  await page.context().route(/dictionaryapi|mymemory|jina/, (r) => r.abort());
  await page.context().route(/translate\.googleapis\.com/, (r) => {
    const q = new URL(r.request().url()).searchParams.get('q') ?? '';
    const he = q
      .split('\n')
      .map(() => 'תרגום')
      .join('\n');
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify([[[he, q]]]) });
  });
  await serveRecordings(page);
  await page.goto('/welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  // Sync connected: the text audio goes through the same project and passphrase hash.
  await page.evaluate(
    (keyHash) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lexbites');
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ key: 'syncConfig', value: { keyHash } });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    KEY,
  );
  await page.goto('/texts');
  await page.getByRole('button', { name: /טקסט חדש/ }).click();
  await page.getByTestId('text-body').fill(TEXT);
  await page.getByRole('button', { name: 'לשמור ולקרוא' }).click();
  await expect(page).toHaveURL(/\/texts\/[\w-]+$/);
}

test('text audio: prepared on GitHub, played in the natural voice, never the system voice', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fake = fakeSupabase();
  await page.context().route(`${PROJECT}/**`, fake.handler);
  await start(page);
  const state = page.getByTestId('audio-state');

  // Submitted: every sentence and word without a recording, nothing that has one.
  await expect(state).toHaveAttribute('data-phase', /queued|rendering/);
  await expect(state).toContainText('מכינים קול טבעי');
  expect(fake.state.kicks).toBe(1);
  expect(fake.state.keys.every((k) => k === KEY)).toBe(true);
  const sentenceUnits = fake.state.units.filter((u) => !u.w).map((u) => u.t);
  expect(sentenceUnits).toEqual([SENTENCES[0], SENTENCES[2]]);
  const wordUnits = fake.state.units.filter((u) => u.w).map((u) => u.t);
  expect(wordUnits).toContain('multimodal');
  expect(wordUnits).not.toContain('model');
  expect(fake.state.units.find((u) => u.w)!.v).toBe('us');

  // While a clip is on its way the speaker says so and plays nothing (no system voice).
  await page.getByRole('radio', { name: 'משפט' }).click();
  await page.getByTestId('sentence').first().click();
  const card = page.getByTestId('sentence-card');
  await expect(card.getByRole('button', { name: /בהכנה/ })).toBeVisible();
  await tapSpeaker(page, card);
  await expect(page.getByText('הקול הטבעי של זה עוד בהכנה')).toBeVisible();
  expect(await plays(page)).toEqual([]);
  await page.keyboard.press('Escape');

  // The first sentence is rendered: it comes down on the next poll and plays.
  fake.state.status = 'running';
  fake.state.ready.add(`us:${clipKey(SENTENCES[0]!)}`);
  await expect(state).toHaveAttribute('data-phase', 'rendering', { timeout: 15_000 });
  await expect(state).toContainText(/1 מתוך \d+/, { timeout: 15_000 });
  await page.getByTestId('sentence').first().click();
  await expect(card.getByRole('button', { name: /בהכנה/ })).toHaveCount(0);
  await tapSpeaker(page, card);
  await expect
    .poll(async () => (await plays(page)).at(-1))
    .toEqual({
      text: SENTENCES[0],
      source: 'generated',
    });
  await page.keyboard.press('Escape');

  // Everything rendered: ready, and the whole text reads in natural voices only.
  fake.state.status = 'done';
  for (const u of fake.state.units) fake.state.ready.add(`${u.v}:${u.k}`);
  await expect(state).toHaveAttribute('data-phase', 'ready', { timeout: 15_000 });
  await expect(state).toContainText('הקול הטבעי מוכן');
  await page.getByTestId('play-all').click();
  await expect
    .poll(async () => (await plays(page)).slice(-3), { timeout: 20_000 })
    .toEqual([
      { text: SENTENCES[0], source: 'generated' },
      { text: SENTENCES[1], source: 'recording' },
      { text: SENTENCES[2], source: 'generated' },
    ]);

  // Words: a rendered one and a recorded one.
  await page.getByRole('radio', { name: 'מילה' }).click();
  await page.getByTestId('text-view').getByRole('button', { name: 'multimodal' }).click();
  await tapSpeaker(page, page.getByTestId('word-lookup'));
  await expect
    .poll(async () => (await plays(page)).at(-1))
    .toEqual({
      text: 'multimodal',
      source: 'generated',
    });
  await page.keyboard.press('Escape');
  await page.getByTestId('text-view').getByRole('button', { name: 'model', exact: true }).click();
  await tapSpeaker(page, page.getByTestId('word-lookup'));
  await expect
    .poll(async () => (await plays(page)).at(-1))
    .toEqual({
      text: 'model',
      source: 'recording',
    });
  await page.keyboard.press('Escape');

  // Offline afterwards: the clips are on the phone.
  await page.context().setOffline(true);
  await page.getByRole('radio', { name: 'משפט' }).click();
  await page.getByTestId('sentence').nth(2).click();
  await tapSpeaker(page, card);
  await expect
    .poll(async () => (await plays(page)).at(-1))
    .toEqual({
      text: SENTENCES[2],
      source: 'generated',
    });
  await page.context().setOffline(false);

  // The list says the audio is ready.
  await page.goto('/texts');
  await expect(page.getByTestId('text-row')).toContainText('קול טבעי מוכן');
});

test('text audio: a failed render says so, offers a retry and falls back to the system voice', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const fake = fakeSupabase();
  fake.state.status = 'failed';
  await page.context().route(`${PROJECT}/**`, fake.handler);
  await start(page);
  const state = page.getByTestId('audio-state');
  await expect(state).toHaveAttribute('data-phase', 'failed', { timeout: 15_000 });
  await expect(state).toContainText('לא הצלחנו להכין קול טבעי');
  // Not pending any more: the speaker plays (the system voice, the last resort).
  await page.getByRole('radio', { name: 'משפט' }).click();
  await page.getByTestId('sentence').first().click();
  await tapSpeaker(page, page.getByTestId('sentence-card'));
  await expect.poll(async () => (await plays(page)).at(-1)?.source).toBe('system');
  await page.keyboard.press('Escape');
  // Retry submits a new job; this time it renders.
  const before = fake.state.kicks;
  fake.state.status = 'pending';
  await state.getByRole('button', { name: 'לנסות שוב' }).click();
  await expect.poll(() => fake.state.kicks).toBe(before + 1);
  await expect(state).toHaveAttribute('data-phase', /queued|rendering/);
  for (const u of fake.state.units) fake.state.ready.add(`${u.v}:${u.k}`);
  fake.state.status = 'done';
  await expect(state).toHaveAttribute('data-phase', 'ready', { timeout: 15_000 });
});
