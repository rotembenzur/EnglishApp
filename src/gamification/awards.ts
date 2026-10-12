/**
 * Badge awarding: derives badge stats from local data after each session and records new badges.
 */
import {
  BADGES,
  computeStreak,
  earnedBadges,
  emptyBadgeStats,
  type BadgeStats,
} from '@/engine/game';
import { compareDuel, headToHead, leagueHistory, weekStart } from '@/engine/stats';
import type { UserId } from '@/engine/types';
import { db } from '@/data/db';
import { addEvent, saveProfile } from '@/data/repo';
import { todayKey, useApp } from '@/state/app';
import { loadInventory } from '@/content/inventory';

export const TOPIC_SET_SIZE = 40;

function localHour(ts: number): number {
  return new Date(ts).getHours();
}

export async function computeBadgeStats(userId: UserId): Promise<BadgeStats> {
  const s = emptyBadgeStats();
  const rival: UserId = userId === 'rotem' ? 'noa' : 'rotem';
  const [words, events, daily, rivalDaily] = await Promise.all([
    db.userWords.where('userId').equals(userId).toArray(),
    db.events.where('userId').equals(userId).toArray(),
    db.dailyStats.where('userId').equals(userId).toArray(),
    db.dailyStats.where('userId').equals(rival).toArray(),
  ]);
  let typed = 0;
  let probes = 0;
  await db.reviews
    .where('userId')
    .equals(userId)
    .each((r) => {
      if ((r.exerciseType === 'typing' || r.exerciseType === 'spell_audio') && r.correct) typed++;
      if (r.purpose === 'probe' && r.correct) probes++;
      if (r.purpose === 'learn' && r.correct) {
        const h = localHour(r.at);
        if (h >= 5 && h < 7) s.earlyBird = true;
        if (h >= 23) s.nightOwl = true;
      }
    });
  s.typedCorrect = typed;
  s.probesPassed = probes;
  s.wordsStudied = words.filter((w) => w.state !== 'known').length;
  s.wordsLearned = words.filter((w) => w.learnedAt).length;
  s.fiveCrownWords = words.filter((w) => w.crowns >= 5).length;
  s.notesWritten = words.filter((w) => w.note && w.note.trim()).length;
  s.favorites = words.filter((w) => w.favorite).length;
  s.leechesTamed = words.filter((w) => w.isLeech && w.crowns >= 2).length;

  const sessions = events.filter((e) => e.type === 'session' && e.payload.mode);
  s.sessions = sessions.length;
  s.perfectSessions = sessions.filter((e) => e.payload.perfect).length;
  s.comboMax = Math.max(0, ...sessions.map((e) => Number(e.payload.comboMax ?? 0)));
  s.speedBest = Math.max(0, ...sessions.map((e) => Number(e.payload.speedScore ?? 0)));
  s.bossCompleted = sessions.filter((e) => e.payload.mode === 'boss').length;
  s.listeningSessions = sessions.filter((e) => e.payload.mode === 'listening').length;
  s.hardSessions = sessions.filter((e) => e.payload.mode === 'hard').length;
  s.matchUnder10s = events.filter((e) => e.type === 'session' && e.payload.matchUnder10s).length;
  s.reports = events.filter((e) => e.type === 'report').length;
  s.nudgesSent = events.filter((e) => e.type === 'nudge').length;
  s.placementLevelUp = events.some((e) => e.type === 'placement' && e.payload.levelUp);
  const duels = events.filter((e) => e.type === 'duel');
  s.duelsPlayed = duels.length;
  const rivalDuels = new Map(
    (
      await db.events
        .where('userId')
        .equals(rival)
        .filter((e) => e.type === 'duel')
        .toArray()
    ).map((e) => [
      String(e.payload.date),
      { correct: Number(e.payload.correct), ms: Number(e.payload.ms) },
    ]),
  );
  s.duelsWon = duels.filter((e) => {
    const theirs = rivalDuels.get(String(e.payload.date));
    return (
      !!theirs &&
      compareDuel({ correct: Number(e.payload.correct), ms: Number(e.payload.ms) }, theirs) === 'a'
    );
  }).length;

  s.xpTotal = daily.reduce((a, d) => a + d.xp, 0);
  s.daysActive = daily.filter((d) => d.xp > 0).length;
  s.goalDays = daily.filter((d) => d.goalReached).length;
  s.streakRecord = computeStreak(daily, todayKey()).record;
  const reached = new Set(daily.filter((d) => d.goalReached).map((d) => d.date));
  for (const d of reached) {
    const dt = new Date(d + 'T12:00:00Z');
    if (dt.getUTCDay() === 6) {
      dt.setUTCDate(dt.getUTCDate() + 1);
      if (reached.has(dt.toISOString().slice(0, 10))) s.weekendWarrior = true;
    }
  }

  const mine = new Map(daily.map((d) => [d.date, d.xp]));
  const theirs = new Map(rivalDaily.map((d) => [d.date, d.xp]));
  const h2h = headToHead(leagueHistory(mine, theirs, weekStart(todayKey())));
  s.rivalWeeksWonInRow = h2h.currentRunOwner === 'a' ? h2h.currentRun : 0;

  // Topics: a topic is complete when its first 40 authored words are all studied.
  try {
    const inv = await loadInventory();
    const studied = new Set(words.map((w) => w.lemmaId));
    const byTopic = new Map<string, number[]>();
    for (const l of inv.lemmas) {
      if (l.tier !== 'A' || l.kind !== 'word') continue;
      for (const t of l.tags) {
        const arr = byTopic.get(t) ?? [];
        if (arr.length < TOPIC_SET_SIZE) arr.push(l.id);
        byTopic.set(t, arr);
      }
    }
    s.topicsCompleted = [...byTopic.values()].filter(
      (ids) => ids.length >= 10 && ids.every((id) => studied.has(id)),
    ).length;
  } catch {
    // inventory unavailable: skip topic badges this time
  }
  return s;
}

/** Award any newly earned badges; returns their ids (for the session summary). */
export async function afterSession(userId: UserId): Promise<string[]> {
  const stats = await computeBadgeStats(userId);
  const earned = earnedBadges(stats);
  const app = useApp.getState();
  const profile = app.profile;
  if (!profile || profile.id !== userId) return [];
  const fresh = earned.filter((id) => !profile.badges[id]);
  if (!fresh.length) return [];
  const now = Date.now();
  const badges = { ...profile.badges };
  for (const id of fresh) badges[id] = now;
  const next = await saveProfile({ ...profile, badges });
  app.setProfile(next);
  for (const id of fresh) await addEvent({ userId, type: 'badge', payload: { badge: id } });
  return fresh;
}

export const BADGE_COUNT = BADGES.length;
