/**
 * New word selection (spec 4.3) and assumed-known probes (spec 4.4).
 */
import { type Rng, weightedSample } from './rng';
import type { LemmaInfo } from './types';

export const WINDOW_LOW = 4;
export const WINDOW_HIGH = 12;
export const PEAK_OFFSET = 5;
export const TOPIC_SHARE = 0.1;
export const MIN_CAP = 3;
export const MAX_CAP = 25;
export const DEFAULT_CAP = 8;

export interface SelectionContext {
  theta: number;
  /** Lemma ids the user has a userWords row for (any state, including ignored). */
  studied: ReadonlySet<number>;
  /** Favorite topic tags (spec 7.3 topics). */
  topics?: readonly string[];
  /** Curated kinds the user disabled (phrasal, idiom, collocation). */
  disabledKinds?: readonly string[];
  /** Families with a member introduced in the last few days: slow down the family. */
  recentFamilies?: ReadonlySet<number>;
}

/** Sampling weight around theta + 5 (gaussian, sd 5), zero outside the window. */
export function windowWeight(d: number, theta: number, widen = 0): number {
  const lo = theta - WINDOW_LOW - widen;
  const hi = theta + WINDOW_HIGH + widen;
  if (d < lo || d > hi) return 0;
  const peak = theta + PEAK_OFFSET;
  const sd = 5 + widen / 2;
  return Math.exp(-((d - peak) ** 2) / (2 * sd * sd));
}

function tierBoost(l: LemmaInfo): number {
  return l.tier === 'A' ? 3 : l.tier === 'B' ? 1.5 : 1;
}

function eligible(l: LemmaInfo, ctx: SelectionContext): boolean {
  if (ctx.studied.has(l.id) || l.kind === 'skip') return false;
  if (l.kind && l.kind !== 'word' && ctx.disabledKinds?.includes(l.kind)) return false;
  return true;
}

/**
 * Family ordering: a derived word waits until its family root (the most frequent member) is
 * studied; once the root is in, the rest of the family gets a mild boost, but not two members
 * of one family within a few days.
 */
function familyFactor(l: LemmaInfo, ctx: SelectionContext, byId: ReadonlyMap<number, LemmaInfo>) {
  if (!l.family || l.family === l.id) return 1;
  if (ctx.recentFamilies?.has(l.family)) return 0.15;
  const root = byId.get(l.family);
  if (!root) return 1;
  if (ctx.studied.has(root.id)) return 1.3;
  // Root still unknown and harder or similar? Then this one can go first.
  return root.d <= l.d + 2 ? 0.2 : 1;
}

/**
 * Pick up to `k` new words. Never runs dry: the window widens until enough candidates exist.
 * About 10% come from favorite topics when the user has any.
 */
export function selectNewWords(
  lemmas: readonly LemmaInfo[],
  ctx: SelectionContext,
  k: number,
  rng: Rng,
  byId: ReadonlyMap<number, LemmaInfo> = new Map(lemmas.map((l) => [l.id, l])),
): LemmaInfo[] {
  if (k <= 0) return [];
  const chosen: LemmaInfo[] = [];
  const taken = new Set<number>();
  const topics = ctx.topics ?? [];
  const usedFamilies = new Set<number>();

  for (let widen = 0; widen <= 100 && chosen.length < k; widen += 5) {
    const candidates = lemmas.filter((l) => eligible(l, ctx) && !taken.has(l.id));
    const weight = (l: LemmaInfo) => {
      if (l.family && usedFamilies.has(l.family)) return 0;
      return windowWeight(l.d, ctx.theta, widen) * tierBoost(l) * familyFactor(l, ctx, byId);
    };
    const need = k - chosen.length;
    // Topic share: each slot has a 10% chance to come from favorite topics.
    let topicSlots = 0;
    if (topics.length) for (let i = 0; i < need; i++) if (rng() < TOPIC_SHARE) topicSlots++;
    if (topicSlots) {
      const topical = candidates.filter((l) => l.tags.some((t) => topics.includes(t)));
      for (const l of weightedSample(rng, topical, weight, topicSlots)) {
        chosen.push(l);
        taken.add(l.id);
        if (l.family) usedFamilies.add(l.family);
      }
    }
    const rest = weightedSample(
      rng,
      candidates.filter((l) => !taken.has(l.id)),
      weight,
      k - chosen.length,
    );
    for (const l of rest) {
      if (l.family && usedFamilies.has(l.family)) continue;
      chosen.push(l);
      taken.add(l.id);
      if (l.family) usedFamilies.add(l.family);
    }
  }
  return chosen.slice(0, k);
}

/** New words still allowed today under the daily cap. */
export function newWordsLeft(cap: number, introducedToday: number): number {
  return Math.max(0, clampCap(cap) - introducedToday);
}

export function clampCap(cap: number): number {
  return Math.min(MAX_CAP, Math.max(MIN_CAP, Math.round(cap)));
}

export interface CapSignals {
  cap: number;
  /** Share of correct graded reviews (not first exposures) over the last 7 days. */
  retention7d: number;
  reviews7d: number;
  dueCount: number;
}

/**
 * One-tap suggestion on the home screen (never automatic): raise when retention is above 85%
 * and the queue is under control, lower when more than 60 reviews are due.
 */
export function suggestCapChange(s: CapSignals): { direction: 'up' | 'down'; to: number } | null {
  if (s.dueCount > 60 && s.cap > MIN_CAP) {
    return { direction: 'down', to: clampCap(s.cap - 2) };
  }
  if (s.retention7d > 0.85 && s.reviews7d >= 30 && s.dueCount <= 25 && s.cap < MAX_CAP) {
    return { direction: 'up', to: clampCap(s.cap + 2) };
  }
  return null;
}

/**
 * Sanity probe (spec 4.4): an unstudied word just below the user's level (assumed known).
 * Mostly from [theta - 20, theta - 4], peaking around theta - 9.
 */
export function pickProbe(
  lemmas: readonly LemmaInfo[],
  ctx: Pick<SelectionContext, 'theta' | 'studied'>,
  rng: Rng,
): LemmaInfo | null {
  const lo = Math.max(0, ctx.theta - 20);
  const hi = ctx.theta - WINDOW_LOW;
  if (hi <= 0) return null;
  const pool = lemmas.filter(
    (l) => l.d >= lo && l.d < hi && !ctx.studied.has(l.id) && (!l.kind || l.kind === 'word'),
  );
  const peak = ctx.theta - 9;
  const [probe] = weightedSample(
    rng,
    pool,
    (l) => Math.exp(-((l.d - peak) ** 2) / (2 * 6 * 6)) * tierBoost(l),
    1,
  );
  return probe ?? null;
}
