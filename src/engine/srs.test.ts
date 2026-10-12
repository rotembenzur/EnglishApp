import { describe, expect, it } from 'vitest';
import {
  crownsFor,
  deriveRating,
  isLeech,
  knownCard,
  newCard,
  review,
  speedProfile,
  speedRoundRating,
  scoreOf,
} from './srs';
import type { AnswerBehavior } from './types';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 12, 8);
const b = (over: Partial<AnswerBehavior>): AnswerBehavior => ({
  type: 'en_he',
  correct: true,
  hinted: false,
  nearMiss: false,
  responseMs: 3000,
  ...over,
});

describe('deriveRating (behavior, never self-report)', () => {
  it('wrong answers are Again', () => {
    expect(deriveRating(b({ correct: false }))).toBe(1);
    expect(deriveRating(b({ correct: false, type: 'typing', responseMs: 100 }))).toBe(1);
  });
  it('hints, near misses and slow answers are Hard', () => {
    expect(deriveRating(b({ hinted: true }))).toBe(2);
    expect(deriveRating(b({ type: 'typing', nearMiss: true }))).toBe(2);
    expect(deriveRating(b({ responseMs: 20_000 }))).toBe(2);
  });
  it('normal speed is Good', () => {
    expect(deriveRating(b({}))).toBe(3);
  });
  it('fast typing or listening is Easy, fast recognition stays Good', () => {
    expect(deriveRating(b({ type: 'typing', responseMs: 1500 }))).toBe(4);
    expect(deriveRating(b({ type: 'listening', responseMs: 1000 }))).toBe(4);
    expect(deriveRating(b({ type: 'en_he', responseMs: 500 }))).toBe(3);
  });
  it("uses the user's own percentiles once there are enough samples", () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({
      type: 'typing' as const,
      responseMs: 1000 + i * 100,
      correct: true,
    }));
    const profile = speedProfile(samples);
    expect(profile.typing!.n).toBe(50);
    // p80 of 1000..5900 is about 4900: 5500 is slow for this user.
    expect(deriveRating(b({ type: 'typing', responseMs: 5500 }), profile)).toBe(2);
    // p30 is about 2500: 2000 is fast for this user.
    expect(deriveRating(b({ type: 'typing', responseMs: 2000 }), profile)).toBe(4);
  });
  it('speed rounds only produce Hard or Good', () => {
    expect([2, 3]).toContain(speedRoundRating(false, 1000));
    expect([2, 3]).toContain(speedRoundRating(true, 1000));
    expect([2, 3]).toContain(speedRoundRating(true, 5999));
  });
  it('scores 1, 0.5 and 0', () => {
    expect(scoreOf({ correct: true, hinted: false, nearMiss: false })).toBe(1);
    expect(scoreOf({ correct: true, hinted: false, nearMiss: true })).toBe(0.5);
    expect(scoreOf({ correct: false, hinted: false, nearMiss: false })).toBe(0);
  });
});

describe('FSRS integration', () => {
  it('a good review pushes the due date forward and Again brings it back', () => {
    let c = newCard(now);
    c = review(c, 3, now);
    c = review(c, 3, c.due);
    c = review(c, 3, c.due);
    expect(c.fsrsState).toBe(2);
    const goodDue = c.due;
    const again = review(c, 1, c.due);
    expect(again.due).toBeLessThan(review(c, 3, c.due).due);
    expect(again.lapses).toBe(c.lapses + 1);
    expect(goodDue).toBeGreaterThan(now + DAY);
  });
  it('known shortcut cards start with a long interval anchored at now', () => {
    const c = knownCard(now);
    expect(c.due - now).toBeGreaterThan(20 * DAY);
    expect(c.lastReview).toBe(now);
    // Reviewing it soon after (speed round, hard words) must not throw.
    expect(() => review(c, 3, now + 60_000)).not.toThrow();
    expect(() => review(c, 1, now + 2 * DAY)).not.toThrow();
  });
  it('higher retention target means shorter intervals', () => {
    const start = review(review(newCard(now), 3, now), 3, now + 600_000);
    const strict = review(start, 3, start.due, { retention: 0.95 });
    const loose = review(start, 3, start.due, { retention: 0.8 });
    expect(strict.due).toBeLessThan(loose.due);
  });
});

describe('crowns and leeches', () => {
  it('crowns follow stability thresholds 1, 7, 30, 120, 365 days', () => {
    const base = newCard(now);
    expect(crownsFor(base)).toBe(0);
    expect(crownsFor({ ...base, fsrsState: 2, stability: 0.5 })).toBe(0);
    expect(crownsFor({ ...base, fsrsState: 2, stability: 1 })).toBe(1);
    expect(crownsFor({ ...base, fsrsState: 2, stability: 8 })).toBe(2);
    expect(crownsFor({ ...base, fsrsState: 2, stability: 31 })).toBe(3);
    expect(crownsFor({ ...base, fsrsState: 2, stability: 200 })).toBe(4);
    expect(crownsFor({ ...base, fsrsState: 2, stability: 400 })).toBe(5);
  });
  it('flags a leech at 6 lapses', () => {
    expect(isLeech(5)).toBe(false);
    expect(isLeech(6)).toBe(true);
  });
});
