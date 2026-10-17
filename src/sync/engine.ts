/**
 * Local-first sync with Supabase over plain REST (spec 9.3).
 * Writes: IndexedDB first, then the outbox, pushed when online.
 * Pulls: on open, on focus, every 60 seconds while open, and after each session.
 * Row tables merge last-write-wins by updatedAt; reviews and events merge by union.
 */
import { create } from 'zustand';
import type { ReviewRecord, UserWord } from '@/engine/types';
import {
  db,
  getKv,
  setKv,
  type AppEvent,
  type DailyStats,
  type Presence,
  type SyncTable,
  type UserProfile,
} from '@/data/db';
import { useApp } from '@/state/app';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export interface SyncConfig {
  url: string;
  anonKey: string;
  /** sha256('lexbites:' + passphrase), never the passphrase itself. */
  keyHash: string;
}

export type SyncStatus = 'off' | 'ok' | 'pending' | 'offline' | 'error' | 'syncing';

interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  error: string | null;
  configured: boolean;
}

export const useSync = create<SyncState>(() => ({
  status: 'off',
  lastSyncAt: null,
  error: null,
  configured: false,
}));

const REMOTE: Record<SyncTable, { table: string; conflict: string }> = {
  users: { table: 'lb_users', conflict: 'id' },
  userWords: { table: 'lb_user_words', conflict: 'user_id,lemma_id' },
  dailyStats: { table: 'lb_daily', conflict: 'user_id,date' },
  presence: { table: 'lb_presence', conflict: 'user_id' },
  reviews: { table: 'lb_reviews', conflict: 'id' },
  events: { table: 'lb_events', conflict: 'id' },
};

export async function hashPassphrase(p: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`lexbites:${p}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The project both phones use, from the app config (src/sync/config.ts). */
export const DEFAULT_PROJECT = { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY };

/**
 * The device stores only the passphrase hash. URL and anon key come from the app config unless
 * this device was pointed at a different project in Settings.
 */
export async function loadConfig(): Promise<SyncConfig | null> {
  const stored = await getKv<Partial<SyncConfig> | null>('syncConfig', null);
  if (!stored?.keyHash) return null;
  const url = stored.url || DEFAULT_PROJECT.url;
  const anonKey = stored.anonKey || DEFAULT_PROJECT.anonKey;
  return url && anonKey ? { url, anonKey, keyHash: stored.keyHash } : null;
}

export async function saveConfig(cfg: SyncConfig | null): Promise<void> {
  const stored: Partial<SyncConfig> | null = cfg && {
    keyHash: cfg.keyHash,
    ...(cfg.url !== DEFAULT_PROJECT.url ? { url: cfg.url } : {}),
    ...(cfg.anonKey !== DEFAULT_PROJECT.anonKey ? { anonKey: cfg.anonKey } : {}),
  };
  await setKv('syncConfig', stored);
  useSync.setState({ configured: !!cfg, status: cfg ? 'pending' : 'off', error: null });
}

/** Headers for any request to the project's REST API (row-level security reads the key). */
export function headers(
  cfg: SyncConfig,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'x-lexbites-key': cfg.keyHash,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function base(cfg: SyncConfig): string {
  return cfg.url.replace(/\/+$/, '') + '/rest/v1/';
}

/** Remote row shape for a local row. */
function toRemote(table: SyncTable, row: unknown): Record<string, unknown> {
  switch (table) {
    case 'users': {
      const r = row as UserProfile;
      return { id: r.id, data: r, updated_at: r.updatedAt, device_id: r.deviceId };
    }
    case 'userWords': {
      const r = row as UserWord;
      return {
        user_id: r.userId,
        lemma_id: r.lemmaId,
        data: r,
        updated_at: r.updatedAt,
        device_id: r.deviceId,
      };
    }
    case 'dailyStats': {
      const r = row as DailyStats;
      return {
        user_id: r.userId,
        date: r.date,
        data: r,
        updated_at: r.updatedAt,
        device_id: r.deviceId,
      };
    }
    case 'presence': {
      const r = row as Presence;
      return { user_id: r.userId, data: r, updated_at: r.updatedAt, device_id: r.deviceId };
    }
    case 'reviews': {
      const r = row as ReviewRecord;
      return { id: r.id, user_id: r.userId, data: r, updated_at: r.at, device_id: r.deviceId };
    }
    case 'events': {
      const { seen: _seen, ...r } = row as AppEvent;
      return { id: r.id, user_id: r.userId, data: r, updated_at: r.at, device_id: r.deviceId };
    }
  }
}

async function localRow(table: SyncTable, key: string): Promise<unknown> {
  switch (table) {
    case 'users':
      return db.users.get(key as UserProfile['id']);
    case 'userWords': {
      const [u, id] = key.split('|');
      return db.userWords.get([u as UserWord['userId'], Number(id)]);
    }
    case 'dailyStats': {
      const [u, d] = key.split('|');
      return db.dailyStats.get([u as DailyStats['userId'], d!]);
    }
    case 'presence':
      return db.presence.get(key as Presence['userId']);
    case 'reviews':
      return db.reviews.get(key);
    case 'events':
      return db.events.get(key);
  }
}

export async function push(cfg: SyncConfig, f: typeof fetch = fetch): Promise<number> {
  let pushed = 0;
  // The first connect can carry weeks of offline history; drain it in one run, bounded in time.
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const batch = await db.outbox.orderBy('seq').limit(400).toArray();
    if (!batch.length) break;
    const byTable = new Map<SyncTable, Map<string, number[]>>();
    for (const o of batch) {
      const m = byTable.get(o.table) ?? new Map<string, number[]>();
      m.set(o.key, [...(m.get(o.key) ?? []), o.seq!]);
      byTable.set(o.table, m);
    }
    for (const [table, keys] of byTable) {
      const rows: Record<string, unknown>[] = [];
      for (const key of keys.keys()) {
        const row = await localRow(table, key);
        if (row) rows.push(toRemote(table, row));
      }
      if (rows.length) {
        const { table: remote, conflict } = REMOTE[table];
        const res = await f(`${base(cfg)}${remote}?on_conflict=${conflict}`, {
          method: 'POST',
          headers: headers(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(rows),
        });
        if (!res.ok)
          throw new Error(`push ${remote}: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const seqs = [...keys.values()].flat();
      await db.outbox.bulkDelete(seqs);
      pushed += rows.length;
    }
  }
  return pushed;
}

interface RemoteRow {
  data: unknown;
  server_at: string;
}

/** Merge one pulled row into IndexedDB. Returns the user id it touched, if any. */
async function mergeRow(table: SyncTable, data: unknown): Promise<string | null> {
  if (!data || typeof data !== 'object') return null;
  const owner = (data as { userId?: string; id?: string })[table === 'users' ? 'id' : 'userId'];
  // Ignore rows that do not belong to a known profile (connection probes, foreign data).
  if (owner !== 'rotem' && owner !== 'noa') return null;
  switch (table) {
    case 'users': {
      const r = data as UserProfile;
      const cur = await db.users.get(r.id);
      if (!cur || cur.updatedAt < r.updatedAt) {
        await db.users.put(r);
        return r.id;
      }
      return null;
    }
    case 'userWords': {
      const r = data as UserWord;
      const cur = await db.userWords.get([r.userId, r.lemmaId]);
      if (!cur || cur.updatedAt < r.updatedAt) {
        await db.userWords.put(r);
        return r.userId;
      }
      return null;
    }
    case 'dailyStats': {
      const r = data as DailyStats;
      const cur = await db.dailyStats.get([r.userId, r.date]);
      if (!cur || cur.updatedAt < r.updatedAt) {
        await db.dailyStats.put(r);
        return r.userId;
      }
      return null;
    }
    case 'presence': {
      const r = data as Presence;
      const cur = await db.presence.get(r.userId);
      if (!cur || cur.updatedAt < r.updatedAt) {
        await db.presence.put(r);
        return r.userId;
      }
      return null;
    }
    case 'reviews': {
      const r = data as ReviewRecord;
      if (!(await db.reviews.get(r.id))) {
        await db.reviews.put(r);
        return r.userId;
      }
      return null;
    }
    case 'events': {
      const r = data as AppEvent;
      if (!(await db.events.get(r.id))) {
        await db.events.put({ ...r, seen: 0 });
        return r.userId;
      }
      return null;
    }
  }
}

/**
 * server_at is stamped when a row is written but becomes visible only when its transaction
 * commits, so a push still in flight can land behind a cursor that already moved past it (the
 * other phone pushing at the same moment). Each pull therefore starts this far behind the stored
 * cursor; merging is idempotent, so rows read twice are harmless.
 */
export const PULL_OVERLAP_MS = 2 * 60_000;

/** Postgres sends microseconds; trim to milliseconds so every engine (Safari too) parses it. */
function cursorMs(cursor: string): number {
  return Date.parse(cursor.replace(/(\.\d{3})\d+/, '$1'));
}

export function pullStart(cursor: string): string {
  const ms = cursorMs(cursor);
  return Number.isFinite(ms) ? new Date(Math.max(0, ms - PULL_OVERLAP_MS)).toISOString() : cursor;
}

export async function pull(cfg: SyncConfig, f: typeof fetch = fetch): Promise<Set<string>> {
  const touched = new Set<string>();
  for (const table of Object.keys(REMOTE) as SyncTable[]) {
    const cursorKey = `syncCursor:${table}`;
    const stored = await getKv<string>(cursorKey, '1970-01-01T00:00:00Z');
    let cursor = pullStart(stored);
    for (let page = 0; page < 50; page++) {
      const url = `${base(cfg)}${REMOTE[table].table}?select=data,server_at&server_at=gt.${encodeURIComponent(cursor)}&order=server_at.asc&limit=1000`;
      const res = await f(url, { headers: headers(cfg) });
      if (!res.ok) throw new Error(`pull ${table}: ${res.status}`);
      const rows = (await res.json()) as RemoteRow[];
      if (!rows.length) break;
      await db.transaction(
        'rw',
        [db.users, db.userWords, db.dailyStats, db.presence, db.reviews, db.events],
        async () => {
          for (const r of rows) {
            const u = await mergeRow(table, r.data);
            if (u) touched.add(u);
          }
        },
      );
      cursor = rows[rows.length - 1]!.server_at;
      // Rows re-read from the overlap must not move the stored cursor backwards.
      if (!(cursorMs(cursor) < cursorMs(stored))) await setKv(cursorKey, cursor);
      if (rows.length < 1000) break;
    }
  }
  return touched;
}

let running: Promise<void> | null = null;

/** Push then pull. Safe to call often; concurrent calls share one run. */
export function syncNow(): Promise<void> {
  running ??= (async () => {
    const cfg = await loadConfig();
    if (!cfg) {
      useSync.setState({ status: 'off', configured: false });
      return;
    }
    useSync.setState({ configured: true });
    if (!navigator.onLine) {
      useSync.setState({ status: 'offline' });
      return;
    }
    useSync.setState({ status: 'syncing' });
    try {
      await push(cfg);
      const touched = await pull(cfg);
      const left = await db.outbox.count();
      useSync.setState({ status: left ? 'pending' : 'ok', lastSyncAt: Date.now(), error: null });
      const me = useApp.getState().userId;
      if (me && touched.has(me)) await useApp.getState().reload();
      else if (touched.size) useApp.setState((s) => ({ version: s.version + 1 }));
    } catch (e) {
      useSync.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export type TestResult = 'ok' | 'passphrase' | 'network' | 'server';

/** Verify a config before saving it: one read, then one probe write that only the right hash passes. */
export async function testConfig(cfg: SyncConfig, f: typeof fetch = fetch): Promise<TestResult> {
  try {
    const res = await f(`${base(cfg)}lb_presence?select=user_id&limit=1`, {
      headers: headers(cfg),
    });
    if (!res.ok) return 'server';
    // RLS hides rows instead of failing; a wrong passphrase also returns []. Probe with a write.
    const probe = await f(`${base(cfg)}lb_presence?on_conflict=user_id`, {
      method: 'POST',
      headers: headers(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([
        { user_id: '_probe', data: {}, updated_at: Date.now(), device_id: 'probe' },
      ]),
    });
    if (probe.ok) return 'ok';
    // Row-level security rejects the write: 401 for the anon role, 403 on some gateways.
    return probe.status === 401 || probe.status === 403 ? 'passphrase' : 'server';
  } catch {
    return 'network';
  }
}

let timer: number | null = null;

export function startSyncLoop(): void {
  void loadConfig().then((cfg) =>
    useSync.setState({ configured: !!cfg, status: cfg ? 'pending' : 'off' }),
  );
  void syncNow();
  const onFocus = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () =>
    useSync.setState((s) => (s.configured ? { status: 'offline' } : s)),
  );
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 60_000);
}
