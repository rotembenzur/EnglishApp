/**
 * One-time data migrations, run on each phone when it opens a new version (spec 0.10: never
 * destroy user data). The phone is the source of truth: a migration changes the local rows and
 * queues them in the outbox, so sync carries the result to the server and the other phone.
 *
 * Each migration runs once per phone (a kv flag) and once per profile (an id in
 * `profile.migrations`, synced with the row). A later manual change is therefore never undone,
 * neither by this phone nor by the other phone opening the new version later with an old copy.
 */
import { DEFAULT_DAILY_GOAL } from '@/engine/game';
import { USER_IDS, type UserId } from '@/engine/types';
import { db, type OutboxRow } from './db';

/** 0.7.0: the daily goal moved from 60 XP to 1000 XP for everyone. */
export const GOAL_MIGRATION = 'goal-1000';

const doneKey = (id: string) => `migration:${id}`;

/**
 * Sets the daily goal of every profile on this phone (both users) to the new default.
 *
 * The row's `updatedAt` moves forward by one millisecond only, not to now: if this phone holds an
 * old copy of a profile that was already migrated and then changed by hand elsewhere, the server's
 * newer row still wins last-write-wins and comes back on the next pull. If the copy is current,
 * the migrated row is the newest and syncs up. Daily rows are not touched: a day whose goal was
 * already reached keeps `goalReached`, so today and the streak stay as they were.
 *
 * Returns the profiles it changed.
 */
export async function migrateDailyGoal(now = Date.now()): Promise<UserId[]> {
  return db.transaction('rw', [db.users, db.outbox, db.kv], async () => {
    if (await db.kv.get(doneKey(GOAL_MIGRATION))) return [];
    const changed: UserId[] = [];
    for (const id of USER_IDS) {
      const p = await db.users.get(id);
      if (!p || p.migrations?.[GOAL_MIGRATION]) continue;
      await db.users.put({
        ...p,
        settings: { ...p.settings, dailyGoal: DEFAULT_DAILY_GOAL },
        migrations: { ...p.migrations, [GOAL_MIGRATION]: now },
        updatedAt: p.updatedAt + 1,
      });
      const row: OutboxRow = { table: 'users', key: id, at: now };
      await db.outbox.add(row);
      changed.push(id);
    }
    await db.kv.put({ key: doneKey(GOAL_MIGRATION), value: now });
    return changed;
  });
}

/** Every pending migration, in order. Safe to call on every start. */
export async function runMigrations(): Promise<void> {
  await migrateDailyGoal();
}
