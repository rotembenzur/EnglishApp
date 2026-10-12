/**
 * On-device FSRS personalization (spec 4.5). A small coordinate-descent fit of the most
 * influential FSRS weights (initial stabilities and the stability-growth factors) that minimizes
 * the log loss of predicted recall on the user's own review log. Runs in milliseconds for
 * thousands of reviews; returns null when there is not enough data or no real improvement.
 */
import {
  createEmptyCard,
  default_w,
  fsrs,
  generatorParameters,
  type Card,
  type Grade,
} from 'ts-fsrs';
import type { ReviewRecord } from './types';

export const MIN_REVIEWS = 400;
const TUNED = [0, 1, 2, 3, 8, 9, 10, 11];

interface Seq {
  at: number;
  rating: Grade;
  correct: boolean;
}

function sequences(reviews: readonly ReviewRecord[]): Seq[][] {
  const by = new Map<number, Seq[]>();
  for (const r of reviews) {
    if (r.purpose === 'probe' || r.purpose === 'verify' || r.purpose === 'duel') continue;
    const arr = by.get(r.lemmaId) ?? [];
    arr.push({ at: r.at, rating: r.rating as Grade, correct: r.correct });
    by.set(r.lemmaId, arr);
  }
  return [...by.values()].map((s) => s.sort((a, b) => a.at - b.at)).filter((s) => s.length >= 2);
}

/** Mean log loss of predicted retrievability at each review after the first day. */
export function logLoss(seqs: Seq[][], w: readonly number[]): number {
  const f = fsrs(generatorParameters({ w: [...w], enable_fuzz: false, enable_short_term: true }));
  let loss = 0;
  let n = 0;
  for (const s of seqs) {
    let card: Card = createEmptyCard(new Date(s[0]!.at));
    for (const r of s) {
      const when = new Date(r.at);
      if (
        card.state === 2 &&
        card.last_review &&
        r.at - card.last_review.getTime() > 12 * 3600_000
      ) {
        const p = Math.min(0.999, Math.max(0.001, f.get_retrievability(card, when, false)));
        loss += r.correct ? -Math.log(p) : -Math.log(1 - p);
        n++;
      }
      card = f.next(card, when, r.rating).card;
    }
  }
  return n ? loss / n : Infinity;
}

export function optimizeFor(reviews: readonly ReviewRecord[]): number[] | null {
  if (reviews.length < MIN_REVIEWS) return null;
  const seqs = sequences(reviews);
  let w = [...default_w];
  const baseline = logLoss(seqs, w);
  if (!Number.isFinite(baseline)) return null;
  let best = baseline;
  for (let iter = 0; iter < 6; iter++) {
    let improved = false;
    for (const i of TUNED) {
      for (const factor of [1.25, 0.8]) {
        const cand = [...w];
        cand[i] = Math.max(0.01, cand[i]! * factor);
        const l = logLoss(seqs, cand);
        if (l < best - 1e-5) {
          best = l;
          w = cand;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best < baseline * 0.99 ? w : null;
}
