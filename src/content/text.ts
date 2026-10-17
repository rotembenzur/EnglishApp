/**
 * Text analysis for טקסטים (Read mode): sentences, word tokens mapped to inventory lemmas, names
 * and brands left out, auto-marking above the level, cloze sentences and a comprehension check
 * built from the text itself. Pure functions; unit tested in text.test.ts.
 */
import { type Rng, shuffle } from '@/engine/rng';
import type { LemmaInfo } from '@/engine/types';
import { lemmatize } from './lemmatize';

export interface TextToken {
  part: string;
  /** A word (letters), as opposed to spaces and punctuation. */
  word: boolean;
  lemma?: LemmaInfo;
  /** A name, brand or acronym: never highlighted or marked. */
  proper: boolean;
}

export interface TextSentence {
  text: string;
  tokens: TextToken[];
  /** Whitespace after the sentence (kept for layout, may hold line breaks). */
  gap: string;
}

export interface TextAnalysis {
  sentences: TextSentence[];
}

// prettier-ignore
const ABBR = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'vs', 'etc', 'inc', 'ltd', 'jr', 'sr', 'no', 'co', 'corp', 'prof',
  'e.g', 'i.e', 'approx', 'dept', 'est', 'fig', 'gen', 'gov', 'jan', 'feb', 'mar', 'apr', 'aug',
  'sept', 'sep', 'oct', 'nov', 'dec', 'u.s', 'u.k',
]);

/**
 * Companies, products and people that are also English words. Only skipped when capitalized
 * ("Meta announced" is a name, "meta" in lower case is a word).
 */
// prettier-ignore
const BRANDS = new Set([
  'anthropic', 'meta', 'mistral', 'apple', 'amazon', 'oracle', 'alphabet', 'gemini', 'claude',
  'llama', 'grok', 'copilot', 'slack', 'notion', 'zoom', 'tesla', 'windows', 'office', 'android',
  'chrome', 'edge', 'safari', 'outlook', 'teams', 'twitter', 'shell', 'target', 'subway', 'visa',
  'dove', 'jaguar', 'puma', 'corona', 'mercury', 'genesis', 'spark', 'snowflake', 'databricks',
  'cohere', 'perplexity', 'midjourney', 'runway', 'figma', 'canva', 'stripe', 'square', 'block',
  'signal', 'telegram', 'discord', 'reddit', 'wired', 'fortune', 'guardian', 'times', 'post',
  'economist', 'bloomberg', 'reuters', 'nature', 'science', 'cell',
]);

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

/** Split into sentences at . ! ? … followed by a capital, and at line breaks. */
export function splitSentences(body: string): { text: string; gap: string }[] {
  const out: { text: string; gap: string }[] = [];
  const text = body.replace(/\r\n?/g, '\n');
  let start = 0;
  const push = (end: number, gapEnd: number) => {
    const t = text.slice(start, end);
    if (t.trim()) out.push({ text: t, gap: text.slice(end, gapEnd) });
    else if (out.length) out[out.length - 1]!.gap += text.slice(start, gapEnd);
    start = gapEnd;
  };
  const re = /([.!?…]+["')\]”’]*)(\s+)(?=["'([“‘]?[A-Z0-9])|(\s*\n\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[3] !== undefined) {
      push(m.index, m.index + m[3].length);
      continue;
    }
    const end = m.index + m[1]!.length;
    const before =
      text
        .slice(start, m.index)
        .match(/([A-Za-z.]+)$/)?.[1]
        ?.toLowerCase() ?? '';
    // "Dr. Smith", "the U.S. Army", "J. Smith": not a sentence end.
    if (m[1] === '.' && (ABBR.has(before) || /^[a-z]$/.test(before))) continue;
    push(end, end + m[2]!.length);
  }
  if (start < text.length) push(text.length, text.length);
  return out;
}

function tokenize(s: string): { part: string; word: boolean }[] {
  const out: { part: string; word: boolean }[] = [];
  let last = 0;
  for (const m of s.matchAll(WORD)) {
    if (m.index > last) out.push({ part: s.slice(last, m.index), word: false });
    out.push({ part: m[0], word: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ part: s.slice(last), word: false });
  return out;
}

const bare = (w: string) => w.replace(/['’](s|d|ll|re|ve|m|t)$/i, '');
const isCapitalized = (w: string) => /^[A-Z][a-z]/.test(w);
/** OpenAI, ChatGPT, GPU, NASA: capitals after the first letter. */
const isMixedOrCaps = (w: string) => w.length >= 2 && /[A-Z]/.test(w.slice(1));

export function analyzeText(body: string, byLemma: Map<string, LemmaInfo>): TextAnalysis {
  const raw = splitSentences(body).map((s) => ({ ...s, toks: tokenize(s.text) }));
  // Words seen capitalized in mid-sentence, and words seen in lower case anywhere.
  const midCaps = new Set<string>();
  const lower = new Set<string>();
  for (const s of raw) {
    let first = true;
    let afterOpen = false;
    for (const t of s.toks) {
      if (!t.word) {
        afterOpen = /[:"“‘(]\s*$/.test(t.part);
        continue;
      }
      const w = bare(t.part);
      if (w === w.toLowerCase()) lower.add(w);
      else if (!first && !afterOpen && isCapitalized(w)) midCaps.add(w.toLowerCase());
      first = false;
      afterOpen = false;
    }
  }
  const sentences: TextSentence[] = raw.map((s) => {
    let first = true;
    let afterOpen = false;
    const tokens: TextToken[] = s.toks.map((t) => {
      if (!t.word) {
        afterOpen = /[:"“‘(]\s*$/.test(t.part);
        return { part: t.part, word: false, proper: false };
      }
      const w = bare(t.part);
      const lw = w.toLowerCase();
      const initial = first || afterOpen;
      first = false;
      afterOpen = false;
      let proper = false;
      if (w.length === 1) proper = w !== 'a' && w !== 'I' && w !== 'A';
      else if (isMixedOrCaps(w)) proper = true;
      else if (isCapitalized(w)) {
        if (BRANDS.has(lw)) proper = true;
        else if (!initial) proper = !lower.has(lw);
        else proper = midCaps.has(lw) && !lower.has(lw);
      }
      const lemma = proper ? undefined : lemmatize(w, byLemma);
      return { part: t.part, word: true, proper, ...(lemma ? { lemma } : {}) };
    });
    return { text: s.text.trim(), tokens, gap: s.gap };
  });
  return { sentences };
}

/** Every distinct lemma in the text, in order of first appearance. */
export function textLemmas(a: TextAnalysis): LemmaInfo[] {
  const seen = new Map<number, LemmaInfo>();
  for (const s of a.sentences)
    for (const t of s.tokens) if (t.lemma && !seen.has(t.lemma.id)) seen.set(t.lemma.id, t.lemma);
  return [...seen.values()];
}

/** Words to mark: at or above the level (theta − 4, as before), not studied yet. Hardest first. */
export function autoMark(
  a: TextAnalysis,
  studied: { has(id: number): boolean },
  theta: number,
  max = 60,
): number[] {
  return textLemmas(a)
    .filter((l) => l.d >= theta - 4 && !studied.has(l.id) && l.lemma.length >= 3)
    .sort((x, y) => y.d - x.d)
    .slice(0, max)
    .map((l) => l.id);
}

/** The sentences of the text that contain a lemma, with the surface form used. */
export function sentencesWith(
  a: TextAnalysis,
  lemmaId: number,
): { index: number; text: string; surface: string }[] {
  const out: { index: number; text: string; surface: string }[] = [];
  a.sentences.forEach((s, index) => {
    const hit = s.tokens.find((t) => t.lemma?.id === lemmaId);
    if (hit) out.push({ index, text: s.text, surface: bare(hit.part) });
  });
  return out;
}

/** A title from the first line: at most 8 words. */
export function guessTitle(body: string): string {
  const line = body.trim().split('\n')[0]?.trim() ?? '';
  const words = line.split(/\s+/).filter(Boolean);
  const t = words
    .slice(0, 8)
    .join(' ')
    .replace(/[.:,;]+$/, '');
  return words.length > 8 ? `${t}…` : t;
}

export type CheckKind = 'meaning' | 'which' | 'next';

export interface CheckQuestion {
  kind: CheckKind;
  /** English sentence (meaning, next) or Hebrew sentence (which). */
  prompt: string;
  options: string[];
  correct: number;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * A short comprehension check from the text itself (no AI): what a sentence means (pick the
 * Hebrew), which sentence says something (pick the English), and what comes next in the text.
 * Questions spread across the text; fewer when the text is short.
 */
export function buildCheck(
  sentences: readonly string[],
  hebrew: readonly (string | null)[],
  rng: Rng,
  n = 4,
): CheckQuestion[] {
  const ok = sentences
    .map((s, i) => ({ s, i, he: hebrew[i] ?? null }))
    .filter((x) => wordCount(x.s) >= 5 && wordCount(x.s) <= 40);
  if (ok.length < 3) return [];
  const withHe = ok.filter((x) => x.he);
  const out: CheckQuestion[] = [];
  const used = new Set<number>();
  const kinds: CheckKind[] = ['meaning', 'next', 'which', 'meaning', 'next', 'which'];
  // Spread prompts: walk the eligible sentences in evenly spaced order.
  const order = (pool: typeof ok) => {
    const step = Math.max(1, Math.floor(pool.length / n));
    const start = Math.floor(rng() * step);
    const seq = pool.filter((_, k) => (k - start) % step === 0 && k >= start);
    return [...seq, ...shuffle(rng, pool)];
  };
  const options = (right: string, others: string[]) => {
    const opts = shuffle(rng, [right, ...shuffle(rng, others).slice(0, 2)]);
    return { options: opts, correct: opts.indexOf(right) };
  };
  for (const kind of kinds) {
    if (out.length >= n) break;
    if (kind === 'next') {
      const q = order(ok).find(
        (x) => !used.has(x.i) && x.i + 1 < sentences.length && wordCount(sentences[x.i + 1]!) >= 4,
      );
      if (!q) continue;
      const right = sentences[q.i + 1]!;
      const others = ok.filter((x) => x.i !== q.i && x.i !== q.i + 1).map((x) => x.s);
      if (others.length < 2) continue;
      used.add(q.i);
      out.push({ kind, prompt: q.s, ...options(right, others) });
      continue;
    }
    if (withHe.length < 3) continue;
    const q = order(withHe).find((x) => !used.has(x.i));
    if (!q) continue;
    const rest = withHe.filter((x) => x.i !== q.i);
    used.add(q.i);
    if (kind === 'meaning')
      out.push({
        kind,
        prompt: q.s,
        ...options(
          q.he!,
          rest.map((x) => x.he!),
        ),
      });
    else
      out.push({
        kind,
        prompt: q.he!,
        ...options(
          q.s,
          rest.map((x) => x.s),
        ),
      });
  }
  return out;
}
