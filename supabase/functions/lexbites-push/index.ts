/**
 * LexBites push sender (spec 9.6), a Supabase Edge Function deployed by
 * .github/workflows/push-server.yml. Callers:
 *  - pg_cron every 5 minutes: {"kind":"tick"} sends due daily reminders and streak alerts,
 *  - a trigger on lb_events inserts: {"kind":"nudge","id":...} pushes a rival nudge right away,
 *  - the app: GET for status, {"kind":"test","endpoint":...} for a test notification.
 *
 * Authorization: every POST carries x-lexbites-key (the passphrase hash). The function reads and
 * writes through the REST API with the anon key and that header, so row-level security decides
 * what it can see; a wrong key sees no subscriptions and sends nothing. It holds no database-wide
 * credential. The only secret is VAPID_PRIVATE_KEY.
 */
import {
  b64urlEncode,
  decryptPayload,
  encryptPayload,
  sendPush,
  vapidKeysMatch,
  type VapidKeys,
} from '../_shared/webpush.ts';
import {
  localClock,
  nudgeMessage,
  otherUser,
  planScheduled,
  readPrefs,
  TEST_MESSAGE,
  type DayRow,
  type NudgeEvent,
  type PushMessage,
  type PushPrefs,
  type PushState,
} from '../_shared/schedule.ts';
import { ANON_KEY, PROJECT_URL, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from '../_shared/keys.ts';

const VERSION = 6;
const REST = `${(Deno.env.get('SUPABASE_URL') || PROJECT_URL).replace(/\/+$/, '')}/rest/v1/`;
const VAPID: VapidKeys = {
  publicKey: VAPID_PUBLIC_KEY,
  privateKey: (Deno.env.get('VAPID_PRIVATE_KEY') ?? '').trim(),
  subject: VAPID_SUBJECT,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'content-type, x-lexbites-key, apikey, authorization, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

let keysReady: Promise<boolean> | null = null;
function ready(): Promise<boolean> {
  keysReady ??= VAPID.privateKey
    ? vapidKeysMatch(VAPID.publicKey, VAPID.privateKey)
    : Promise.resolve(false);
  return keysReady;
}

interface PushRow {
  endpoint: string;
  user_id: string;
  data: unknown;
  state: PushState | null;
}

function db(key: string) {
  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'x-lexbites-key': key,
    'Content-Type': 'application/json',
  };
  return {
    async get<T>(path: string): Promise<T> {
      const res = await fetch(REST + path, { headers });
      if (!res.ok) throw new Error(`GET ${path.split('?')[0]}: ${res.status}`);
      return (await res.json()) as T;
    },
    async patchState(endpoint: string, state: PushState): Promise<void> {
      const res = await fetch(`${REST}lb_push?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) console.error(`state update failed: ${res.status}`);
    },
    async remove(endpoint: string): Promise<void> {
      await fetch(`${REST}lb_push?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
        headers: { ...headers, Prefer: 'return=minimal' },
      });
    },
  };
}

type Db = ReturnType<typeof db>;

async function deliver(
  store: Db,
  prefs: PushPrefs,
  msg: PushMessage,
  state: PushState,
): Promise<{ ok: boolean; status: number; reason: string; gone: boolean }> {
  const res = await sendPush(
    prefs.subscription,
    { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag, kind: msg.kind },
    VAPID,
    {
      ttl: msg.kind === 'nudge' ? 6 * 3600 : 3 * 3600,
      urgency: msg.kind === 'nudge' || msg.kind === 'test' ? 'high' : 'normal',
    },
  );
  state.lastResult = { kind: msg.kind, status: res.status, reason: res.reason, at: Date.now() };
  if (res.gone) await store.remove(prefs.subscription.endpoint);
  else if (!res.ok)
    console.error(`push ${msg.kind} for ${prefs.userId}: ${res.status} ${res.body}`);
  return res;
}

async function tick(store: Db) {
  const now = Date.now();
  const subs = await store.get<PushRow[]>('lb_push?select=endpoint,user_id,data,state');
  if (!subs.length) return { subscriptions: 0, sent: 0 };
  const since = new Date(now - 400 * 86400_000).toISOString().slice(0, 10);
  const rows = await store.get<
    { user_id: string; date: string; xp: number | null; goalReached: boolean | null }[]
  >(
    `lb_daily?select=user_id,date,xp:data->xp,goalReached:data->goalReached&date=gte.${since}&order=date`,
  );
  const users = await store.get<{ id: string; goal: number | null }[]>(
    'lb_users?select=id,goal:data->settings->dailyGoal',
  );
  let sent = 0;
  for (const row of subs) {
    const prefs = readPrefs(row.data);
    if (!prefs) continue;
    const goal = users.find((u) => u.id === prefs.userId)?.goal;
    const days: DayRow[] = rows
      .filter((r) => r.user_id === prefs.userId)
      .map((r) => ({ date: r.date, xp: Number(r.xp ?? 0), goalReached: r.goalReached === true }));
    const { date } = localClock(now, prefs.tz, prefs.tzOffset);
    const rival = rows.find((r) => r.user_id === otherUser(prefs.userId) && r.date === date);
    const before = row.state ?? {};
    const plan = planScheduled({
      now,
      prefs,
      state: before,
      days,
      goal: typeof goal === 'number' ? goal : null,
      rivalToday: rival
        ? { xp: Number(rival.xp ?? 0), goalReached: rival.goalReached === true }
        : null,
    });
    let gone = false;
    for (const msg of plan.messages) {
      const res = await deliver(store, prefs, msg, plan.state);
      if (res.ok) sent++;
      gone ||= res.gone;
    }
    if (!gone && JSON.stringify(plan.state) !== JSON.stringify(before)) {
      await store.patchState(row.endpoint, plan.state);
    }
  }
  return { subscriptions: subs.length, sent };
}

async function nudge(store: Db, id: string) {
  const events = await store.get<{ data: NudgeEvent }[]>(
    `lb_events?select=data&id=eq.${encodeURIComponent(id)}`,
  );
  const ev = events[0]?.data;
  const msg = ev && nudgeMessage(ev, Date.now());
  if (!ev?.to || !msg) return { sent: 0 };
  const subs = await store.get<PushRow[]>(
    `lb_push?select=endpoint,user_id,data,state&user_id=eq.${encodeURIComponent(ev.to)}`,
  );
  let sent = 0;
  for (const row of subs) {
    const prefs = readPrefs(row.data);
    if (!prefs?.nudges || prefs.userId !== ev.to) continue;
    const state = { ...(row.state ?? {}) };
    const res = await deliver(store, prefs, msg, state);
    if (res.ok) sent++;
    if (!res.gone) await store.patchState(row.endpoint, state);
  }
  return { sent };
}

/**
 * Test notification for one phone. `found: false` tells the app its subscription row is missing
 * (for example removed after the push service reported it gone), so it can store it again.
 */
async function test(store: Db, endpoint: string) {
  const subs = await store.get<PushRow[]>(
    `lb_push?select=endpoint,user_id,data,state&endpoint=eq.${encodeURIComponent(endpoint)}`,
  );
  const row = subs[0];
  const prefs = row && readPrefs(row.data);
  if (!row || !prefs) return { ok: false, found: false, status: 0, reason: 'NotRegistered' };
  const state = { ...(row.state ?? {}) };
  const res = await deliver(store, prefs, TEST_MESSAGE, state);
  if (!res.gone) await store.patchState(row.endpoint, state);
  return { ok: res.ok, found: true, status: res.status, reason: res.reason };
}

/**
 * Self-test inside the real runtime: the encryption round-trips, and Apple's push service is
 * asked to take a message for a made-up device, so its answer shows whether it accepts our
 * token and headers (a header or token problem is reported before the unknown device).
 */
async function probe() {
  const enc = new TextEncoder();
  const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(48)));
  const sub = {
    endpoint: `https://web.push.apple.com/Q${token}`,
    keys: { p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) },
  };
  let roundTrip = false;
  try {
    const sealed = await encryptPayload(sub, enc.encode('probe'));
    const opened = await decryptPayload(sealed, ua.privateKey, uaPublic, auth);
    roundTrip = new TextDecoder().decode(opened) === 'probe';
  } catch (e) {
    console.error(`probe crypto: ${(e as Error).message}`);
  }
  const apple: Record<string, { status: number; reason: string }> = {};
  const other = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  const otherD = String((await crypto.subtle.exportKey('jwk', other.privateKey)).d);
  // Apple checks the token before the device: our real token must get BadDeviceToken (a made-up
  // device) and a token from a wrong key must get BadJwtToken. Push server CI asserts both.
  const variants: [string, VapidKeys, { topic?: string; urgency?: string; ttl?: number }][] = [
    ['real', VAPID, {}],
    ['controlWrongSigner', { ...VAPID, privateKey: otherD }, {}],
  ];
  for (const [name, keys, opts] of variants) {
    try {
      const r = await sendPush(sub, { title: 'probe' }, keys, {
        ttl: 60,
        ...(opts as { topic?: string }),
        ...(opts.urgency ? { urgency: opts.urgency as 'high' } : {}),
      });
      apple[name] = { status: r.status, reason: r.reason };
    } catch (e) {
      apple[name] = { status: 0, reason: (e as Error).message };
    }
  }
  return { ready: await ready(), version: VERSION, roundTrip, apple };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') {
    if (new URL(req.url).searchParams.has('probe')) return json(await probe());
    return json({ ok: true, ready: await ready(), version: VERSION });
  }
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const key = req.headers.get('x-lexbites-key') ?? '';
  if (!/^[0-9a-f]{64}$/.test(key)) return json({ error: 'unauthorized' }, 401);
  if (!(await ready())) return json({ error: 'VAPID_PRIVATE_KEY missing or wrong' }, 503);
  let body: { kind?: string; id?: string; endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const store = db(key);
  try {
    if (body.kind === 'tick') return json(await tick(store));
    if (body.kind === 'nudge' && body.id) return json(await nudge(store, body.id));
    if (body.kind === 'test' && body.endpoint) return json(await test(store, body.endpoint));
    return json({ error: 'unknown kind' }, 400);
  } catch (e) {
    console.error(`${body.kind}: ${(e as Error).message}`);
    return json({ error: (e as Error).message }, 500);
  }
});
