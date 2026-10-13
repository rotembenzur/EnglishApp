import { describe, expect, it } from 'vitest';
import {
  BADGES,
  comboMultiplier,
  computeStreak,
  earnedBadges,
  emptyBadgeStats,
  levelForXp,
  clampGoal,
  DEFAULT_DAILY_GOAL,
  GOAL_MAX,
  GOAL_MIN,
  GOAL_PRESETS,
  GOAL_STEP,
  xpForAnswer,
  xpForLevel,
} from './game';
import {
  compareDuel,
  duelWords,
  headToHead,
  leagueHistory,
  recallAfterGap,
  weekStart,
} from './stats';
import type { ReviewRecord } from './types';

describe('XP and combos', () => {
  it('combo multiplier steps at 3, 6 and 10', () => {
    expect([1, 2, 3, 5, 6, 9, 10, 30].map(comboMultiplier)).toEqual([
      1, 1, 1.2, 1.2, 1.5, 1.5, 2, 2,
    ]);
  });
  it('XP by type with combo, half for near misses, none for wrong', () => {
    expect(xpForAnswer('typing', 1, 1)).toBe(18);
    expect(xpForAnswer('typing', 1, 10)).toBe(36);
    expect(xpForAnswer('cloze', 0.5, 1)).toBe(7);
    expect(xpForAnswer('listening', 0, 5)).toBe(0);
    expect(xpForAnswer('speed', 1, 3)).toBe(7);
  });
});

describe('daily goal', () => {
  it('defaults to 1000 and stays inside the settings range on the step grid', () => {
    expect(DEFAULT_DAILY_GOAL).toBe(1000);
    expect(GOAL_PRESETS).toContain(DEFAULT_DAILY_GOAL);
    for (const g of GOAL_PRESETS) expect(clampGoal(g)).toBe(g);
    expect(clampGoal(60)).toBe(GOAL_MIN);
    expect(clampGoal(5000)).toBe(GOAL_MAX);
    expect(clampGoal(1049)).toBe(1000);
    expect(clampGoal(Number.NaN)).toBe(DEFAULT_DAILY_GOAL);
    expect(GOAL_MIN).toBe(300);
    expect(GOAL_MAX).toBe(3000);
    expect(GOAL_STEP).toBe(100);
  });
});

describe('levels', () => {
  it('thresholds increase gently', () => {
    expect(xpForLevel(1)).toBe(0);
    let prevGap = 0;
    for (let l = 2; l < 40; l++) {
      const gap = xpForLevel(l + 1) - xpForLevel(l);
      expect(gap).toBeGreaterThanOrEqual(prevGap);
      prevGap = gap;
    }
  });
  it('is scaled to a 1000 XP goal day', () => {
    // Level 2 after the first goal day, level 10 after about a month, the last title after a year.
    expect(xpForLevel(2)).toBe(1000);
    expect(levelForXp(999).level).toBe(1);
    expect(levelForXp(1000).level).toBe(2);
    expect(levelForXp(30 * 1000).level).toBe(9);
    expect(levelForXp(31 * 1000).level).toBe(10);
    expect(levelForXp(365 * 1000).level).toBe(45);
    expect(levelForXp(370 * 1000).level).toBe(46);
    // One normal session never jumps more than a level, except at the very start.
    for (let xp = 2000; xp < 400_000; xp += 5000)
      expect(levelForXp(xp + 500).level - levelForXp(xp).level).toBeLessThanOrEqual(1);
  });
  it('levelForXp inverts thresholds', () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(xpForLevel(5)).level).toBe(5);
    expect(levelForXp(xpForLevel(5) - 1).level).toBe(4);
  });
});

describe('streaks', () => {
  const days = (list: string[]) => list.map((date) => ({ date, goalReached: true }));
  it('counts consecutive goal days and keeps today pending', () => {
    const s = computeStreak(days(['2026-10-09', '2026-10-10', '2026-10-11']), '2026-10-12');
    expect(s.current).toBe(3);
    expect(s.pendingToday).toBe(true);
  });
  it('breaks on a missed day without freezes', () => {
    const s = computeStreak(days(['2026-10-08', '2026-10-10', '2026-10-11']), '2026-10-11');
    expect(s.current).toBe(2);
    expect(s.record).toBe(2);
  });
  it('earns a freeze per 7 days and auto-applies it', () => {
    const run = Array.from({ length: 7 }, (_, i) => `2026-10-0${i + 1}`);
    const s = computeStreak(days([...run, '2026-10-09']), '2026-10-09');
    expect(s.frozen).toEqual(['2026-10-08']);
    expect(s.current).toBe(8);
    expect(s.freezes).toBe(0);
  });
  it('banks at most 2 freezes', () => {
    const run: string[] = [];
    const d = new Date('2026-01-01T12:00:00Z');
    for (let i = 0; i < 35; i++) {
      run.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    expect(computeStreak(days(run), run[run.length - 1]!).freezes).toBe(2);
  });
});

describe('badges', () => {
  it('has at least 30 badges with unique ids', () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });
  it('awards by thresholds', () => {
    const s = { ...emptyBadgeStats(), sessions: 1, wordsStudied: 120, streakRecord: 8 };
    const got = earnedBadges(s);
    expect(got).toContain('first_session');
    expect(got).toContain('words_100');
    expect(got).toContain('streak_7');
    expect(got).not.toContain('words_500');
  });
});

describe('league and duel', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
  });
  it('computes finished weeks and head to head', () => {
    const a = new Map([
      ['2026-09-28', 100],
      ['2026-10-05', 50],
      ['2026-10-12', 999],
    ]);
    const b = new Map([
      ['2026-09-29', 80],
      ['2026-10-06', 50],
    ]);
    const h = leagueHistory(a, b, '2026-10-12');
    expect(h.map((w) => w.winner)).toEqual(['a', 'draw']);
    const r = headToHead([
      ...h,
      { week: 'x', a: 1, b: 2, winner: 'b' },
      { week: 'y', a: 1, b: 2, winner: 'b' },
    ]);
    expect(r).toMatchObject({ aWins: 1, bWins: 2, draws: 1, longestB: 2, currentRunOwner: 'b' });
  });
  it('duel words are the same for both players on a date and differ across dates', () => {
    const pool = Array.from({ length: 500 }, (_, i) => i + 1);
    expect(duelWords('2026-10-12', pool)).toEqual(duelWords('2026-10-12', [...pool].reverse()));
    expect(duelWords('2026-10-12', pool)).not.toEqual(duelWords('2026-10-13', pool));
    expect(duelWords('2026-10-12', pool)).toHaveLength(10);
  });
  it('duel compares correct answers first, then time', () => {
    expect(compareDuel({ correct: 9, ms: 30000 }, { correct: 8, ms: 10000 })).toBe('a');
    expect(compareDuel({ correct: 9, ms: 30000 }, { correct: 9, ms: 20000 })).toBe('b');
  });
});

describe('7-day recall', () => {
  it('only counts reviews after a gap of 6+ days', () => {
    const DAY = 86_400_000;
    const r = (lemmaId: number, day: number, correct: boolean): ReviewRecord => ({
      id: `${lemmaId}-${day}`,
      userId: 'rotem',
      lemmaId,
      exerciseType: 'en_he',
      rating: correct ? 3 : 1,
      correct,
      score: correct ? 1 : 0,
      responseMs: 2000,
      firstExposure: false,
      purpose: 'review',
      d: 40,
      at: day * DAY,
      deviceId: 'x',
    });
    const log = [r(1, 0, true), r(1, 1, false), r(1, 8, true), r(2, 0, true), r(2, 10, false)];
    expect(recallAfterGap(log)).toEqual({ rate: 0.5, n: 2 });
  });
});
