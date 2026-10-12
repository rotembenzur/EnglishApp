/**
 * Spaced repetition (spec 4.5): FSRS via ts-fsrs, ratings derived from behavior,
 * crowns from stability, leech detection.
 */
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type FSRS,
  type Grade,
} from 'ts-fsrs';
import type { AnswerBehavior, FsrsRating, GradedType, SrsCard } from './types';

export const DEFAULT_RETENTION = 0.9;
export const LEECH_LAPSES = 6;
const DAY = 86_400_000;

/** Crown thresholds on FSRS stability, in days (spec 4.5). */
export const CROWN_STABILITY = [1, 7, 30, 120, 365] as const;

const schedulers = new Map<string, FSRS>();

/** Cached scheduler per (retention, params) combination. */
export function scheduler(retention = DEFAULT_RETENTION, w?: readonly number[]): FSRS {
  const key = `${retention}|${w ? w.join(',') : 'default'}`;
  let f = schedulers.get(key);
  if (!f) {
    f = fsrs(
      generatorParameters({
        request_retention: retention,
        maximum_interval: 3650,
        enable_fuzz: true,
        enable_short_term: true,
        ...(w ? { w: [...w] } : {}),
      }),
    );
    schedulers.set(key, f);
  }
  return f;
}

export function toCard(c: SrsCard): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsedDays,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.fsrsState,
    ...(c.lastReview !== undefined ? { last_review: new Date(c.lastReview) } : {}),
  };
}

export function fromCard(c: Card): SrsCard {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    fsrsState: c.state as 0 | 1 | 2 | 3,
    ...(c.last_review ? { lastReview: c.last_review.getTime() } : {}),
  };
}

export function newCard(now: number): SrsCard {
  return fromCard(createEmptyCard(new Date(now)));
}

/** Apply a rating. Returns the updated card. */
export function review(
  card: SrsCard,
  rating: FsrsRating,
  now: number,
  opts: { retention?: number; w?: readonly number[] } = {},
): SrsCard {
  const f = scheduler(opts.retention, opts.w);
  return fromCard(f.next(toCard(card), new Date(now), rating as Grade).card);
}

/**
 * A word verified through "I already know this" or a passed probe starts with a long interval:
 * two consecutive Easy reviews spaced by the first interval.
 */
export function knownCard(now: number, opts: { retention?: number } = {}): SrsCard {
  const f = scheduler(opts.retention);
  const first = f.next(createEmptyCard(new Date(now)), new Date(now), 4 as Grade).card;
  return fromCard(f.next(first, first.due, 4 as Grade).card);
}

export function retrievability(card: SrsCard, now: number, retention?: number): number {
  if (card.fsrsState === 0) return 0;
  return scheduler(retention).get_retrievability(toCard(card), new Date(now), false);
}

/** Per-user response time percentiles per exercise type, from the review log. */
export type SpeedProfile = Partial<Record<GradedType, { p30: number; p80: number; n: number }>>;

/** Defaults used until a type has 20+ samples (ms). Typing is naturally slower. */
const DEFAULT_SPEED: Record<GradedType, { p30: number; p80: number }> = {
  en_he: { p30: 2200, p80: 6000 },
  he_en: { p30: 2400, p80: 6500 },
  listening: { p30: 2800, p80: 7000 },
  typing: { p30: 3500, p80: 10000 },
  cloze: { p30: 3500, p80: 9000 },
  match: { p30: 1500, p80: 4000 },
  speed: { p30: 1500, p80: 4000 },
  spell_audio: { p30: 4000, p80: 11000 },
};

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

/** Build a speed profile from recent correct answers (most recent 200 per type). */
export function speedProfile(
  samples: readonly { type: GradedType; responseMs: number; correct: boolean }[],
): SpeedProfile {
  const by = new Map<GradedType, number[]>();
  for (const s of samples) {
    if (!s.correct || s.responseMs <= 0) continue;
    const arr = by.get(s.type) ?? [];
    arr.push(s.responseMs);
    by.set(s.type, arr);
  }
  const out: SpeedProfile = {};
  for (const [type, arr] of by) {
    const recent = arr.slice(-200).sort((a, b) => a - b);
    out[type] = { p30: percentile(recent, 30), p80: percentile(recent, 80), n: recent.length };
  }
  return out;
}

function thresholds(profile: SpeedProfile, type: GradedType): { p30: number; p80: number } {
  const p = profile[type];
  if (p && p.n >= 20) return p;
  return DEFAULT_SPEED[type];
}

/**
 * Rating from behavior, never self-reported (spec 4.5):
 * wrong -> Again; hint, near miss or slower than own p80 -> Hard;
 * fast (below own p30) on typing or listening -> Easy; otherwise Good.
 */
export function deriveRating(b: AnswerBehavior, profile: SpeedProfile = {}): FsrsRating {
  if (!b.correct) return 1;
  const { p30, p80 } = thresholds(profile, b.type);
  if (b.hinted || b.nearMiss || b.responseMs > p80) return 2;
  const easyEligible = b.type === 'typing' || b.type === 'listening' || b.type === 'spell_audio';
  if (easyEligible && b.responseMs < p30) return 4;
  return 3;
}

/** Speed round answers count as reviews with Hard or Good only (spec 4.6). */
export function speedRoundRating(correct: boolean, responseMs: number): FsrsRating {
  if (!correct) return 2;
  return responseMs <= 3000 ? 3 : 2;
}

export function scoreOf(b: Pick<AnswerBehavior, 'correct' | 'hinted' | 'nearMiss'>): number {
  if (!b.correct) return 0;
  return b.hinted || b.nearMiss ? 0.5 : 1;
}

export function crownsFor(card: SrsCard): number {
  if (card.fsrsState === 0) return 0;
  let crowns = 0;
  for (const s of CROWN_STABILITY) if (card.stability >= s) crowns++;
  return crowns;
}

export function isLeech(lapses: number): boolean {
  return lapses >= LEECH_LAPSES;
}

/** Days until due (negative when overdue). */
export function daysUntilDue(card: SrsCard, now: number): number {
  return (card.due - now) / DAY;
}
