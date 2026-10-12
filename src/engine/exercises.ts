/**
 * Exercise logic (spec 4.7): distractors, typing tolerance, cloze blanking, match pairs.
 */
import { type Rng, shuffle } from './rng';
import type { Sentence } from './types';

/** Minimal word shape needed to build options. */
export interface OptionWord {
  lemmaId: number;
  lemma: string;
  pos: string[];
  d: number;
  hebrew: string[];
  family?: number;
}

const normHe = (s: string) =>
  s
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[֑-ׇ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Pick `n` distractors for a 4-option question. Rules: same primary POS when possible,
 * similar difficulty, never the target's family, never a duplicate or overlapping Hebrew
 * gloss, never the same English word twice.
 */
export function chooseDistractors(
  target: OptionWord,
  pool: readonly OptionWord[],
  n: number,
  rng: Rng,
): OptionWord[] {
  const targetHe = new Set(target.hebrew.map(normHe));
  const pos = target.pos[0];
  const usedHe = new Set(targetHe);
  const usedEn = new Set([target.lemma.toLowerCase()]);
  const ok = (w: OptionWord) =>
    w.lemmaId !== target.lemmaId &&
    !(target.family && w.family === target.family) &&
    !usedEn.has(w.lemma.toLowerCase()) &&
    w.hebrew.length > 0 &&
    !w.hebrew.some((h) => usedHe.has(normHe(h)));

  const tiers: ((w: OptionWord) => boolean)[] = [
    (w) => w.pos[0] === pos && Math.abs(w.d - target.d) <= 8,
    (w) => w.pos[0] === pos && Math.abs(w.d - target.d) <= 20,
    (w) => w.pos[0] === pos,
    (w) => w.pos.includes(pos ?? ''),
    () => true,
  ];
  const out: OptionWord[] = [];
  for (const tier of tiers) {
    if (out.length >= n) break;
    for (const w of shuffle(
      rng,
      pool.filter((x) => tier(x)),
    )) {
      if (out.length >= n) break;
      if (!ok(w)) continue;
      out.push(w);
      usedEn.add(w.lemma.toLowerCase());
      for (const h of w.hebrew) usedHe.add(normHe(h));
    }
  }
  return out;
}

export interface Options {
  options: { lemmaId: number; label: string }[];
  correctIndex: number;
}

/** Build shuffled 4 options; `label` picks the side shown (Hebrew gloss or English lemma). */
export function buildOptions(
  target: OptionWord,
  distractors: readonly OptionWord[],
  side: 'he' | 'en',
  rng: Rng,
): Options {
  const label = (w: OptionWord) => (side === 'he' ? normHe(w.hebrew[0]!) : w.lemma);
  const all = shuffle(rng, [target, ...distractors]);
  return {
    options: all.map((w) => ({ lemmaId: w.lemmaId, label: label(w) })),
    correctIndex: all.findIndex((w) => w.lemmaId === target.lemmaId),
  };
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export function normalizeTyped(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** US/UK spelling equivalence so British spellings are never marked wrong (and vice versa). */
export function spellingKey(s: string): string {
  return s
    .replace(/our\b/g, 'or')
    .replace(/(?<=[a-z]{2})is(e|ed|es|ing|ation)\b/g, 'iz$1')
    .replace(/(?<=[a-z]{2})yse\b/g, 'yze')
    .replace(/(?<=[a-z]{3})re\b/g, 'er')
    .replace(/ll(ed|ing|er)\b/g, 'l$1')
    .replace(/ogue\b/g, 'og')
    .replace(/ence\b/g, 'ense');
}

export type TypingVerdict = 'correct' | 'near' | 'wrong';

export interface TypingResult {
  verdict: TypingVerdict;
  /** The accepted answer closest to what was typed (for highlighting). */
  expected: string;
  distance: number;
}

/**
 * Exact (case-insensitive, US/UK tolerant) is correct. Levenshtein 1 on words of length 5+
 * is a near miss ("כמעט", rated Hard). Anything else is wrong.
 */
export function checkTyping(typed: string, accepted: readonly string[]): TypingResult {
  const t = normalizeTyped(typed);
  let best: TypingResult = { verdict: 'wrong', expected: accepted[0] ?? '', distance: Infinity };
  for (const a of accepted) {
    const n = normalizeTyped(a);
    if (t === n || (t.length > 3 && spellingKey(t) === spellingKey(n))) {
      return { verdict: 'correct', expected: a, distance: 0 };
    }
    const dist = levenshtein(t, n);
    if (dist < best.distance) {
      best = {
        verdict: dist === 1 && n.length >= 5 ? 'near' : 'wrong',
        expected: a,
        distance: dist,
      };
    }
  }
  return best;
}

export type DiffOp = { ch: string; op: 'same' | 'wrong' | 'missing' | 'extra' };

/** Character diff of typed vs expected for the "correct spelling highlighted" feedback. */
export function diffSpelling(typed: string, expected: string): DiffOp[] {
  const a = normalizeTyped(typed);
  const b = expected;
  const bl = b.toLowerCase();
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === bl[j - 1] ? 0 : 1),
      );
  const ops: DiffOp[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + (a[i - 1] === bl[j - 1] ? 0 : 1)) {
      ops.push({ ch: b[j - 1]!, op: a[i - 1] === bl[j - 1] ? 'same' : 'wrong' });
      i--;
      j--;
    } else if (j > 0 && dp[i]![j] === dp[i]![j - 1]! + 1) {
      ops.push({ ch: b[j - 1]!, op: 'missing' });
      j--;
    } else {
      ops.push({ ch: a[i - 1]!, op: 'extra' });
      i--;
    }
  }
  return ops.reverse();
}

// ---------------------------------------------------------------------------
// Cloze
// ---------------------------------------------------------------------------

export interface Cloze {
  before: string;
  after: string;
  /** Surface form removed from the sentence (e.g. "decided"). */
  answer: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Candidate surface forms for a lemma: listed forms plus regular inflections. */
export function inflections(lemma: string, forms: readonly string[] = []): string[] {
  const l = lemma.toLowerCase();
  const out = new Set<string>([l, ...forms.map((f) => f.toLowerCase())]);
  const stemE = l.endsWith('e') ? l.slice(0, -1) : l;
  const last = l[l.length - 1] ?? '';
  const doubled = /[^aeiou][aeiou][bdgklmnprt]$/.test(l) ? l + last : l;
  for (const s of ['s', 'es', 'ed', 'ing', 'er', 'est', 'ly']) {
    out.add(l + s);
    out.add(stemE + s);
    out.add(doubled + s);
  }
  if (l.endsWith('y')) {
    const b = l.slice(0, -1);
    for (const s of ['ies', 'ied', 'ier', 'iest', 'ily']) out.add(b + s);
  }
  if (l.endsWith('ie')) out.add(l.slice(0, -2) + 'ying');
  return [...out].filter((x) => x.length > 0);
}

/** Blank the target word in a sentence. Prefers the longest matching surface form. */
export function makeCloze(
  sentence: Sentence,
  lemma: string,
  forms: readonly string[] = [],
): Cloze | null {
  if (lemma.includes(' ')) {
    const re = new RegExp(`\\b${escapeRe(lemma)}\\b`, 'i');
    const m = re.exec(sentence.en);
    if (!m) return null;
    return {
      before: sentence.en.slice(0, m.index),
      after: sentence.en.slice(m.index + m[0].length),
      answer: m[0],
    };
  }
  const candidates = inflections(lemma, forms).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    const re = new RegExp(`(?<![A-Za-z'-])${escapeRe(c)}(?![A-Za-z-])`, 'i');
    const m = re.exec(sentence.en);
    if (m) {
      return {
        before: sentence.en.slice(0, m.index),
        after: sentence.en.slice(m.index + m[0].length),
        answer: m[0],
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Match pairs
// ---------------------------------------------------------------------------

export interface MatchBoard {
  left: { lemmaId: number; label: string }[];
  right: { lemmaId: number; label: string }[];
}

/** Five English and five Hebrew cards, each column shuffled; Hebrew glosses must be unique. */
export function buildMatch(words: readonly OptionWord[], rng: Rng): MatchBoard | null {
  const seen = new Set<string>();
  const picked: OptionWord[] = [];
  for (const w of words) {
    const he = normHe(w.hebrew[0] ?? '');
    if (!he || seen.has(he)) continue;
    seen.add(he);
    picked.push(w);
    if (picked.length === 5) break;
  }
  if (picked.length < 3) return null;
  return {
    left: shuffle(rng, picked).map((w) => ({ lemmaId: w.lemmaId, label: w.lemma })),
    right: shuffle(rng, picked).map((w) => ({ lemmaId: w.lemmaId, label: normHe(w.hebrew[0]!) })),
  };
}

/** Bonus XP for finishing match pairs fast: full bonus under 10s, none after 30s. */
export function matchTimeBonus(ms: number): number {
  if (ms <= 10_000) return 10;
  if (ms >= 30_000) return 0;
  return Math.round(10 * (1 - (ms - 10_000) / 20_000));
}

export const SPEED_ITEM_MS = 6000;
