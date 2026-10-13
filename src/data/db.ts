/**
 * Local persistence (spec 9.2). IndexedDB via Dexie. All reads are local; sync is additive.
 * Schema changes add a new `version()` with an upgrade function: never drop user data.
 */
import Dexie, { type Table } from 'dexie';
import type { Ability, ReviewRecord, UserId, UserWord, WordContent } from '@/engine/types';

export type Accent = 'us' | 'uk';

export interface UserSettings {
  dailyGoal: number;
  newPerDay: number;
  accent: Accent;
  voiceURI?: string;
  speechRate: number;
  sounds: boolean;
  retention: number;
  topics: string[];
  disabledKinds: string[];
  autoplay: boolean;
  reminderTime?: string;
  largeText: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  dailyGoal: 60,
  newPerDay: 8,
  accent: 'us',
  speechRate: 0.95,
  sounds: false,
  retention: 0.9,
  topics: [],
  disabledKinds: [],
  autoplay: true,
  largeText: false,
};

export interface UserProfile {
  id: UserId;
  name: string;
  pinHash?: string;
  settings: UserSettings;
  ability: Ability | null;
  /** Personalized FSRS weights from the on-device optimizer. */
  fsrsW?: number[];
  fsrsOptimizedAt?: number;
  /** Badge id -> earned timestamp. */
  badges: Record<string, number>;
  /** Ability history for the stats chart: [timestamp, theta]. */
  thetaHistory: [number, number][];
  createdAt: number;
  updatedAt: number;
  deviceId: string;
}

export interface DailyStats {
  userId: UserId;
  date: string;
  xp: number;
  newWords: number;
  reviews: number;
  correct: number;
  ms: number;
  sessions: number;
  /** New words added to today's cap with the one-tap option (today only; absent = 0). */
  bonusNew?: number;
  goal: number;
  goalReached: boolean;
  updatedAt: number;
  deviceId: string;
}

export type EventType = 'nudge' | 'badge' | 'duel' | 'report' | 'session' | 'placement' | 'levelup';

export interface AppEvent {
  id: string;
  userId: UserId;
  type: EventType;
  /** For nudges: who receives it. */
  to?: UserId;
  payload: Record<string, unknown>;
  at: number;
  deviceId: string;
  /** Local-only: whether this device has shown it (nudge toasts). */
  seen?: 0 | 1;
}

export interface Presence {
  userId: UserId;
  lastSeenAt: number;
  inSession: boolean;
  updatedAt: number;
  deviceId: string;
}

export interface CachedContent extends WordContent {
  fetchedAt: number;
  /** Enrichment failed: retry after this time. */
  failedUntil?: number;
}

export type SyncTable = 'users' | 'userWords' | 'reviews' | 'dailyStats' | 'events' | 'presence';

export interface OutboxRow {
  seq?: number;
  table: SyncTable;
  key: string;
  at: number;
}

export interface KV {
  key: string;
  value: unknown;
}

export class LexDb extends Dexie {
  users!: Table<UserProfile, UserId>;
  userWords!: Table<UserWord, [UserId, number]>;
  reviews!: Table<ReviewRecord, string>;
  dailyStats!: Table<DailyStats, [UserId, string]>;
  events!: Table<AppEvent, string>;
  presence!: Table<Presence, UserId>;
  contentCache!: Table<CachedContent, number>;
  outbox!: Table<OutboxRow, number>;
  kv!: Table<KV, string>;

  constructor(name = 'lexbites') {
    super(name);
    this.version(1).stores({
      users: 'id',
      userWords: '[userId+lemmaId], userId, [userId+state], [userId+nextDueAt], updatedAt',
      reviews: 'id, userId, [userId+at], [userId+lemmaId], at',
      dailyStats: '[userId+date], userId, date, updatedAt',
      events: 'id, userId, type, to, at',
      presence: 'userId',
      contentCache: 'lemmaId',
      outbox: '++seq, table, key',
      kv: 'key',
    });
  }
}

export const db = new LexDb();

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

let cachedDeviceId: string | null = null;

/** Stable random id for this device (conflict resolution and sync provenance). */
export async function deviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await getKv<string | null>('deviceId', null);
  if (!id) {
    id = crypto.randomUUID();
    await setKv('deviceId', id);
  }
  cachedDeviceId = id;
  return id;
}
