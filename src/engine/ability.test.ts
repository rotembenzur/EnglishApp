import { describe, expect, it } from 'vitest';
import {
  answerPlacement,
  expectedScore,
  kFactor,
  levelOf,
  needsVerification,
  nextPlacementDifficulty,
  placementResult,
  startPlacement,
  updateAbility,
  type PlacementAnswer,
  type PlacementState,
} from './ability';
import { createRng } from './rng';
import type { Ability } from './types';

/** A simulated learner who knows words with a logistic curve around their true level. */
function simulatePlacement(trueTheta: number, seed: number, overclaim = 0): number {
  const rng = createRng(seed);
  let s: PlacementState = startPlacement();
  let id = 1;
  while (!s.done) {
    const target = nextPlacementDifficulty(s);
    const d = Math.min(100, Math.max(0, target + (rng() - 0.5) * 4));
    const p = 1 / (1 + Math.pow(10, (d - trueTheta) / 10));
    const knows = rng() < p;
    let answer: PlacementAnswer;
    if (knows) answer = rng() < 0.9 ? 'know' : 'unsure';
    else if (rng() < overclaim) answer = 'know';
    else answer = rng() < 0.8 ? 'dont' : 'unsure';
    const verify = needsVerification(s);
    const verified = verify ? knows || rng() < 0.25 : undefined;
    s = answerPlacement(s, { lemmaId: id++, d, answer, ...(verify ? { verified } : {}) });
  }
  return placementResult(s, 0).theta;
}

describe('placement', () => {
  for (const trueTheta of [20, 50, 80]) {
    it(`converges within 8 points for a learner at ${trueTheta}`, () => {
      const errors: number[] = [];
      for (let seed = 1; seed <= 40; seed++) {
        errors.push(Math.abs(simulatePlacement(trueTheta, seed * 7919 + trueTheta) - trueTheta));
      }
      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      const within = errors.filter((e) => e <= 8).length / errors.length;
      expect(mean).toBeLessThan(5);
      expect(within).toBeGreaterThanOrEqual(0.9);
    });
  }

  it('limits inflation from overclaiming thanks to verification checks', () => {
    const honest = simulatePlacement(40, 99);
    const liar = simulatePlacement(40, 99, 0.6);
    expect(liar - 40).toBeLessThan(15);
    expect(honest).toBeGreaterThan(30);
  });

  it('starts at difficulty 40 and stops after at most 25 items', () => {
    let s = startPlacement();
    expect(nextPlacementDifficulty(s)).toBe(40);
    for (let i = 0; i < 40 && !s.done; i++) {
      s = answerPlacement(s, { lemmaId: i, d: nextPlacementDifficulty(s), answer: 'unsure' });
    }
    expect(s.done).toBe(true);
    expect(s.items.length).toBeLessThanOrEqual(25);
  });

  it('asks a verification question on every 3rd item', () => {
    let s = startPlacement();
    const flags: boolean[] = [];
    for (let i = 0; i < 9; i++) {
      flags.push(needsVerification(s));
      s = answerPlacement(s, { lemmaId: i, d: 40, answer: 'know', verified: true });
    }
    expect(flags).toEqual([false, false, true, false, false, true, false, false, true]);
  });

  it('marks everything below theta - 20 as assumed known', () => {
    let s = startPlacement();
    for (let i = 0; i < 25; i++) s = answerPlacement(s, { lemmaId: i, d: 30, answer: 'know' });
    const a = placementResult(s, 1);
    expect(a.assumedKnownBelow).toBeCloseTo(Math.max(0, a.theta - 20), 5);
  });
});

describe('continuous ability updates', () => {
  const base: Ability = { theta: 50, sigma: 6, answers: 0, assumedKnownBelow: 30 };

  it('uses the spec expected-score curve', () => {
    expect(expectedScore(50, 50)).toBeCloseTo(0.5, 6);
    expect(expectedScore(50, 70)).toBeCloseTo(1 / 11, 6);
  });

  it('K decays from about 2.0 to about 0.6', () => {
    expect(kFactor(0)).toBeCloseTo(2.0, 5);
    expect(kFactor(5000)).toBeCloseTo(0.6, 2);
    expect(kFactor(100)).toBeGreaterThan(kFactor(500));
  });

  it('a simulated perfect day moves theta by less than 2 points', () => {
    let a = base;
    // 8 new words (recognition + production each) slightly above level, 30 reviews, a probe.
    for (let i = 0; i < 8; i++) {
      a = updateAbility(a, { d: 55, score: 1, kind: 'first', dayKey: '2026-10-12' });
      a = updateAbility(a, { d: 55, score: 1, kind: 'first', dayKey: '2026-10-12' });
    }
    for (let i = 0; i < 30; i++)
      a = updateAbility(a, { d: 48, score: 1, kind: 'review', dayKey: '2026-10-12' });
    a = updateAbility(a, { d: 40, score: 1, kind: 'probe', dayKey: '2026-10-12' });
    expect(a.theta - base.theta).toBeGreaterThan(0);
    expect(a.theta - base.theta).toBeLessThan(2);
  });

  it('a terrible day also moves theta by less than 2 points', () => {
    let a = base;
    for (let i = 0; i < 60; i++)
      a = updateAbility(a, { d: 45, score: 0, kind: 'first', dayKey: '2026-10-12' });
    expect(base.theta - a.theta).toBeLessThan(2);
    expect(a.theta).toBeLessThan(base.theta);
  });

  it('first exposures move theta more than repeat reviews', () => {
    const first = updateAbility(base, { d: 55, score: 1, kind: 'first', dayKey: 'x' });
    const rev = updateAbility(base, { d: 55, score: 1, kind: 'review', dayKey: 'x' });
    expect(first.theta - base.theta).toBeGreaterThan(rev.theta - base.theta);
  });

  it('the daily budget resets on a new day', () => {
    let a = base;
    for (let i = 0; i < 50; i++)
      a = updateAbility(a, { d: 60, score: 1, kind: 'first', dayKey: 'day1' });
    const before = a.theta;
    a = updateAbility(a, { d: 60, score: 1, kind: 'first', dayKey: 'day2' });
    expect(a.theta - before).toBeGreaterThan(0.1);
  });

  it('a wrong probe takes a small hit', () => {
    const a = updateAbility(base, { d: 40, score: 0, kind: 'probe', dayKey: 'x' });
    expect(a.theta).toBeLessThan(base.theta);
    expect(base.theta - a.theta).toBeLessThan(1);
  });
});

describe('levelOf', () => {
  it('reports band and progress inside it', () => {
    const l = levelOf(53.5);
    expect(l.band).toBe('B2');
    expect(l.progress).toBeCloseTo((53.5 - 45) / 17, 5);
    expect(l.next).toBe('C1');
  });
});
