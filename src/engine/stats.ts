/**
 * Derived statistics (spec 7.1 stats screen and 6.2 league), computed from plain rows.
 */
import { createRng, hashString, shuffle } from './rng';
import type { ReviewRecord, UserWord } from './types';

const DAY = 86_400_000;

/**
 * 7-day recall (success criterion): accuracy on graded reviews of words whose previous review
 * was at least 6 days earlier. Returns null when there is not enough data.
 */
export function recallAfterGap(
  reviews: readonly ReviewRecord[],
  opts: { minGapDays?: number; since?: number } = {},
): { rate: number; n: number } | null {
  const gap = (opts.minGapDays ?? 6) * DAY;
  const last = new Map<number, number>();
  let n = 0;
  let ok = 0;
  const sorted = [...reviews].sort((a, b) => a.at - b.at);
  for (const r of sorted) {
    if (r.purpose === 'probe' || r.purpose === 'verify' || r.purpose === 'duel') continue;
    const prev = last.get(r.lemmaId);
    if (prev !== undefined && r.at - prev >= gap && (!opts.since || r.at >= opts.since)) {
      n++;
      if (r.correct) ok++;
    }
    last.set(r.lemmaId, r.at);
  }
  return n ? { rate: ok / n, n } : null;
}

/** Share of correct review answers (not first exposures) since `since`. */
export function retentionSince(reviews: readonly ReviewRecord[], since: number) {
  const rs = reviews.filter(
    (r) => r.at >= since && !r.firstExposure && (r.purpose === 'review' || r.purpose === 'learn'),
  );
  return { rate: rs.length ? rs.filter((r) => r.correct).length / rs.length : 0, n: rs.length };
}

/** Accuracy by exercise type. */
export function accuracyByType(reviews: readonly ReviewRecord[]) {
  const by: Record<string, { n: number; ok: number }> = {};
  for (const r of reviews) {
    const x = (by[r.exerciseType] ??= { n: 0, ok: 0 });
    x.n++;
    if (r.correct) x.ok++;
  }
  return by;
}

/** Due reviews per day for the next `days` days (day 0 includes overdue). */
export function dueForecast(words: readonly UserWord[], now: number, days = 14): number[] {
  const out = new Array<number>(days).fill(0);
  const startOfToday = now - (now % DAY);
  for (const w of words) {
    if (w.state !== 'learning' && w.state !== 'review') continue;
    const idx = Math.max(0, Math.floor((w.card.due - startOfToday) / DAY));
    if (idx < days) out[idx]!++;
  }
  return out;
}

/** Count of items per day key, for the GitHub-style heatmap. */
export function activityByDay(
  reviews: readonly ReviewRecord[],
  toKey: (ts: number) => string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of reviews) m.set(toKey(r.at), (m.get(toKey(r.at)) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------------------
// Weekly league (spec 6.2): Monday to Sunday XP race.
// ---------------------------------------------------------------------------

/** Monday (YYYY-MM-DD) of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(date + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export interface WeekResult {
  week: string;
  a: number;
  b: number;
  winner: 'a' | 'b' | 'draw';
}

/** Weekly totals for two players from their daily XP maps, oldest week first. */
export function leagueHistory(
  aXp: ReadonlyMap<string, number>,
  bXp: ReadonlyMap<string, number>,
  currentWeek: string,
): WeekResult[] {
  const weeks = new Set<string>();
  for (const k of [...aXp.keys(), ...bXp.keys()]) weeks.add(weekStart(k));
  const out: WeekResult[] = [];
  for (const w of [...weeks].sort()) {
    if (w >= currentWeek) continue; // only finished weeks count
    const days = weekDays(w);
    const a = days.reduce((s, d) => s + (aXp.get(d) ?? 0), 0);
    const b = days.reduce((s, d) => s + (bXp.get(d) ?? 0), 0);
    out.push({ week: w, a, b, winner: a > b ? 'a' : b > a ? 'b' : 'draw' });
  }
  return out;
}

export function headToHead(history: readonly WeekResult[]) {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let run = 0;
  let runOwner: 'a' | 'b' | null = null;
  let longestA = 0;
  let longestB = 0;
  for (const w of history) {
    if (w.winner === 'draw') {
      draws++;
      run = 0;
      runOwner = null;
      continue;
    }
    if (w.winner === 'a') aWins++;
    else bWins++;
    run = runOwner === w.winner ? run + 1 : 1;
    runOwner = w.winner;
    if (w.winner === 'a') longestA = Math.max(longestA, run);
    else longestB = Math.max(longestB, run);
  }
  return { aWins, bWins, draws, longestA, longestB, currentRun: run, currentRunOwner: runOwner };
}

// ---------------------------------------------------------------------------
// Daily duel (spec 6.2): same 10 words for both players, seeded by date.
// ---------------------------------------------------------------------------

export const DUEL_SIZE = 10;

/** Deterministic list of lemma ids for the day's duel from an ordered candidate pool. */
export function duelWords(date: string, poolIds: readonly number[]): number[] {
  const rng = createRng(hashString(`duel:${date}`));
  return shuffle(
    rng,
    [...poolIds].sort((a, b) => a - b),
  ).slice(0, DUEL_SIZE);
}

/** Duel score: correct answers first, then total time (lower is better). */
export function compareDuel(
  a: { correct: number; ms: number },
  b: { correct: number; ms: number },
): 'a' | 'b' | 'draw' {
  if (a.correct !== b.correct) return a.correct > b.correct ? 'a' : 'b';
  if (Math.abs(a.ms - b.ms) < 100) return 'draw';
  return a.ms < b.ms ? 'a' : 'b';
}
