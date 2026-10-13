import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  ignoreWord,
  introduceWord,
  rebuildWord,
  unignoreWord,
  type AnswerInput,
} from './learn';
import { review } from './srs';
import { retentionSince } from './stats';
import type { Ability, ReviewRecord, UserWord } from './types';

const now = Date.UTC(2026, 9, 12, 8);
const ability: Ability = { theta: 50, sigma: 6, answers: 10, assumedKnownBelow: 30 };

function input(over: Partial<AnswerInput>): AnswerInput {
  return {
    userId: 'rotem',
    lemmaId: 7,
    d: 52,
    word: introduceWord('rotem', 7, now, 'dev'),
    role: 'recognition',
    behavior: { type: 'en_he', correct: true, hinted: false, nearMiss: false, responseMs: 2500 },
    ability,
    combo: 0,
    now,
    dayKey: '2026-10-12',
    deviceId: 'dev',
    reviewId: 'r1',
    ...over,
  };
}

describe('applyAnswer', () => {
  it('a correct recognition logs a first exposure, schedules and awards XP', () => {
    const o = applyAnswer(input({}));
    expect(o.review.firstExposure).toBe(true);
    expect(o.review.rating).toBe(3);
    expect(o.word.card.reps).toBe(1);
    expect(o.xp).toBe(10);
    expect(o.ability.theta).toBeGreaterThan(ability.theta);
    expect(o.combo).toBe(1);
  });
  it('first correct production marks the word learned with a bonus', () => {
    const o = applyAnswer(
      input({
        role: 'production',
        behavior: {
          type: 'typing',
          correct: true,
          hinted: false,
          nearMiss: false,
          responseMs: 5000,
        },
      }),
    );
    expect(o.learnedNow).toBe(true);
    expect(o.word.learnedAt).toBe(now);
    expect(o.xp).toBe(18 + 25);
  });
  it('a wrong answer resets the combo and rates Again', () => {
    const o = applyAnswer(
      input({
        combo: 5,
        behavior: {
          type: 'en_he',
          correct: false,
          hinted: false,
          nearMiss: false,
          responseMs: 2000,
        },
      }),
    );
    expect(o.combo).toBe(0);
    expect(o.review.rating).toBe(1);
    expect(o.xp).toBe(0);
  });
  it('a passed probe marks the word known without scheduling reviews', () => {
    const o = applyAnswer(input({ role: 'probe', word: undefined }));
    expect(o.word.state).toBe('known');
    expect(o.review.purpose).toBe('probe');
    expect(o.probeFailed).toBe(false);
  });
  it('a failed probe enters normal learning and costs a little theta', () => {
    const o = applyAnswer(
      input({
        role: 'probe',
        word: undefined,
        d: 35,
        behavior: {
          type: 'en_he',
          correct: false,
          hinted: false,
          nearMiss: false,
          responseMs: 2000,
        },
      }),
    );
    expect(o.word.state).toBe('learning');
    expect(o.probeFailed).toBe(true);
    expect(o.ability.theta).toBeLessThan(ability.theta);
  });
  it('"I already know this" verified: long interval, small theta nudge up', () => {
    const o = applyAnswer(input({ role: 'verify' }));
    expect(o.word.state).toBe('review');
    expect(o.word.card.due - now).toBeGreaterThan(20 * 86_400_000);
    expect(o.ability.theta).toBeGreaterThan(ability.theta);
  });
  it('flags leeches after 6 lapses', () => {
    let w = introduceWord('rotem', 7, now, 'dev');
    let t = now;
    for (let i = 0; i < 40 && !w.isLeech; i++) {
      const correct = i % 3 !== 2;
      const o = applyAnswer(
        input({
          word: w,
          role: 'review',
          now: t,
          behavior: { type: 'en_he', correct, hinted: false, nearMiss: false, responseMs: 2000 },
        }),
      );
      w = o.word;
      t = Math.max(w.card.due, t + 60_000);
    }
    expect(w.isLeech).toBe(true);
    expect(w.lapses).toBeGreaterThanOrEqual(6);
  });
});

describe('ignore and rebuild', () => {
  it('ignore is reversible', () => {
    const w = { ...introduceWord('rotem', 1, now, 'd'), state: 'review' as const };
    const ig = ignoreWord(w, now, 'd');
    expect(ig.state).toBe('ignored');
    expect(unignoreWord(ig, now, 'd').state).toBe('review');
  });
  it('rebuilding from the log reproduces the scheduled state', () => {
    let w = introduceWord('rotem', 7, now, 'dev');
    const log: ReviewRecord[] = [];
    let t = now;
    for (let i = 0; i < 5; i++) {
      const o = applyAnswer(
        input({ word: w, role: i === 0 ? 'recognition' : 'review', now: t, reviewId: `r${i}` }),
      );
      w = o.word;
      log.push(o.review);
      t = w.card.due;
    }
    const rebuilt = rebuildWord('rotem', 7, log, 'dev')!;
    expect(rebuilt.card.reps).toBe(w.card.reps);
    expect(rebuilt.card.due).toBe(w.card.due);
    expect(rebuilt.state).toBe(w.state);
  });
});

describe('early reviews (sessions filled after the daily cap)', () => {
  const DAY = 86_400_000;
  /** A mature word: last reviewed 2 days ago, due in 18 days. */
  function mature(): UserWord {
    const w = introduceWord('rotem', 7, now - 40 * DAY, 'dev');
    const last = now - 2 * DAY;
    const card = {
      ...review(review(w.card, 3, now - 40 * DAY), 3, now - 30 * DAY),
      fsrsState: 2 as const,
      stability: 20,
      scheduledDays: 20,
      lastReview: last,
      due: last + 20 * DAY,
    };
    return { ...w, state: 'review', card, crowns: 2, lastReviewAt: last, nextDueAt: card.due };
  }
  const fast = { type: 'typing' as const, correct: true, hinted: false, nearMiss: false };

  it('are scheduled by FSRS from the real elapsed time and pushed out, never pulled in', () => {
    const w = mature();
    const o = applyAnswer(
      input({ word: w, role: 'review', behavior: { ...fast, responseMs: 5000 } }),
    );
    expect(o.review.early).toBe(true);
    expect(o.review.rating).toBe(3);
    // Recall was near certain, so stability grows only a little, and the word comes back later
    // than it would have without the early review.
    expect(o.word.card.stability).toBeGreaterThan(w.card.stability);
    expect(o.word.card.stability).toBeLessThan(w.card.stability * 1.5);
    expect(o.word.card.due).toBeGreaterThanOrEqual(w.card.due);
  });

  it('never get the Easy bonus on a word that was not due', () => {
    const w = mature();
    const early = applyAnswer(
      input({ word: w, role: 'review', behavior: { ...fast, responseMs: 500 } }),
    );
    expect(early.review.rating).toBe(3);
    // The same fast answer once the word is due earns Easy as usual.
    const onTime = applyAnswer(
      input({
        word: w,
        role: 'review',
        behavior: { ...fast, responseMs: 500 },
        now: w.card.due + DAY,
      }),
    );
    expect(onTime.review.rating).toBe(4);
    expect(onTime.review.early).toBeUndefined();
  });

  it('a forgotten word on an early review lapses like any other review', () => {
    const o = applyAnswer(
      input({
        word: mature(),
        role: 'review',
        behavior: { ...fast, correct: false, responseMs: 4000 },
      }),
    );
    expect(o.review.rating).toBe(1);
    expect(o.word.card.lapses).toBeGreaterThan(0);
  });

  it('same-day practice of a word learned today does not inflate its stability', () => {
    let w = introduceWord('rotem', 7, now, 'dev');
    let t = now;
    for (const role of ['recognition', 'production'] as const) {
      t += 5 * 60_000;
      w = applyAnswer(
        input({ word: w, role, now: t, behavior: { ...fast, responseMs: 5000 } }),
      ).word;
    }
    t += 20 * 60_000;
    w = applyAnswer(
      input({ word: w, role: 'review', now: t, behavior: { ...fast, responseMs: 5000 } }),
    ).word;
    const learned = w.card.stability;
    // Five more sessions the same afternoon.
    for (let i = 0; i < 5; i++) {
      t += 40 * 60_000;
      w = applyAnswer(
        input({ word: w, role: 'review', now: t, behavior: { ...fast, responseMs: 800 } }),
      ).word;
    }
    expect(w.card.stability).toBeLessThan(learned * 1.25);
    expect(w.card.due - t).toBeLessThan(8 * DAY);
  });

  it('are left out of the 7-day retention that drives the cap suggestion', () => {
    const row = (id: string, correct: boolean, early?: boolean): ReviewRecord => ({
      id,
      userId: 'rotem',
      lemmaId: 1,
      exerciseType: 'en_he',
      rating: correct ? 3 : 1,
      correct,
      score: correct ? 1 : 0,
      responseMs: 2000,
      firstExposure: false,
      purpose: 'review',
      ...(early ? { early: true } : {}),
      d: 40,
      at: now,
      deviceId: 'dev',
    });
    const rows = [
      row('a', false),
      row('b', true),
      ...['c', 'd', 'e', 'f'].map((id) => row(id, true, true)),
    ];
    expect(retentionSince(rows, now - DAY)).toEqual({ rate: 0.5, n: 2 });
  });
});
