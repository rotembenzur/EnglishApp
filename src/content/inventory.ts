/**
 * Content access: the lemma inventory (always local, precached), Tier A shards (lazy, precached),
 * curated lists, and Tier B runtime enrichment (cached in IndexedDB). See spec 5.
 */
import { bandOf, type Band } from '@/engine/difficulty';
import type { LemmaInfo, WordContent } from '@/engine/types';
import { db } from '@/data/db';
import { enrich } from './enrich';

const BASE = import.meta.env.BASE_URL;
const SHARD_SIZE = 200;

export interface Manifest {
  version: number;
  builtAt: string;
  lemmaCount: number;
  shards: { id: string; from: number; to: number; count: number }[];
  curated: string[];
  skip?: number[];
}

/** Raw shard entry (content/schema.json). */
interface ShardEntry {
  id: number;
  lemma: string;
  pos: string[];
  ipa: string;
  ipaUk?: string;
  hebrew: string[];
  definition: string;
  sentences: { en: string; he: string }[];
  collocations?: string[];
  hook?: string;
  context?: { en: string; he: string };
  forms?: string[];
  tags?: string[];
}

export interface CuratedItem {
  id: string;
  text: string;
  kind: 'phrasal' | 'idiom' | 'collocation';
  d: number;
  pos?: string[];
  hebrew: string[];
  definition?: string;
  sentences: { en: string; he: string }[];
  tags?: string[];
}

/** Curated items live in their own id range so they never collide with lemma ids. */
export const CURATED_ID_BASE = 1_000_000;
const CURATED_OFFSETS: Record<string, number> = {
  'phrasal-verbs': 0,
  idioms: 100_000,
  collocations: 200_000,
};

let manifestP: Promise<Manifest> | null = null;
let inventoryP: Promise<Inventory> | null = null;
const shardCache = new Map<number, Promise<Map<number, WordContent>>>();
const contentMem = new Map<number, WordContent>();

export interface Inventory {
  lemmas: LemmaInfo[];
  byId: Map<number, LemmaInfo>;
  byLemma: Map<string, LemmaInfo>;
  tierAIds: Set<number>;
  curated: Map<number, CuratedItem>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadManifest(): Promise<Manifest> {
  manifestP ??= fetchJson<Manifest>('content/manifest.json');
  return manifestP;
}

type Packed = [number, string, number, string, number, string, string, number];

export function loadInventory(): Promise<Inventory> {
  inventoryP ??= (async () => {
    const [manifest, packed] = await Promise.all([
      loadManifest(),
      fetchJson<Packed[]>('content/lemmas.min.json'),
    ]);
    const tierAIds = new Set<number>();
    const shardRanks = new Set(manifest.shards.map((s) => Number(s.id)));
    const skip = new Set(manifest.skip ?? []);
    const lemmas: LemmaInfo[] = packed.map(([id, lemma, rank, pos, d, band, tags, family]) => {
      const shard = Math.floor((rank - 1) / SHARD_SIZE);
      const tier = shardRanks.has(shard) ? 'A' : 'C';
      if (tier === 'A') tierAIds.add(id);
      return {
        id,
        lemma,
        rank,
        pos: pos ? pos.split(',') : [],
        d,
        band: band as Band,
        tags: tags ? tags.split(',') : [],
        family,
        tier,
        kind: skip.has(id) ? 'skip' : 'word',
      };
    });
    const curated = new Map<number, CuratedItem>();
    for (const name of manifest.curated) {
      const offset = CURATED_OFFSETS[name];
      if (offset === undefined) continue;
      const items = await fetchJson<CuratedItem[]>(`content/curated/${name}.json`).catch(() => []);
      items.forEach((it, i) => {
        const id = CURATED_ID_BASE + offset + i + 1;
        curated.set(id, it);
        lemmas.push({
          id,
          lemma: it.text,
          rank: 0,
          pos: it.pos ?? ['other'],
          d: it.d,
          band: bandOf(it.d),
          tags: it.tags ?? [
            it.kind === 'phrasal'
              ? 'phrasal verbs'
              : it.kind === 'idiom'
                ? 'idioms'
                : 'collocations',
          ],
          family: 0,
          tier: 'A',
          kind: it.kind,
        });
        tierAIds.add(id);
      });
    }
    return {
      lemmas,
      byId: new Map(lemmas.map((l) => [l.id, l])),
      byLemma: new Map(lemmas.filter((l) => l.kind === 'word').map((l) => [l.lemma, l])),
      tierAIds,
      curated,
    };
  })();
  return inventoryP;
}

function shardOf(rank: number): number {
  return Math.floor((rank - 1) / SHARD_SIZE);
}

function loadShard(index: number): Promise<Map<number, WordContent>> {
  let p = shardCache.get(index);
  if (!p) {
    p = fetchJson<ShardEntry[]>(`content/shards/${String(index).padStart(4, '0')}.json`)
      .then((entries) => {
        const m = new Map<number, WordContent>();
        for (const e of entries) {
          const c: WordContent = {
            lemmaId: e.id,
            lemma: e.lemma,
            tier: 'A',
            pos: e.pos,
            ipa: e.ipa,
            ...(e.ipaUk ? { ipaUk: e.ipaUk } : {}),
            hebrew: e.hebrew,
            definition: e.definition,
            sentences: e.sentences,
            ...(e.collocations ? { collocations: e.collocations } : {}),
            ...(e.hook ? { hook: e.hook } : {}),
            ...(e.context ? { context: e.context } : {}),
            ...(e.forms ? { forms: e.forms } : {}),
            auto: false,
          };
          m.set(e.id, c);
          contentMem.set(e.id, c);
        }
        return m;
      })
      .catch(() => new Map());
    shardCache.set(index, p);
  }
  return p;
}

function curatedContent(id: number, it: CuratedItem): WordContent {
  return {
    lemmaId: id,
    lemma: it.text,
    tier: 'A',
    pos: it.pos ?? ['other'],
    hebrew: it.hebrew,
    ...(it.definition ? { definition: it.definition } : {}),
    sentences: it.sentences,
    auto: false,
  };
}

/** Synchronous peek at already-loaded content (for render paths). */
export function peekContent(lemmaId: number): WordContent | undefined {
  return contentMem.get(lemmaId);
}

/**
 * Content for a lemma: Tier A shard, else cached Tier B, else enrich online (when `online`).
 * Returns null when nothing usable is available (fewer than 2 sentences or no Hebrew).
 */
export async function getContent(
  lemmaId: number,
  opts: { online?: boolean } = {},
): Promise<WordContent | null> {
  const mem = contentMem.get(lemmaId);
  if (mem) return mem;
  const inv = await loadInventory();
  const curated = inv.curated.get(lemmaId);
  if (curated) {
    const c = curatedContent(lemmaId, curated);
    contentMem.set(lemmaId, c);
    return c;
  }
  const info = inv.byId.get(lemmaId);
  if (!info) return null;
  if (inv.tierAIds.has(lemmaId)) {
    const shard = await loadShard(shardOf(info.rank));
    const c = shard.get(lemmaId);
    if (c) return c;
  }
  const cached = await db.contentCache.get(lemmaId);
  if (cached && !cached.failedUntil) {
    contentMem.set(lemmaId, cached);
    return cached;
  }
  if (cached?.failedUntil && cached.failedUntil > Date.now()) return null;
  if (opts.online === false || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  const enriched = await enrich(info).catch(() => null);
  if (enriched && usable(enriched)) {
    await db.contentCache.put({ ...enriched, fetchedAt: Date.now() });
    contentMem.set(lemmaId, enriched);
    return enriched;
  }
  await db.contentCache.put({
    lemmaId,
    lemma: info.lemma,
    tier: 'B',
    pos: info.pos,
    hebrew: [],
    sentences: [],
    auto: true,
    fetchedAt: Date.now(),
    failedUntil: Date.now() + 7 * 86_400_000,
  });
  return null;
}

/** Every word ever shown must have Hebrew and at least two example sentences (spec 1). */
export function usable(c: WordContent): boolean {
  return c.hebrew.length > 0 && c.sentences.length >= 2;
}

/** Load several items' content in parallel (preloading a session). */
export async function getContents(
  ids: readonly number[],
  opts: { online?: boolean } = {},
): Promise<Map<number, WordContent>> {
  const out = new Map<number, WordContent>();
  await Promise.all(
    ids.map(async (id) => {
      const c = await getContent(id, opts);
      if (c) out.set(id, c);
    }),
  );
  return out;
}

/** Tier A content near a difficulty, for distractor pools. Loads the relevant shard(s). */
export async function distractorPool(around: number[]): Promise<WordContent[]> {
  const inv = await loadInventory();
  const manifest = await loadManifest();
  const indexes = new Set<number>();
  for (const id of around) {
    const l = inv.byId.get(id);
    if (l && l.rank > 0) indexes.add(Math.min(shardOf(l.rank), manifest.shards.length - 1));
  }
  if (!indexes.size && manifest.shards.length) indexes.add(0);
  // Always include a neighbour shard for variety.
  for (const i of [...indexes]) if (i + 1 < manifest.shards.length) indexes.add(i + 1);
  const maps = await Promise.all([...indexes].filter((i) => i >= 0).map(loadShard));
  return maps.flatMap((m) => [...m.values()]);
}

export function resetContentCachesForTests(): void {
  manifestP = null;
  inventoryP = null;
  shardCache.clear();
  contentMem.clear();
}
