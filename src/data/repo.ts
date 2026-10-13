/**
 * Repository: the only module that writes user data. Every write lands in IndexedDB first and
 * is queued in the outbox for sync (spec 9.3).
 */
import type { ReviewRecord, UserId, UserWord } from '@/engine/types';
import {
  db,
  DEFAULT_SETTINGS,
  deviceId,
  type AppEvent,
  type DailyStats,
  type OutboxRow,
  type Presence,
  type SyncTable,
  type UserProfile,
} from './db';

export const USER_NAMES: Record<UserId, string> = { rotem: 'רתם', noa: 'נועה' };

export function wordKey(userId: UserId, lemmaId: number): string {
  return `${userId}|${lemmaId}`;
}
export function dailyKey(userId: UserId, date: string): string {
  return `${userId}|${date}`;
}

async function queue(table: SyncTable, key: string): Promise<void> {
  const row: OutboxRow = { table, key, at: Date.now() };
  await db.outbox.add(row);
}

export async function getProfile(userId: UserId): Promise<UserProfile> {
  const existing = await db.users.get(userId);
  if (existing) {
    // Settings added in later versions get their defaults.
    return { ...existing, settings: { ...DEFAULT_SETTINGS, ...existing.settings } };
  }
  const now = Date.now();
  const p: UserProfile = {
    id: userId,
    name: USER_NAMES[userId],
    settings: { ...DEFAULT_SETTINGS },
    ability: null,
    badges: {},
    thetaHistory: [],
    createdAt: now,
    updatedAt: now,
    deviceId: await deviceId(),
  };
  await db.users.put(p);
  await queue('users', userId);
  return p;
}

export async function saveProfile(p: UserProfile): Promise<UserProfile> {
  const next = { ...p, updatedAt: Date.now(), deviceId: await deviceId() };
  await db.users.put(next);
  await queue('users', p.id);
  return next;
}

export async function getWords(userId: UserId): Promise<UserWord[]> {
  return db.userWords.where('userId').equals(userId).toArray();
}

export async function getWord(userId: UserId, lemmaId: number): Promise<UserWord | undefined> {
  return db.userWords.get([userId, lemmaId]);
}

export async function putWord(w: UserWord): Promise<void> {
  await db.userWords.put(w);
  await queue('userWords', wordKey(w.userId, w.lemmaId));
}

export async function getDaily(userId: UserId, date: string): Promise<DailyStats> {
  return (
    (await db.dailyStats.get([userId, date])) ?? {
      userId,
      date,
      xp: 0,
      newWords: 0,
      reviews: 0,
      correct: 0,
      ms: 0,
      sessions: 0,
      goal: DEFAULT_SETTINGS.dailyGoal,
      goalReached: false,
      updatedAt: 0,
      deviceId: '',
    }
  );
}

export interface DailyDelta {
  xp?: number;
  newWords?: number;
  reviews?: number;
  correct?: number;
  ms?: number;
  sessions?: number;
  bonusNew?: number;
}

export async function bumpDaily(
  userId: UserId,
  date: string,
  delta: DailyDelta,
  goal: number,
): Promise<{ before: DailyStats; after: DailyStats }> {
  const before = await getDaily(userId, date);
  const after: DailyStats = {
    ...before,
    xp: before.xp + (delta.xp ?? 0),
    newWords: before.newWords + (delta.newWords ?? 0),
    reviews: before.reviews + (delta.reviews ?? 0),
    correct: before.correct + (delta.correct ?? 0),
    ms: before.ms + (delta.ms ?? 0),
    sessions: before.sessions + (delta.sessions ?? 0),
    ...(delta.bonusNew || before.bonusNew
      ? { bonusNew: (before.bonusNew ?? 0) + (delta.bonusNew ?? 0) }
      : {}),
    goal,
    updatedAt: Date.now(),
    deviceId: await deviceId(),
  };
  after.goalReached = before.goalReached || after.xp >= goal;
  await db.dailyStats.put(after);
  await queue('dailyStats', dailyKey(userId, date));
  return { before, after };
}

export async function allDaily(userId: UserId): Promise<DailyStats[]> {
  return db.dailyStats.where('userId').equals(userId).toArray();
}

export interface AnswerWrite {
  word: UserWord;
  review: ReviewRecord;
  profile: UserProfile;
}

/** One graded answer, atomically: word row, review log row, profile (ability). */
export async function recordAnswer(w: AnswerWrite): Promise<void> {
  await db.transaction('rw', [db.userWords, db.reviews, db.users, db.outbox], async () => {
    await db.userWords.put(w.word);
    await db.reviews.put(w.review);
    await db.users.put(w.profile);
    await queue('userWords', wordKey(w.word.userId, w.word.lemmaId));
    await queue('reviews', w.review.id);
    await queue('users', w.profile.id);
  });
}

/** A logged answer that does not schedule anything (daily duel). */
export async function recordReviewOnly(review: ReviewRecord, profile: UserProfile): Promise<void> {
  await db.transaction('rw', [db.reviews, db.users, db.outbox], async () => {
    await db.reviews.put(review);
    await db.users.put(profile);
    await queue('reviews', review.id);
    await queue('users', profile.id);
  });
}

export async function reviewsFor(userId: UserId, since = 0): Promise<ReviewRecord[]> {
  return db.reviews
    .where('[userId+at]')
    .between([userId, since], [userId, Number.MAX_SAFE_INTEGER])
    .toArray();
}

export async function addEvent(e: Omit<AppEvent, 'id' | 'at' | 'deviceId'>): Promise<AppEvent> {
  const ev: AppEvent = {
    ...e,
    id: crypto.randomUUID(),
    at: Date.now(),
    deviceId: await deviceId(),
  };
  await db.events.put(ev);
  await queue('events', ev.id);
  return ev;
}

export async function setPresence(userId: UserId, inSession: boolean): Promise<void> {
  const p: Presence = {
    userId,
    lastSeenAt: Date.now(),
    inSession,
    updatedAt: Date.now(),
    deviceId: await deviceId(),
  };
  await db.presence.put(p);
  await queue('presence', userId);
}

// ---------------------------------------------------------------------------
// Export / import (spec 7.1 settings, 9.3). Import merges, never deletes.
// ---------------------------------------------------------------------------

export interface ExportFile {
  app: 'lexbites';
  format: 1;
  exportedAt: string;
  users: UserProfile[];
  userWords: UserWord[];
  reviews: ReviewRecord[];
  dailyStats: DailyStats[];
  events: AppEvent[];
}

export async function exportAll(): Promise<ExportFile> {
  const [users, userWords, reviews, dailyStats, events] = await Promise.all([
    db.users.toArray(),
    db.userWords.toArray(),
    db.reviews.toArray(),
    db.dailyStats.toArray(),
    db.events.toArray(),
  ]);
  return {
    app: 'lexbites',
    format: 1,
    exportedAt: new Date().toISOString(),
    users,
    userWords,
    reviews,
    dailyStats,
    events: events.map(({ seen: _seen, ...e }) => e),
  };
}

export function isExportFile(x: unknown): x is ExportFile {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.app === 'lexbites' &&
    o.format === 1 &&
    Array.isArray(o.users) &&
    Array.isArray(o.userWords) &&
    Array.isArray(o.reviews) &&
    Array.isArray(o.dailyStats) &&
    Array.isArray(o.events)
  );
}

/** Last-write-wins merge for row tables, union for append-only tables. */
export async function importAll(
  file: ExportFile,
): Promise<{ words: number; reviews: number; days: number; events: number }> {
  const counts = { words: 0, reviews: 0, days: 0, events: 0 };
  await db.transaction(
    'rw',
    [db.users, db.userWords, db.reviews, db.dailyStats, db.events, db.outbox],
    async () => {
      for (const u of file.users) {
        const cur = await db.users.get(u.id);
        if (!cur || cur.updatedAt < u.updatedAt) await db.users.put(u);
      }
      for (const w of file.userWords) {
        const cur = await db.userWords.get([w.userId, w.lemmaId]);
        if (!cur || cur.updatedAt < w.updatedAt) {
          await db.userWords.put(w);
          counts.words++;
        }
      }
      const existing = new Set(await db.reviews.toCollection().primaryKeys());
      const newReviews = file.reviews.filter((r) => !existing.has(r.id));
      await db.reviews.bulkPut(newReviews);
      counts.reviews = newReviews.length;
      for (const d of file.dailyStats) {
        const cur = await db.dailyStats.get([d.userId, d.date]);
        if (!cur || cur.updatedAt < d.updatedAt) {
          await db.dailyStats.put(d);
          counts.days++;
        }
      }
      const evKeys = new Set(await db.events.toCollection().primaryKeys());
      const newEvents = file.events.filter((e) => !evKeys.has(e.id));
      await db.events.bulkPut(newEvents.map((e) => ({ ...e, seen: 1 as const })));
      counts.events = newEvents.length;
    },
  );
  return counts;
}

/** Download a JSON backup through a temporary link (works in iOS standalone via share sheet). */
export async function downloadBackup(): Promise<void> {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const name = `lexbites-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: name });
      await db.kv.put({ key: 'lastExportAt', value: Date.now() });
      return;
    } catch {
      // fall through to a plain download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await db.kv.put({ key: 'lastExportAt', value: Date.now() });
}

/** Reset one profile's learning data (after an automatic backup). Never touches the other user. */
export async function resetUser(userId: UserId): Promise<void> {
  await db.transaction('rw', [db.userWords, db.reviews, db.dailyStats, db.users], async () => {
    await db.userWords.where('userId').equals(userId).delete();
    await db.reviews.where('userId').equals(userId).delete();
    await db.dailyStats.where('userId').equals(userId).delete();
    await db.users.delete(userId);
  });
}

export async function pendingOutbox(): Promise<number> {
  return db.outbox.count();
}
