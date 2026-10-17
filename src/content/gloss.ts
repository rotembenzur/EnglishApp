/**
 * Lookups for Read mode and texts, cached in IndexedDB: a word card for any word (authored
 * content when there is some, else dictionary + translation), sentence translations, and the
 * session content of a word added from a text (its own sentences from the text).
 */
import type { LemmaInfo, Sentence, WordContent } from '@/engine/types';
import { db } from '@/data/db';
import { capitalize, lookup, translateMany, type Fetcher, type Gloss } from './enrich';
import { getContent, peekContent } from './inventory';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

function fromContent(c: WordContent): Gloss {
  return {
    lemma: c.lemma,
    hebrew: c.hebrew,
    pos: c.pos,
    examples: c.sentences.map((s) => s.en),
    ...(c.definition ? { definition: c.definition } : {}),
    ...(c.ipa ? { ipa: c.ipa } : {}),
    ...(c.audioUrl ? { audioUrl: c.audioUrl } : {}),
    ...(c.audioUrlUk ? { audioUrlUk: c.audioUrlUk } : {}),
  };
}

export class LookupError extends Error {
  constructor(public readonly offline: boolean) {
    super(offline ? 'offline' : 'lookup failed');
  }
}

/**
 * The card for one word. Authored or cached content first (instant, offline), then the gloss
 * cache, then the network. Throws LookupError when nothing can be found (the card shows retry).
 * Failures are never cached, so a retry always goes back to the network.
 */
export async function getGloss(word: string, info?: LemmaInfo, f?: Fetcher): Promise<Gloss> {
  if (info) {
    const c = peekContent(info.id) ?? (await getContent(info.id, { online: false }));
    if (c && c.hebrew.length) return fromContent(c);
  }
  const key = (info?.lemma ?? word).toLowerCase();
  const hit = await db.glossCache.get(key);
  if (hit) return hit.gloss;
  if (!online()) throw new LookupError(true);
  const g = await lookup(key, f);
  if (!g) throw new LookupError(false);
  await db.glossCache.put({ lemma: key, gloss: g, at: Date.now() });
  return g;
}

/** Hebrew for each English string; cached; null where the network gave nothing. */
export async function translateAll(
  texts: readonly string[],
  f?: Fetcher,
): Promise<(string | null)[]> {
  const cached = await db.translations.bulkGet([...texts]);
  const out = cached.map((c) => c?.he ?? null);
  const missing = texts.map((t, i) => (out[i] ? -1 : i)).filter((i) => i >= 0);
  if (!missing.length || !online()) return out;
  const fresh = await translateMany(
    missing.map((i) => texts[i]!),
    f,
  );
  const rows = [];
  for (let k = 0; k < missing.length; k++) {
    const he = fresh[k];
    if (!he) continue;
    out[missing[k]!] = he;
    rows.push({ en: texts[missing[k]!]!, he, at: Date.now() });
  }
  if (rows.length) await db.translations.bulkPut(rows);
  return out;
}

/** Cached translations only (instant, for first paint). */
export async function cachedTranslations(texts: readonly string[]): Promise<(string | null)[]> {
  return (await db.translations.bulkGet([...texts])).map((c) => c?.he ?? null);
}

/**
 * Make sure a word from a text can be studied: authored or cached content is kept as it is;
 * otherwise content is built from the lookup, with the text's own sentences first and the
 * dictionary examples after. Returns false when the word cannot be looked up now.
 */
export async function ensureContent(
  info: LemmaInfo,
  fromText: readonly string[],
  f?: Fetcher,
): Promise<boolean> {
  const existing = await getContent(info.id, { online: false });
  if (existing) return true;
  let g: Gloss;
  try {
    g = await getGloss(info.lemma, info, f);
  } catch {
    return false;
  }
  const ens = [...new Set([...fromText.map((s) => s.trim()), ...g.examples.map(capitalize)])]
    .filter((s) => s.length <= 300)
    .slice(0, 4);
  const hes = await translateAll(ens, f);
  const sentences: Sentence[] = ens
    .map((en, i) => ({ en, he: hes[i] ?? '' }))
    .filter((s, i) => s.he || i < fromText.length);
  if (!sentences.length) return false;
  const c: WordContent = {
    lemmaId: info.id,
    lemma: info.lemma,
    tier: 'B',
    pos: g.pos.length ? g.pos : info.pos,
    hebrew: g.hebrew,
    sentences,
    auto: true,
    ...(g.ipa ? { ipa: g.ipa } : {}),
    ...(g.definition ? { definition: g.definition } : {}),
    ...(g.audioUrl ? { audioUrl: g.audioUrl } : {}),
    ...(g.audioUrlUk ? { audioUrlUk: g.audioUrlUk } : {}),
  };
  await db.contentCache.put({ ...c, fetchedAt: Date.now() });
  return true;
}
