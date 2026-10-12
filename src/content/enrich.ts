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

/** Translate English to Hebrew: MyMemory first, Google's public gtx endpoint as fallback. */
export async function translate(text: string, f: Fetcher = fetch): Promise<string | null> {
  const mm = await fetchJson<{
    responseData?: { translatedText?: string };
    responseStatus?: number;
  }>(f, `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|he`);
  const a = mm?.responseData?.translatedText?.trim();
  if (a && HEBREW.test(a) && !/MYMEMORY WARNING|QUERY LENGTH/i.test(a)) return clean(a);
  const g = await fetchJson<unknown[]>(
    f,
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=he&dt=t&q=${encodeURIComponent(text)}`,
  );
  if (Array.isArray(g) && Array.isArray(g[0])) {
    const s = (g[0] as unknown[])
      .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : ''))
      .join('')
      .trim();
    if (s && HEBREW.test(s)) return clean(s);
  }
  return null;
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

const wordRe = (lemma: string) =>
  new RegExp(
    `\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, Math.max(3, lemma.length - 2))}`,
    'i',
  );

/** Enrich one lemma to Tier B. Returns null when the word has no dictionary entry. */
export async function enrich(info: LemmaInfo, f: Fetcher = fetch): Promise<WordContent | null> {
  const entries = await fetchJson<DictEntry[]>(
    f,
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(info.lemma)}`,
  );
  const entry = Array.isArray(entries) ? entries : [];
  const meanings = entry.flatMap((e) => e.meanings ?? []);
  const phonetics = entry.flatMap((e) => e.phonetics ?? []);
  const ipa =
    entry.find((e) => e.phonetic)?.phonetic ?? phonetics.find((p) => p.text)?.text ?? undefined;
  const audio = pickAudio(phonetics);
  const pos = [
    ...new Set(meanings.map((m) => POS_MAP[m.partOfSpeech ?? ''] ?? '').filter(Boolean)),
  ].slice(0, 3);
  const definition = meanings[0]?.definitions?.[0]?.definition;
  const examples = [
    ...new Set(
      meanings
        .flatMap((m) => m.definitions ?? [])
        .map((d) => d.example?.trim())
        .filter(
          (x): x is string =>
            !!x && x.length >= 12 && x.length <= 200 && wordRe(info.lemma).test(x),
        ),
    ),
  ].slice(0, 3);

  const hebrewWord = await translate(info.lemma, f);
  if (!hebrewWord) return null;
  const hebrew = [hebrewWord];
  // Words without two real example sentences are not shown (spec 1); they wait for Tier A.
  if (examples.length < 2) return null;
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
    ...(ipa ? { ipa: ipa.startsWith('/') ? ipa : `/${ipa}/` } : {}),
    hebrew,
    ...(definition ? { definition } : {}),
    sentences,
    ...(audioUrl ? { audioUrl } : {}),
    ...(audioUrlUk ? { audioUrlUk } : {}),
    auto: true,
  };
}

function capitalize(s: string): string {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(t) ? t : t + '.';
}
