import type { UserId } from '@/engine/types';
import { computeStreak } from '@/engine/game';
import { weekDays, weekStart } from '@/engine/stats';
import { db, type DailyStats, type Presence, type UserProfile } from '@/data/db';
import { USER_NAMES } from '@/data/repo';
import { todayKey } from './app';

export const otherUser = (u: UserId): UserId => (u === 'rotem' ? 'noa' : 'rotem');
export const isFemale = (u: UserId) => u === 'noa';

export interface PlayerSnapshot {
  id: UserId;
  name: string;
  profile: UserProfile | undefined;
  today: DailyStats | undefined;
  presence: Presence | undefined;
  streak: number;
  weekXp: number;
  weekByDay: number[];
  totalWords: number;
  lastActivity: number;
}

export async function snapshot(id: UserId): Promise<PlayerSnapshot> {
  const today = todayKey();
  const monday = weekStart(today);
  const days = weekDays(monday);
  const [profile, daily, presence, totalWords] = await Promise.all([
    db.users.get(id),
    db.dailyStats.where('userId').equals(id).toArray(),
    db.presence.get(id),
    db.userWords
      .where('userId')
      .equals(id)
      .filter((w) => w.state !== 'known' && w.state !== 'ignored')
      .count(),
  ]);
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const weekByDay = days.map((d) => byDate.get(d)?.xp ?? 0);
  const lastActivity = Math.max(presence?.lastSeenAt ?? 0, ...daily.map((d) => d.updatedAt));
  return {
    id,
    name: USER_NAMES[id],
    profile,
    today: byDate.get(today),
    presence,
    streak: computeStreak(daily, today).current,
    weekXp: weekByDay.reduce((a, b) => a + b, 0),
    weekByDay,
    totalWords,
    lastActivity,
  };
}
