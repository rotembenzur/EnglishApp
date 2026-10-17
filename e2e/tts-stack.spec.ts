import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import { expect, test } from '@playwright/test';

/**
 * Text audio end to end, nothing faked: the app saves a text and talks to a local PostgREST
 * running supabase/schema.sql and supabase/tts.sql (through a gateway that stands in for
 * Supabase's /rest/v1 and signs local tokens), the real lexbites-tts Edge Function under Deno,
 * and scripts/tts/render.py rendering with Kokoro. Skipped unless the backend is provided:
 *   LEXBITES_SYNC_REST=http://127.0.0.1:54330 LEXBITES_SYNC_JWT_SECRET=... LEXBITES_SYNC_PASS=...
 *   LEXBITES_TTS_PYTHON=<python with scripts/tts/requirements.txt> LEXBITES_TTS_MODELS=<dir>
 *   LEXBITES_DENO=<deno binary>
 * Chromium here cannot decode AAC, so the test checks the clips that arrive on the phone (valid
 * m4a in Cache Storage) and the ready state; playback of AAC is covered on the iPhone.
 */

const REST = process.env.LEXBITES_SYNC_REST;
const SECRET = process.env.LEXBITES_SYNC_JWT_SECRET;
const PASS = process.env.LEXBITES_SYNC_PASS;
const PY = process.env.LEXBITES_TTS_PYTHON;
const MODELS = process.env.LEXBITES_TTS_MODELS;
const DENO = process.env.LEXBITES_DENO;
const PROJECT = 'https://ngosxhpmudbgiiktqgoa.supabase.co';

test.skip(
  !REST || !SECRET || !PASS || !PY || !MODELS || !DENO,
  'needs PostgREST, Python with the TTS packages, the models and Deno (see the comment at the top)',
);

function jwt(role: string): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ role, exp: 2_000_000_000 });
  return `${h}.${p}.${createHmac('sha256', SECRET!).update(`${h}.${p}`).digest('base64url')}`;
}

const keyHash = () => createHash('sha256').update(`lexbites:${PASS}`).digest('hex');

/** Supabase's /rest/v1 in front of the local PostgREST, with a locally signed anon token. */
function gateway(port: number): Promise<Server> {
  const target = new URL(REST!);
  const srv = createServer((req, res) => {
    const path = (req.url ?? '/').replace(/^\/rest\/v1/, '');
    const { apikey: _apikey, ...rest } = req.headers;
    const headers = { ...rest, host: target.host, authorization: `Bearer ${jwt('anon')}` };
    const up = request(
      { host: target.hostname, port: target.port, path, method: req.method, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    req.pipe(up);
  });
  return new Promise((resolve) => srv.listen(port, () => resolve(srv)));
}

const procs: ChildProcess[] = [];
const fnAnswers: string[] = [];
let gw: Server;

test.beforeAll(async () => {
  gw = await gateway(54331);
  const fn = spawn(
    DENO!,
    ['run', '--allow-net', '--allow-env', 'supabase/functions/lexbites-tts/index.ts'],
    { env: { ...process.env, SUPABASE_URL: 'http://127.0.0.1:54331' }, stdio: 'ignore' },
  );
  procs.push(fn);
  await new Promise((r) => setTimeout(r, 3000));
});

test.afterAll(() => {
  for (const p of procs) p.kill();
  gw?.close();
});

test('text audio against the real schema, function and renderer', async ({ page }) => {
  test.setTimeout(240_000);
  await page.context().route(/dictionaryapi|mymemory|jina|translate\.googleapis/, (r) => r.abort());
  // Supabase: REST through the gateway, the function to the local Deno server.
  await page.context().route(`${PROJECT}/rest/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    const res = await route.fetch({ url: `http://127.0.0.1:54331${url.pathname}${url.search}` });
    await route.fulfill({
      response: res,
      headers: { ...res.headers(), 'access-control-allow-origin': '*' },
    });
  });
  await page.context().route(`${PROJECT}/functions/v1/lexbites-tts`, async (route) => {
    const res = await route.fetch({ url: 'http://127.0.0.1:8000/' });
    fnAnswers.push(await res.text());
    await route.fulfill({ response: res });
  });
  await page.goto('/welcome');
  await page.getByRole('button', { name: /רתם/ }).click();
  await page.evaluate(
    (k) =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('lexbites');
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ key: 'syncConfig', value: { keyHash: k } });
          tx.oncomplete = () => resolve();
        };
      }),
    keyHash(),
  );
  await page.goto('/texts');
  await page.getByRole('button', { name: /טקסט חדש/ }).click();
  await page
    .getByTestId('text-body')
    .fill('The new model reads charts aloud. Critics want transparent benchmarks.');
  await page.getByRole('button', { name: 'לשמור ולקרוא' }).click();
  const state = page.getByTestId('audio-state');
  await expect(state).toHaveAttribute('data-phase', /queued|rendering/, { timeout: 20_000 });

  // The renderer picks the job up from the database, as the workflow does.
  const render = spawn(PY!, ['-I', '-B', 'scripts/tts/render.py', MODELS!], {
    env: {
      ...process.env,
      SUPABASE_URL: 'x',
      SUPABASE_REST: REST!,
      SUPABASE_SERVICE_KEY: jwt('service_role'),
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  procs.push(render);
  let out = '';
  render.stdout!.on('data', (d) => (out += String(d)));
  await new Promise((r) => render.on('exit', r));
  expect(out).toMatch(/0 failed/);

  await expect(state).toHaveAttribute('data-phase', 'ready', { timeout: 30_000 });
  // The function checked the passphrase through RLS (it found the job) and had no token to start
  // the workflow with.
  expect(fnAnswers).toEqual(['{"dispatched":false}']);
  const stored = await page.evaluate(async () => {
    const cache = await caches.open('lexbites-tts-v1');
    const out: { url: string; ftyp: boolean; bytes: number }[] = [];
    for (const req of await cache.keys()) {
      const buf = new Uint8Array(await (await cache.match(req))!.arrayBuffer());
      out.push({
        url: req.url,
        ftyp: String.fromCharCode(...buf.slice(4, 8)) === 'ftyp',
        bytes: buf.length,
      });
    }
    return out;
  });
  expect(stored.length).toBeGreaterThanOrEqual(2);
  expect(stored.every((c) => c.ftyp && c.bytes > 2000)).toBe(true);
});
