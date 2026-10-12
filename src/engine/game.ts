/**
 * Gamification rules (spec 6.1): XP, combos, levels, streaks with freezes, badges.
 * Everything here is derived from plain stats so it can be recomputed from the review log.
 */
import type { GradedType } from './types';

export const XP_BY_TYPE: Record<GradedType, number> = {
  en_he: 10,
  he_en: 10,
  match: 6, // per pair
  listening: 12,
  cloze: 14,
  typing: 18,
  spell_audio: 18,
  speed: 6,
};
export const XP_NEW_WORD_LEARNED = 25;
export const XP_PROBE_PASSED = 8;
export const DEFAULT_DAILY_GOAL = 60;

/** Combo multiplier by consecutive correct answers in a session. */
export function comboMultiplier(streak: number): number {
  if (streak >= 10) return 2;
  if (streak >= 6) return 1.5;
  if (streak >= 3) return 1.2;
  return 1;
}

/** XP for one answer. `combo` is the consecutive-correct count including this answer. */
export function xpForAnswer(
  type: GradedType,
  score: number,
  combo: number,
  speedBonus = 1,
): number {
  if (score <= 0) return 0;
  const base = XP_BY_TYPE[type] * (score >= 1 ? 1 : 0.5);
  return Math.round(base * comboMultiplier(combo) * speedBonus);
}

// ---------------------------------------------------------------------------
// Levels: a gentle curve. Level n starts at 60 * (n-1)^1.55 rounded to 10.
// ---------------------------------------------------------------------------

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round((60 * Math.pow(level - 1, 1.55)) / 10) * 10;
}

export function levelForXp(xp: number): { level: number; into: number; span: number } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const start = xpForLevel(level);
  return { level, into: xp - start, span: xpForLevel(level + 1) - start };
}

// ---------------------------------------------------------------------------
// Streaks (spec 6.1): days with the goal reached; one freeze per 7-day streak, max 2 banked,
// auto-applied on a missed day. Derived from daily stats, no stored counters.
// ---------------------------------------------------------------------------

export interface DayResult {
  date: string; // YYYY-MM-DD
  goalReached: boolean;
}

export interface StreakInfo {
  current: number;
  record: number;
  freezes: number;
  /** Days covered by a freeze. */
  frozen: string[];
  /** True when today's goal is not reached yet but the streak is still alive. */
  pendingToday: boolean;
}

export const MAX_FREEZES = 2;

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeStreak(days: readonly DayResult[], today: string): StreakInfo {
  const reached = new Set(days.filter((d) => d.goalReached).map((d) => d.date));
  const first = [...reached].sort()[0];
  const info: StreakInfo = { current: 0, record: 0, freezes: 0, frozen: [], pendingToday: false };
  if (!first) return info;
  let streak = 0;
  for (let date = first; date <= today; date = addDays(date, 1)) {
    if (reached.has(date)) {
      streak++;
      if (streak % 7 === 0) info.freezes = Math.min(MAX_FREEZES, info.freezes + 1);
      info.record = Math.max(info.record, streak);
    } else if (date === today) {
      info.pendingToday = streak > 0;
    } else if (streak > 0 && info.freezes > 0) {
      info.freezes--;
      info.frozen.push(date);
    } else {
      streak = 0;
    }
  }
  info.current = streak;
  return info;
}

// ---------------------------------------------------------------------------
// Badges (spec 6.1): at least 30.
// ---------------------------------------------------------------------------

export interface BadgeStats {
  sessions: number;
  wordsStudied: number;
  wordsLearned: number;
  streakRecord: number;
  perfectSessions: number;
  typedCorrect: number;
  speedBest: number;
  earlyBird: boolean;
  nightOwl: boolean;
  placementLevelUp: boolean;
  topicsCompleted: number;
  reports: number;
  rivalWeeksWonInRow: number;
  duelsPlayed: number;
  duelsWon: number;
  nudgesSent: number;
  fiveCrownWords: number;
  xpTotal: number;
  daysActive: number;
  bossCompleted: number;
  listeningSessions: number;
  hardSessions: number;
  comboMax: number;
  matchUnder10s: number;
  notesWritten: number;
  favorites: number;
  probesPassed: number;
  leechesTamed: number;
  goalDays: number;
  weekendWarrior: boolean;
}

export interface BadgeDef {
  id: string;
  icon: string;
  test: (s: BadgeStats) => boolean;
}

export const BADGES: BadgeDef[] = [
  { id: 'first_session', icon: '🌱', test: (s) => s.sessions >= 1 },
  { id: 'words_100', icon: '💯', test: (s) => s.wordsStudied >= 100 },
  { id: 'words_500', icon: '📚', test: (s) => s.wordsStudied >= 500 },
  { id: 'words_1000', icon: '🏛️', test: (s) => s.wordsStudied >= 1000 },
  { id: 'words_5000', icon: '🌌', test: (s) => s.wordsStudied >= 5000 },
  { id: 'streak_7', icon: '🔥', test: (s) => s.streakRecord >= 7 },
  { id: 'streak_30', icon: '🌋', test: (s) => s.streakRecord >= 30 },
  { id: 'streak_100', icon: '☄️', test: (s) => s.streakRecord >= 100 },
  { id: 'streak_365', icon: '👑', test: (s) => s.streakRecord >= 365 },
  { id: 'perfect_session', icon: '✨', test: (s) => s.perfectSessions >= 1 },
  { id: 'perfect_10', icon: '💎', test: (s) => s.perfectSessions >= 10 },
  { id: 'typist_50', icon: '⌨️', test: (s) => s.typedCorrect >= 50 },
  { id: 'typist_500', icon: '🖋️', test: (s) => s.typedCorrect >= 500 },
  { id: 'speed_20', icon: '⚡', test: (s) => s.speedBest >= 20 },
  { id: 'speed_35', icon: '🚀', test: (s) => s.speedBest >= 35 },
  { id: 'early_bird', icon: '🐦', test: (s) => s.earlyBird },
  { id: 'night_owl', icon: '🦉', test: (s) => s.nightOwl },
  { id: 'level_up_retake', icon: '📈', test: (s) => s.placementLevelUp },
  { id: 'topic_complete', icon: '🧭', test: (s) => s.topicsCompleted >= 1 },
  { id: 'quality_guardian', icon: '🛡️', test: (s) => s.reports >= 10 },
  { id: 'rival_4_weeks', icon: '🏆', test: (s) => s.rivalWeeksWonInRow >= 4 },
  { id: 'duelist', icon: '🤺', test: (s) => s.duelsPlayed >= 10 },
  { id: 'duel_champion', icon: '🥇', test: (s) => s.duelsWon >= 10 },
  { id: 'nudger', icon: '👋', test: (s) => s.nudgesSent >= 10 },
  { id: 'crowned_10', icon: '👸', test: (s) => s.fiveCrownWords >= 10 },
  { id: 'crowned_100', icon: '🤴', test: (s) => s.fiveCrownWords >= 100 },
  { id: 'xp_10000', icon: '🎯', test: (s) => s.xpTotal >= 10000 },
  { id: 'xp_50000', icon: '🪐', test: (s) => s.xpTotal >= 50000 },
  { id: 'days_50', icon: '📅', test: (s) => s.daysActive >= 50 },
  { id: 'boss_slayer', icon: '🐉', test: (s) => s.bossCompleted >= 1 },
  { id: 'all_ears', icon: '🎧', test: (s) => s.listeningSessions >= 5 },
  { id: 'hard_mode', icon: '🧗', test: (s) => s.hardSessions >= 5 },
  { id: 'combo_20', icon: '🌀', test: (s) => s.comboMax >= 20 },
  { id: 'matchmaker', icon: '🧩', test: (s) => s.matchUnder10s >= 5 },
  { id: 'note_taker', icon: '📝', test: (s) => s.notesWritten >= 5 },
  { id: 'collector', icon: '⭐', test: (s) => s.favorites >= 20 },
  { id: 'honest_level', icon: '🧪', test: (s) => s.probesPassed >= 25 },
  { id: 'leech_tamer', icon: '🪱', test: (s) => s.leechesTamed >= 3 },
  { id: 'goal_100', icon: '🎖️', test: (s) => s.goalDays >= 100 },
  { id: 'weekend_warrior', icon: '🏖️', test: (s) => s.weekendWarrior },
];

export function earnedBadges(stats: BadgeStats): string[] {
  return BADGES.filter((b) => b.test(stats)).map((b) => b.id);
}

export function emptyBadgeStats(): BadgeStats {
  return {
    sessions: 0,
    wordsStudied: 0,
    wordsLearned: 0,
    streakRecord: 0,
    perfectSessions: 0,
    typedCorrect: 0,
    speedBest: 0,
    earlyBird: false,
    nightOwl: false,
    placementLevelUp: false,
    topicsCompleted: 0,
    reports: 0,
    rivalWeeksWonInRow: 0,
    duelsPlayed: 0,
    duelsWon: 0,
    nudgesSent: 0,
    fiveCrownWords: 0,
    xpTotal: 0,
    daysActive: 0,
    bossCompleted: 0,
    listeningSessions: 0,
    hardSessions: 0,
    comboMax: 0,
    matchUnder10s: 0,
    notesWritten: 0,
    favorites: 0,
    probesPassed: 0,
    leechesTamed: 0,
    goalDays: 0,
    weekendWarrior: false,
  };
}
