import { describe, expect, it } from 'vitest';
import { bandOf } from './difficulty';
import { createRng } from './rng';
import {
  newWordsLeft,
  pickProbe,
  selectNewWords,
  suggestCapChange,
  windowWeight,
  clampCap,
} from './selection';
import type { LemmaInfo } from './types';

function inventory(n = 3000): LemmaInfo[] {
  return Array.from({ length: n }, (_, i) => {
    const d = (i / n) * 100;
    return {
      id: i + 1,
      lemma: `w${i + 1}`,
      rank: i + 1,
      pos: ['noun'],
      d,
      band: bandOf(d),
      tags: i % 10 === 0 ? ['travel'] : [],
      family: 0,
      tier: i < 1000 ? 'A' : 'C',
    };
  });
}

describe('new word window', () => {
  const lemmas = inventory();
  it('only samples inside [theta - 4, theta + 12]', () => {
    const rng = createRng(1);
    for (const theta of [20, 45, 70]) {
      const picks = selectNewWords(lemmas, { theta, studied: new Set() }, 50, rng);
      expect(picks).toHaveLength(50);
      for (const p of picks) {
        expect(p.d).toBeGreaterThanOrEqual(theta - 4);
        expect(p.d).toBeLessThanOrEqual(theta + 12);
      }
    }
  });
  it('peaks slightly above the level', () => {
    const rng = createRng(2);
    const theta = 60;
    const all: number[] = [];
    for (let i = 0; i < 20; i++) {
      all.push(...selectNewWords(lemmas, { theta, studied: new Set() }, 10, rng).map((l) => l.d));
    }
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeGreaterThan(theta + 2);
    expect(mean).toBeLessThan(theta + 8);
  });
  it('weight is zero outside the window and maximal at theta + 5', () => {
    expect(windowWeight(30, 50)).toBe(0);
    expect(windowWeight(63, 50)).toBe(0);
    expect(windowWeight(55, 50)).toBeCloseTo(1, 6);
    expect(windowWeight(55, 50)).toBeGreaterThan(windowWeight(60, 50));
  });
  it('never repeats studied words and never runs dry (widens the window)', () => {
    const studied = new Set(lemmas.filter((l) => l.d >= 40 && l.d <= 70).map((l) => l.id));
    const picks = selectNewWords(lemmas, { theta: 50, studied }, 8, createRng(3));
    expect(picks).toHaveLength(8);
    for (const p of picks) expect(studied.has(p.id)).toBe(false);
  });
  it('mixes in favorite topic words', () => {
    const rng = createRng(4);
    let topical = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const picks = selectNewWords(
        lemmas,
        { theta: 50, studied: new Set(), topics: ['travel'] },
        8,
        rng,
      );
      total += picks.length;
      topical += picks.filter((p) => p.tags.includes('travel')).length;
    }
    // Baseline share of travel words is 10%; topics push it up by about 10 points.
    expect(topical / total).toBeGreaterThan(0.13);
    expect(topical / total).toBeLessThan(0.35);
  });
  it('introduces a family root before its derived words', () => {
    const fam: LemmaInfo[] = [
      { id: 1, lemma: 'decide', rank: 500, pos: ['verb'], d: 52, band: 'B2', tags: [], family: 1 },
      {
        id: 2,
        lemma: 'decisive',
        rank: 7000,
        pos: ['adj'],
        d: 53,
        band: 'B2',
        tags: [],
        family: 1,
      },
      {
        id: 3,
        lemma: 'decision',
        rank: 600,
        pos: ['noun'],
        d: 53,
        band: 'B2',
        tags: [],
        family: 1,
      },
    ];
    let rootFirst = 0;
    for (let s = 0; s < 100; s++) {
      const [first] = selectNewWords(fam, { theta: 48, studied: new Set() }, 1, createRng(s));
      if (first?.id === 1) rootFirst++;
    }
    expect(rootFirst).toBeGreaterThan(70);
    // Never two members of the same family in one batch.
    const batch = selectNewWords(fam, { theta: 48, studied: new Set() }, 3, createRng(9));
    expect(new Set(batch.map((b) => b.family)).size).toBe(batch.length);
  });
  it('prefers words with authored content', () => {
    const mixed = inventory().map((l) => ({
      ...l,
      tier: l.id % 2 ? ('A' as const) : ('C' as const),
    }));
    const rng = createRng(5);
    let a = 0;
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const picks = selectNewWords(mixed, { theta: 50, studied: new Set() }, 8, rng);
      n += picks.length;
      a += picks.filter((p) => p.tier === 'A').length;
    }
    expect(a / n).toBeGreaterThan(0.65);
  });
});

describe('daily cap', () => {
  it('defaults and bounds', () => {
    expect(newWordsLeft(8, 0)).toBe(8);
    expect(newWordsLeft(8, 5)).toBe(3);
    expect(newWordsLeft(8, 9)).toBe(0);
    expect(clampCap(1)).toBe(3);
    expect(clampCap(40)).toBe(25);
  });
  it('suggests raising only with high retention and a calm queue', () => {
    expect(suggestCapChange({ cap: 8, retention7d: 0.9, reviews7d: 100, dueCount: 10 })).toEqual({
      direction: 'up',
      to: 10,
    });
    expect(suggestCapChange({ cap: 8, retention7d: 0.8, reviews7d: 100, dueCount: 10 })).toBeNull();
    expect(suggestCapChange({ cap: 8, retention7d: 0.9, reviews7d: 100, dueCount: 40 })).toBeNull();
    expect(
      suggestCapChange({ cap: 25, retention7d: 0.99, reviews7d: 100, dueCount: 0 }),
    ).toBeNull();
  });
  it('suggests lowering when more than 60 reviews are due', () => {
    expect(suggestCapChange({ cap: 8, retention7d: 0.95, reviews7d: 100, dueCount: 61 })).toEqual({
      direction: 'down',
      to: 6,
    });
    expect(
      suggestCapChange({ cap: 3, retention7d: 0.5, reviews7d: 100, dueCount: 100 }),
    ).toBeNull();
  });
});

describe('sanity probes', () => {
  it('come from unstudied words just below the level', () => {
    const lemmas = inventory();
    const rng = createRng(6);
    for (let i = 0; i < 50; i++) {
      const p = pickProbe(lemmas, { theta: 60, studied: new Set() }, rng)!;
      expect(p.d).toBeGreaterThanOrEqual(40);
      expect(p.d).toBeLessThan(56);
    }
  });
  it('returns null for a beginner with nothing below', () => {
    expect(pickProbe(inventory(), { theta: 2, studied: new Set() }, createRng(1))).toBeNull();
  });
});
