/**
 * Content reports (spec 5.5): collects the "report a problem" events from a backup file exported in
 * the app, or from the sync backend, and writes content/reports.json grouped by lemma, so a later
 * content pass can fix them in bulk. Prints counts only.
 *
 *   pnpm reports path/to/lexbites-backup.json
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... LEXBITES_KEY_HASH=... pnpm reports
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contentDir, SHARD_SIZE, loadLemmas } from './content-rules';

interface ReportEvent {
  type: string;
  userId: string;
  at: number;
  payload: { lemmaId?: number; lemma?: string; kind?: string; tier?: string };
}

async function fromBackup(file: string): Promise<ReportEvent[]> {
  const data = JSON.parse(await readFile(file, 'utf8')) as { events?: ReportEvent[] };
  return (data.events ?? []).filter((e) => e.type === 'report');
}

async function fromBackend(): Promise<ReportEvent[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const hash = process.env.LEXBITES_KEY_HASH;
  if (!url || !key || !hash)
    throw new Error('pass a backup file or set SUPABASE_URL, SUPABASE_ANON_KEY, LEXBITES_KEY_HASH');
  const res = await fetch(
    `${url.replace(/\/+$/, '')}/rest/v1/lb_events?select=data&data->>type=eq.report&limit=10000`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'x-lexbites-key': hash },
    },
  );
  if (!res.ok) throw new Error(`backend: ${res.status}`);
  return ((await res.json()) as { data: ReportEvent }[]).map((r) => r.data);
}

async function main() {
  const file = process.argv[2];
  const events = file ? await fromBackup(file) : await fromBackend();
  const lemmas = new Map((await loadLemmas()).map((l) => [l.id, l]));
  const by = new Map<
    number,
    {
      lemmaId: number;
      lemma: string;
      shard: string | null;
      tier: string;
      count: number;
      kinds: Record<string, number>;
      lastAt: number;
    }
  >();
  for (const e of events) {
    const id = Number(e.payload.lemmaId);
    if (!id) continue;
    const l = lemmas.get(id);
    const row = by.get(id) ?? {
      lemmaId: id,
      lemma: e.payload.lemma ?? l?.lemma ?? '',
      shard: l ? String(Math.floor((l.rank - 1) / SHARD_SIZE)).padStart(4, '0') : null,
      tier: e.payload.tier ?? '?',
      count: 0,
      kinds: {},
      lastAt: 0,
    };
    row.count++;
    const k = e.payload.kind ?? 'other';
    row.kinds[k] = (row.kinds[k] ?? 0) + 1;
    row.lastAt = Math.max(row.lastAt, e.at);
    by.set(id, row);
  }
  const out = [...by.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  await writeFile(path.join(contentDir, 'reports.json'), JSON.stringify(out, null, 2) + '\n');
  const kinds: Record<string, number> = {};
  for (const r of out) for (const [k, n] of Object.entries(r.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
  console.info(
    `reports: ${events.length} event(s), ${out.length} word(s), by kind ${JSON.stringify(kinds)}`,
  );
  console.info('written: content/reports.json (fix entries in the listed shards, then validate)');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
