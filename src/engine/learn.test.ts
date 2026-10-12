import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  ignoreWord,
  introduceWord,
  rebuildWord,
  unignoreWord,
  type AnswerInput,
} from './learn';
import type { Ability, ReviewRecord } from './types';

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
