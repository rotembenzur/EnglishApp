/**
 * Ability estimation (spec 4.2): adaptive placement and slow Elo-like updates.
 */
import { BANDS, bandOf, bandRange, type Band } from './difficulty';
import type { Ability } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Spec formula: expected = 1 / (1 + 10^((d - theta) / 20)). */
export function expectedScore(theta: number, d: number): number {
  return 1 / (1 + Math.pow(10, (d - theta) / 20));
}

/** K decays from 2.0 right after placement toward 0.6 as the answer count grows. */
export function kFactor(answers: number): number {
  return 0.6 + 1.4 * Math.exp(-answers / 250);
}

/**
 * Per-answer weights on top of K. The owner wants slow movement: a perfect day must move theta
 * by less than 2 points, so each answer contributes a fraction of K, first exposures of new words
 * more than repeat reviews (which mostly inform the SRS).
 */
export const FIRST_EXPOSURE_WEIGHT = 0.25;
export const REVIEW_WEIGHT = 0.06;
export const PROBE_WEIGHT = 0.3;
/** Soft daily movement budget in theta points. */
export const DAILY_BUDGET = 2;

export interface ThetaUpdate {
  d: number;
  score: number;
  kind: 'first' | 'review' | 'probe' | 'known_shortcut';
  dayKey: string;
}

export function updateAbility(a: Ability, u: ThetaUpdate): Ability {
  const weight =
    u.kind === 'first'
      ? FIRST_EXPOSURE_WEIGHT
      : u.kind === 'probe'
        ? PROBE_WEIGHT
        : u.kind === 'known_shortcut'
          ? FIRST_EXPOSURE_WEIGHT
          : REVIEW_WEIGHT;
  const raw = kFactor(a.answers) * weight * (u.score - expectedScore(a.theta, u.d));
  const dayDelta = a.dayKey === u.dayKey ? (a.dayDelta ?? 0) : 0;
  // Soft budget: moves in the same direction as today's drift shrink as the budget fills.
  const sameDir = Math.sign(raw) === Math.sign(dayDelta) || dayDelta === 0;
  const room = sameDir ? Math.max(0, 1 - Math.abs(dayDelta) / DAILY_BUDGET) : 1;
  const delta = raw * room;
  return {
    ...a,
    theta: clamp(a.theta + delta, 0, 100),
    sigma: Math.max(3, a.sigma * 0.998),
    answers: a.answers + 1,
    dayKey: u.dayKey,
    dayDelta: dayDelta + delta,
  };
}

/** Friendly level: band plus progress (0..1) inside the band. */
export function levelOf(theta: number): { band: Band; progress: number; next?: Band } {
  const band = bandOf(theta);
  const [lo, hi] = bandRange(band);
  const i = BANDS.indexOf(band);
  const next = BANDS[i + 1];
  return { band, progress: clamp((theta - lo) / (hi - lo), 0, 1), ...(next ? { next } : {}) };
}

export function initialAbility(): Ability {
  return { theta: 40, sigma: 25, answers: 0, assumedKnownBelow: 0 };
}

// ---------------------------------------------------------------------------
// Placement (spec 4.2): Bayesian grid estimate over theta, adaptive item difficulty.
// ---------------------------------------------------------------------------

export type PlacementAnswer = 'know' | 'unsure' | 'dont';

export interface PlacementItem {
  lemmaId: number;
  d: number;
  answer: PlacementAnswer;
  /** Result of the meaning check on every 3rd item, when asked. */
  verified?: boolean;
}

export interface PlacementState {
  items: PlacementItem[];
  /** Posterior over theta on a 0..100 grid (101 points), normalized. */
  posterior: number[];
  /** Trust in self-report; drops when a "know" fails verification. */
  trust: number;
  done: boolean;
}

export const PLACEMENT_START_D = 40;
export const PLACEMENT_MAX_ITEMS = 25;
export const PLACEMENT_MIN_ITEMS = 12;
export const PLACEMENT_SIGMA_STOP = 4;
/** Slope of the placement response model (steeper than the Elo curve: knowing a word is crisp). */
const PLACEMENT_SCALE = 9;

function pKnow(theta: number, d: number): number {
  return 1 / (1 + Math.pow(10, (d - theta) / PLACEMENT_SCALE));
}

export function startPlacement(): PlacementState {
  // Weak prior centered on 45 (sd 30): learners are expected around B1..C1 but nothing is assumed.
  const posterior = Array.from({ length: 101 }, (_, t) =>
    Math.exp(-((t - 45) ** 2) / (2 * 30 * 30)),
  );
  return { items: [], posterior: normalize(posterior), trust: 1, done: false };
}

function normalize(p: number[]): number[] {
  const s = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / s);
}

export function posteriorStats(p: number[]): { mean: number; sd: number } {
  let mean = 0;
  for (let t = 0; t < p.length; t++) mean += t * p[t]!;
  let v = 0;
  for (let t = 0; t < p.length; t++) v += (t - mean) ** 2 * p[t]!;
  return { mean, sd: Math.sqrt(v) };
}

/**
 * Whether the next item should carry a meaning check: every 3rd item, and every item once a
 * "know" claim failed its check (so self-report cannot inflate the score).
 */
export function needsVerification(state: PlacementState): boolean {
  return (state.items.length + 1) % 3 === 0 || state.trust < 0.8;
}

/** Target difficulty for the next item: start at 40, then the posterior mean (binary search). */
export function nextPlacementDifficulty(state: PlacementState): number {
  if (!state.items.length) return PLACEMENT_START_D;
  const { mean } = posteriorStats(state.posterior);
  // Alternate slightly above and below the estimate so both sides are probed.
  const wobble = state.items.length % 2 === 0 ? 3 : -3;
  return clamp(mean + wobble, 1, 99);
}

/** Observed score for the likelihood: self-report tempered by trust and verification. */
function observedScore(item: PlacementItem, trust: number): number {
  if (item.verified === false) return 0;
  if (item.verified === true) return item.answer === 'dont' ? 0.5 : 1;
  const raw = item.answer === 'know' ? 1 : item.answer === 'unsure' ? 0.4 : 0;
  // Low trust pulls "know" claims toward "unsure".
  return item.answer === 'know' ? raw * trust + 0.3 * (1 - trust) : raw;
}

export function answerPlacement(state: PlacementState, item: PlacementItem): PlacementState {
  let trust = state.trust;
  if (item.verified === false && item.answer === 'know') trust = Math.max(0.2, trust - 0.35);
  if (item.verified === true && item.answer === 'know') trust = Math.min(1, trust + 0.1);
  const score = observedScore(item, trust);
  const posterior = normalize(
    state.posterior.map((pr, t) => {
      const p = pKnow(t, item.d);
      // Fractional-score Bernoulli likelihood.
      return pr * Math.pow(p, score) * Math.pow(1 - p, 1 - score) + 1e-300;
    }),
  );
  const items = [...state.items, item];
  const { sd } = posteriorStats(posterior);
  const done =
    items.length >= PLACEMENT_MAX_ITEMS ||
    (items.length >= PLACEMENT_MIN_ITEMS && sd < PLACEMENT_SIGMA_STOP);
  return { items, posterior, trust, done };
}

/** Final ability from a finished (or abandoned) placement. */
export function placementResult(state: PlacementState, now: number, previous?: Ability): Ability {
  const { mean, sd } = posteriorStats(state.posterior);
  const theta = Math.round(mean * 10) / 10;
  return {
    theta,
    sigma: Math.max(3, Math.round(sd * 10) / 10),
    answers: 0,
    assumedKnownBelow: Math.max(0, theta - 20),
    placedAt: now,
    // Retaking never erases what was learned; it only resets the estimate and the K schedule.
    ...(previous ? { dayKey: previous.dayKey, dayDelta: 0 } : {}),
  };
}
