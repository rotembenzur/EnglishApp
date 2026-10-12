import { describe, expect, it } from 'vitest';
import { bandOf, computeDifficulty, rankToDifficulty } from './difficulty';

describe('rankToDifficulty', () => {
  it('matches the spec anchor points', () => {
    expect(rankToDifficulty(1)).toBe(0);
    expect(rankToDifficulty(100)).toBeCloseTo(5, 5);
    expect(rankToDifficulty(1000)).toBeCloseTo(25, 5);
    expect(rankToDifficulty(5000)).toBeCloseTo(50, 5);
    expect(rankToDifficulty(20000)).toBeCloseTo(75, 5);
    expect(rankToDifficulty(50000)).toBeCloseTo(90, 5);
    expect(rankToDifficulty(200000)).toBe(100);
  });
  it('is monotonic in rank', () => {
    let prev = -1;
    for (let r = 1; r < 120000; r += 37) {
      const d = rankToDifficulty(r);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
  it('rank 1..100 lands in 0..5', () => {
    for (let r = 1; r <= 100; r++) {
      const d = rankToDifficulty(r);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(5);
    }
  });
});

describe('computeDifficulty', () => {
  it('weights frequency at 70% and keeps results in range', () => {
    const d = computeDifficulty({ rank: 5000, length: 7 });
    expect(d).toBeGreaterThan(45);
    expect(d).toBeLessThan(55);
    expect(computeDifficulty({ rank: 1, length: 2 })).toBeGreaterThanOrEqual(0);
    expect(computeDifficulty({ rank: 999999, length: 20, abstract: true })).toBeLessThanOrEqual(
      100,
    );
  });
  it('CEFR tag corrects toward its band center', () => {
    const plain = computeDifficulty({ rank: 5000, length: 7 });
    const easy = computeDifficulty({ rank: 5000, length: 7, cefr: 'A1' });
    const hard = computeDifficulty({ rank: 5000, length: 7, cefr: 'C2' });
    expect(easy).toBeLessThan(plain);
    expect(hard).toBeGreaterThan(plain);
    // Correction stays a correction: at most ~20% of the gap.
    expect(plain - easy).toBeLessThan(12);
  });
  it('minor signals stay minor', () => {
    const a = computeDifficulty({ rank: 3000, length: 4, senses: 8 });
    const b = computeDifficulty({
      rank: 3000,
      length: 14,
      senses: 1,
      irregular: true,
      abstract: true,
    });
    expect(b - a).toBeLessThan(2.5);
  });
});

describe('bandOf', () => {
  it('maps difficulty to display bands', () => {
    expect(bandOf(0)).toBe('A1');
    expect(bandOf(20)).toBe('A2');
    expect(bandOf(35)).toBe('B1');
    expect(bandOf(50)).toBe('B2');
    expect(bandOf(70)).toBe('C1');
    expect(bandOf(85)).toBe('C2');
    expect(bandOf(99)).toBe('C2+');
  });
});
