import { beforeEach, describe, expect, it } from 'vitest';
import { db, type DailyStats } from '@/data/db';
import { addEvent, bumpDaily, exportAll, importAll, putWord } from '@/data/repo';
import { introduceWord } from '@/engine/learn';
import { pull, push, type SyncConfig } from './engine';

/** In-memory PostgREST stand-in implementing upsert with last-write-wins and server_at pulls. */
function fakeServer() {
  const tables = new Map<
    string,
    Map<string, { row: Record<string, unknown>; server_at: string }>
  >();
  let clock = 0;
  const keyCols: Record<string, string[]> = {
    lb_users: ['id'],
    lb_user_words: ['user_id', 'lemma_id'],
    lb_daily: ['user_id', 'date'],
    lb_presence: ['user_id'],
    lb_reviews: ['id'],
    lb_events: ['id'],
  };
  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input));
    const table = u.pathname.split('/').pop()!;
    const store = tables.get(table) ?? new Map();
    tables.set(table, store);
    if (init?.method === 'POST') {
      const rows = JSON.parse(String(init.body)) as Record<string, unknown>[];
      for (const r of rows) {
        const key = keyCols[table]!.map((k) => String(r[k])).join('|');
        const cur = store.get(key);
        if (cur && Number(cur.row.updated_at) > Number(r.updated_at)) continue;
        store.set(key, {
          row: r,
          server_at: new Date(Date.UTC(2026, 0, 1) + ++clock).toISOString(),
        });
      }
      return new Response(null, { status: 201 });
    }
    const gt = (u.searchParams.get('server_at') ?? 'gt.1970').slice(3);
    const out = [...store.values()]
      .filter((x) => x.server_at > gt)
      .sort((a, b) => a.server_at.localeCompare(b.server_at))
      .map((x) => ({ data: x.row.data, server_at: x.server_at }));
    return new Response(JSON.stringify(out), { status: 200 });
  };
  return { f: f as typeof fetch, tables };
}

const cfg: SyncConfig = { url: 'https://example.supabase.co', anonKey: 'anon', keyHash: 'h' };

async function wipe() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

describe('sync', () => {
  beforeEach(wipe);

  it('pushes the outbox and empties it', async () => {
    const server = fakeServer();
    await putWord(introduceWord('rotem', 5, 1000, 'dev-a'));
    await bumpDaily('rotem', '2026-10-12', { xp: 30 }, 60);
    await addEvent({ userId: 'rotem', type: 'nudge', to: 'noa', payload: { emoji: '👋' } });
    expect(await db.outbox.count()).toBeGreaterThan(0);
    await push(cfg, server.f);
    expect(await db.outbox.count()).toBe(0);
    expect(server.tables.get('lb_user_words')?.size).toBe(1);
    expect(server.tables.get('lb_daily')?.size).toBe(1);
    expect(server.tables.get('lb_events')?.size).toBe(1);
  });

  it('a second device pulls everything, and last write wins on conflicts', async () => {
    const server = fakeServer();
    await putWord({ ...introduceWord('noa', 9, 1000, 'dev-a'), updatedAt: 5000, favorite: true });
    await push(cfg, server.f);
    await wipe();
    // The second device has an older edit of the same word and a newer daily row.
    await db.userWords.put({ ...introduceWord('noa', 9, 1000, 'dev-b'), updatedAt: 1000 });
    const newer: DailyStats = {
      userId: 'noa',
      date: '2026-10-12',
      xp: 99,
      newWords: 0,
      reviews: 0,
      correct: 0,
      ms: 0,
      sessions: 0,
      goal: 60,
      goalReached: true,
      updatedAt: 9_999_999_999_999,
      deviceId: 'dev-b',
    };
    await db.dailyStats.put(newer);
    const touched = await pull(cfg, server.f);
    expect(touched.has('noa')).toBe(true);
    expect((await db.userWords.get(['noa', 9]))?.favorite).toBe(true);
    expect((await db.dailyStats.get(['noa', '2026-10-12']))?.xp).toBe(99);
  });

  it('ignores rows that do not belong to a known profile', async () => {
    const server = fakeServer();
    server.tables.set(
      'lb_presence',
      new Map([
        [
          '_probe',
          {
            row: { data: { userId: '_probe' }, updated_at: 1 },
            server_at: '2026-01-02T00:00:00.000Z',
          },
        ],
      ]),
    );
    await pull(cfg, server.f);
    expect(await db.presence.count()).toBe(0);
  });
});

describe('export and import', () => {
  beforeEach(wipe);

  it('round-trips and merges without deleting', async () => {
    await putWord(introduceWord('rotem', 1, 1000, 'd'));
    await bumpDaily('rotem', '2026-10-10', { xp: 40 }, 60);
    const file = await exportAll();
    await wipe();
    await putWord(introduceWord('rotem', 2, 1000, 'd'));
    const r = await importAll(file);
    expect(r.words).toBe(1);
    expect(await db.userWords.count()).toBe(2);
    expect((await db.dailyStats.get(['rotem', '2026-10-10']))?.xp).toBe(40);
    // Importing again changes nothing.
    const again = await importAll(file);
    expect(again.words).toBe(0);
  });
});
