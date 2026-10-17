/**
 * Tier B runtime enrichment (spec 5.2): free dictionary API for definition, IPA, audio and
 * examples; free translation endpoints for Hebrew. Results are cached by the caller.
 * Network responses are also cached by the service worker (cache-first).
 */
import type { LemmaInfo, Sentence, WordContent } from '@/engine/types';

const HEBREW = /[\u0590-\u05FF]/;

interface DictPhonetic {
  text?: string;
  audio?: string;
}
interface DictMeaning {
  partOfSpeech?: string;
  definitions?: { definition?: string; example?: string }[];
  synonyms?: string[];
}
interface DictEntry {
  word?: string;
  phonetic?: string;
  phonetics?: DictPhonetic[];
  meanings?: DictMeaning[];
}

export type Fetcher = (url: string) => Promise<Response>;

const POS_MAP: Record<string, string> = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adj',
  adverb: 'adv',
  preposition: 'prep',
  conjunction: 'conj',
  pronoun: 'pron',
  interjection: 'interj',
  determiner: 'det',
};

async function fetchJson<T>(f: Fetcher, url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await Promise.race([
      f(url),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const GOOGLE = (q: string) =>
  `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=he&dt=t&q=${encodeURIComponent(q)}`;

function googleText(g: unknown): string | null {
  if (!Array.isArray(g) || !Array.isArray(g[0])) return null;
  const s = (g[0] as unknown[])
    .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : ''))
    .join('');
  return s.trim() ? s : null;
}

/**
 * Translate English to Hebrew: Google's public gtx endpoint first (fast, good with single words
 * and allows CORS), MyMemory as the fallback (small daily quota, often answers with a warning).
 */
export async function translate(text: string, f: Fetcher = fetch): Promise<string | null> {
  const g = googleText(await fetchJson<unknown[]>(f, GOOGLE(text), 6000));
  if (g && HEBREW.test(g)) return clean(g);
  const mm = await fetchJson<{
    responseData?: { translatedText?: string };
    responseStatus?: number;
  }>(
    f,
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|he`,
    6000,
  );
  const a = mm?.responseData?.translatedText?.trim();
  if (a && HEBREW.test(a) && !/MYMEMORY WARNING|QUERY LENGTH/i.test(a)) return clean(a);
  return null;
}

/**
 * Translate many sentences in as few requests as possible: lines joined with newlines (Google
 * keeps them), about 1,500 characters per request. A batch whose line count comes back wrong is
 * translated line by line. Entries that fail stay null.
 */
export async function translateMany(
  texts: readonly string[],
  f: Fetcher = fetch,
): Promise<(string | null)[]> {
  const out: (string | null)[] = texts.map(() => null);
  const batches: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  texts.forEach((t, i) => {
    if (cur.length && len + t.length > 1500) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += t.length + 1;
  });
  if (cur.length) batches.push(cur);
  for (const b of batches) {
    const joined = b.map((i) => texts[i]!.replace(/\s+/g, ' ')).join('\n');
    const g =
      b.length > 1 ? googleText(await fetchJson<unknown[]>(f, GOOGLE(joined), 10000)) : null;
    const lines = g?.split('\n').map((x) => x.trim()) ?? [];
    if (lines.length === b.length && lines.every((x) => HEBREW.test(x))) {
      b.forEach((i, k) => (out[i] = clean(lines[k]!)));
      continue;
    }
    for (const i of b) out[i] = await translate(texts[i]!, f);
  }
  return out;
}

function clean(s: string): string {
  return s
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickAudio(phonetics: DictPhonetic[] = []): { us?: string; uk?: string } {
  const withAudio = phonetics.filter((p) => p.audio);
  const us = withAudio.find((p) => /-us\.mp3$/i.test(p.audio!))?.audio;
  const uk = withAudio.find((p) => /-uk\.mp3$/i.test(p.audio!))?.audio;
  const any = withAudio[0]?.audio;
  return { us: us ?? (uk ? undefined : any), uk };
}

export const wordRe = (lemma: string) =>
  new RegExp(
    `\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, Math.max(3, lemma.length - 2))}`,
    'i',
  );

/** What a word card needs at minimum: Hebrew, plus a definition, IPA and audio when known. */
export interface Gloss {
  lemma: string;
  hebrew: string[];
  definition?: string;
  ipa?: string;
  pos: string[];
  audioUrl?: string;
  audioUrlUk?: string;
  /** Dictionary examples (English only), for words added to learning from a text. */
  examples: string[];
}

/**
 * A light lookup for any word (Read mode and texts): the dictionary is optional, Hebrew is not.
 * Returns null only when no translation could be fetched (the caller offers a retry).
 */
export async function lookup(lemma: string, f: Fetcher = fetch): Promise<Gloss | null> {
  const [entries, hebrewWord] = await Promise.all([
    fetchJson<DictEntry[]>(
      f,
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lemma)}`,
      6000,
    ),
    translate(lemma, f),
  ]);
  if (!hebrewWord) return null;
  const d = parseDict(entries, lemma);
  return {
    lemma,
    hebrew: [hebrewWord],
    pos: d.pos,
    examples: d.examples,
    ...(d.definition ? { definition: d.definition } : {}),
    ...(d.ipa ? { ipa: d.ipa } : {}),
    ...(d.audio.us ? { audioUrl: d.audio.us } : {}),
    ...(d.audio.uk ? { audioUrlUk: d.audio.uk } : {}),
  };
}

function parseDict(entries: DictEntry[] | null, lemma: string) {
  const entry = Array.isArray(entries) ? entries : [];
  const meanings = entry.flatMap((e) => e.meanings ?? []);
  const phonetics = entry.flatMap((e) => e.phonetics ?? []);
  const raw =
    entry.find((e) => e.phonetic)?.phonetic ?? phonetics.find((p) => p.text)?.text ?? undefined;
  const pos = [
    ...new Set(meanings.map((m) => POS_MAP[m.partOfSpeech ?? ''] ?? '').filter(Boolean)),
  ].slice(0, 3);
  const examples = [
    ...new Set(
      meanings
        .flatMap((m) => m.definitions ?? [])
        .map((d) => d.example?.trim())
        .filter(
          (x): x is string => !!x && x.length >= 12 && x.length <= 200 && wordRe(lemma).test(x),
        ),
    ),
  ].slice(0, 3);
  return {
    ipa: raw ? (raw.startsWith('/') ? raw : `/${raw}/`) : undefined,
    audio: pickAudio(phonetics),
    pos,
    definition: meanings[0]?.definitions?.[0]?.definition,
    examples,
  };
}

/** Enrich one lemma to Tier B. Returns null when the word has no dictionary entry. */
export async function enrich(info: LemmaInfo, f: Fetcher = fetch): Promise<WordContent | null> {
  const entries = await fetchJson<DictEntry[]>(
    f,
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(info.lemma)}`,
  );
  const { ipa, audio, pos, definition, examples } = parseDict(entries, info.lemma);
  // Words without two real example sentences are not shown in sessions (spec 1); they wait for
  // Tier A. Read mode and texts use lookup() instead, which needs no examples.
  if (examples.length < 2) return null;
  const hebrewWord = await translate(info.lemma, f);
  if (!hebrewWord) return null;
  const hebrew = [hebrewWord];
  const sentences: Sentence[] = [];
  for (const en of examples) {
    const he = await translate(en, f);
    if (he) sentences.push({ en: capitalize(en), he });
  }
  const audioUrl = audio.us;
  const audioUrlUk = audio.uk;
  return {
    lemmaId: info.id,
    lemma: info.lemma,
    tier: 'B',
    pos: pos.length ? pos : info.pos,
    ...(ipa ? { ipa } : {}),
    hebrew,
    ...(definition ? { definition } : {}),
    sentences,
    ...(audioUrl ? { audioUrl } : {}),
    ...(audioUrlUk ? { audioUrlUk } : {}),
    auto: true,
  };
}

export function capitalize(s: string): string {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : t + '.';
}
