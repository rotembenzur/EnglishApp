import { beforeEach, describe, expect, it } from 'vitest';
import { computeStreak, DEFAULT_DAILY_GOAL } from '@/engine/game';
import type { UserId } from '@/engine/types';
import { db, DEFAULT_SETTINGS, type DailyStats, type UserProfile } from './db';
import { bumpDaily, getDaily, getProfile, saveProfile } from './repo';
import { GOAL_MIGRATION, migrateDailyGoal, runMigrations } from './migrations';

async function wipe() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

/** A profile as an older version stored it: goal 60, no migrations field. */
function oldProfile(id: UserId, updatedAt = 1_000): UserProfile {
  return {
    id,
    name: id,
    settings: { ...DEFAULT_SETTINGS, dailyGoal: 60 },
    ability: { theta: 50, sigma: 8, answers: 200, assumedKnownBelow: 30 },
    badges: { first_session: 1 },
    thetaHistory: [[1, 50]],
    createdAt: 1,
    updatedAt,
    deviceId: 'dev-old',
  };
}

function day(userId: UserId, date: string, xp: number, goalReached: boolean): DailyStats {
  return {
    userId,
    date,
    xp,
    newWords: 0,
    reviews: 0,
    correct: 0,
    ms: 0,
    sessions: 1,
    goal: 60,
    goalReached,
    updatedAt: 1,
    deviceId: 'dev-old',
  };
}

describe('daily goal default', () => {
  beforeEach(wipe);

  it('is 1000 XP for new profiles and new days', async () => {
    expect(DEFAULT_DAILY_GOAL).toBe(1000);
    expect(DEFAULT_SETTINGS.dailyGoal).toBe(1000);
    const p = await getProfile('noa');
    expect(p.settings.dailyGoal).toBe(1000);
    // A new profile is born migrated: no later run touches it.
    expect(p.migrations?.[GOAL_MIGRATION]).toBeGreaterThan(0);
    expect((await getDaily('noa', '2026-10-13')).goal).toBe(1000);
  });

  it('a profile created on the new version keeps a goal changed by hand', async () => {
    const p = await getProfile('rotem');
    await saveProfile({ ...p, settings: { ...p.settings, dailyGoal: 700 } });
    await db.kv.clear();
    expect(await migrateDailyGoal()).toEqual([]);
    expect((await db.users.get('rotem'))?.settings.dailyGoal).toBe(700);
  });
});

describe('goal migration (0.7.0)', () => {
  beforeEach(wipe);

  it('sets both profiles to 1000, keeps everything else and queues them for sync', async () => {
    await db.users.bulkPut([oldProfile('rotem', 5_000), oldProfile('noa', 7_000)]);
    const changed = await migrateDailyGoal(123);
    expect(changed).toEqual(['rotem', 'noa']);
    for (const [id, before] of [
      ['rotem', 5_000],
      ['noa', 7_000],
    ] as const) {
      const old = oldProfile(id, before);
      // Only the goal and the marker change; one millisecond newer, never "now", so a newer row
      // elsewhere still wins (see the sync tests).
      expect(await db.users.get(id)).toEqual({
        ...old,
        settings: { ...old.settings, dailyGoal: 1000 },
        migrations: { [GOAL_MIGRATION]: 123 },
        updatedAt: before + 1,
      });
    }
    const outbox = await db.outbox.toArray();
    expect(outbox.map((o) => `${o.table}:${o.key}`).sort()).toEqual(['users:noa', 'users:rotem']);
    expect(await db.kv.get(`migration:${GOAL_MIGRATION}`)).toBeTruthy();
  });

  it('runs once: a goal changed by hand afterwards is never overwritten', async () => {
    await db.users.put(oldProfile('rotem'));
    await runMigrations();
    expect((await db.users.get('rotem'))?.settings.dailyGoal).toBe(1000);
    const p = await getProfile('rotem');
    await saveProfile({ ...p, settings: { ...p.settings, dailyGoal: 1500 } });
    const outboxBefore = await db.outbox.count();

    await runMigrations();
    expect(await migrateDailyGoal()).toEqual([]);
    expect((await db.users.get('rotem'))?.settings.dailyGoal).toBe(1500);
    expect(await db.outbox.count()).toBe(outboxBefore);

    // Even without this phone's flag (a reinstall restoring the synced row), the profile's own
    // marker keeps the manual change.
    await db.kv.clear();
    expect(await migrateDailyGoal()).toEqual([]);
    expect((await db.users.get('rotem'))?.settings.dailyGoal).toBe(1500);
  });

  it('does nothing on a phone with no profiles yet, and still records that it ran', async () => {
    expect(await migrateDailyGoal()).toEqual([]);
    expect(await db.kv.get(`migration:${GOAL_MIGRATION}`)).toBeTruthy();
    // A profile arriving later (first pull from the other phone) is left to its own phone.
    await db.users.put(oldProfile('noa'));
    expect(await migrateDailyGoal()).toEqual([]);
  });

  it('keeps today and the streak: a day already met under 60 stays met', async () => {
    const today = '2026-10-13';
    await db.users.put(oldProfile('rotem'));
    await db.dailyStats.bulkPut([
      day('rotem', '2026-10-10', 90, true),
      day('rotem', '2026-10-11', 75, true),
      day('rotem', '2026-10-12', 120, true),
      day('rotem', today, 80, true),
    ]);
    const before = computeStreak(await db.dailyStats.toArray(), today);
    expect(before.current).toBe(4);

    await runMigrations();
    expect(await db.dailyStats.count()).toBe(4);
    expect((await db.dailyStats.get(['rotem', today]))?.goalReached).toBe(true);
    expect(computeStreak(await db.dailyStats.toArray(), today)).toEqual(before);

    // More practice today under the new goal: still met, no second celebration.
    const goal = (await db.users.get('rotem'))!.settings.dailyGoal;
    const r = await bumpDaily('rotem', today, { xp: 30 }, goal);
    expect(r.before.goalReached).toBe(true);
    expect(r.after.goalReached).toBe(true);
    expect(r.after.xp).toBe(110);
    expect(computeStreak(await db.dailyStats.toArray(), today).current).toBe(4);
  });

  it('a day not met yet stays open and now needs the new goal', async () => {
    const today = '2026-10-13';
    await db.users.put(oldProfile('noa'));
    await db.dailyStats.bulkPut([day('noa', '2026-10-12', 70, true), day('noa', today, 40, false)]);
    await runMigrations();
    const streak = computeStreak(await db.dailyStats.toArray(), today);
    expect(streak.current).toBe(1);
    expect(streak.pendingToday).toBe(true);
    const goal = (await db.users.get('noa'))!.settings.dailyGoal;
    expect((await bumpDaily('noa', today, { xp: 100 }, goal)).after.goalReached).toBe(false);
    const done = await bumpDaily('noa', today, { xp: 860 }, goal);
    expect(done.before.goalReached).toBe(false);
    expect(done.after.goalReached).toBe(true);
    expect(computeStreak(await db.dailyStats.toArray(), today).current).toBe(2);
  });
});
