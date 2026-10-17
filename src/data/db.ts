/**
 * Local persistence (spec 9.2). IndexedDB via Dexie. All reads are local; sync is additive.
 * Schema changes add a new `version()` with an upgrade function: never drop user data.
 */
import Dexie, { type Table } from 'dexie';
import type { Ability, ReviewRecord, UserId, UserWord, WordContent } from '@/engine/types';
import { DEFAULT_DAILY_GOAL } from '@/engine/game';
import type { Gloss } from '@/content/enrich';

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
  dailyGoal: DEFAULT_DAILY_GOAL,
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
  /**
   * One-time data migrations already applied to this profile: id -> timestamp. Synced with the
   * row, so a phone with a stale copy never applies one again (src/data/migrations.ts).
   */
  migrations?: Record<string, number>;
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

/** A saved English text (טקסטים). Local to the phone; part of export/import. */
export interface StoredText {
  id: string;
  userId: UserId;
  title: string;
  body: string;
  url?: string;
  /** Lemma ids marked for study (auto-marked above the level, then edited by hand). */
  marked: number[];
  createdAt: number;
  updatedAt: number;
  openedAt?: number;
  practicedAt?: number;
  /** Last comprehension check: correct out of total. */
  check?: { correct: number; total: number; at: number };
  /** Natural audio for the text (0.10.0, src/audio/textAudio.ts). */
  audio?: {
    /** Render job in lb_tts_jobs ('' when everything already had a recording). */
    job: string;
    at: number;
    /** "v:k" of every clip the text needs, in reading order. */
    keys: string[];
    /** Started right away by the Edge Function (else by the five-minute schedule). */
    dispatch?: boolean;
    /** Every clip is on the phone, or the job ended; `failed` were not rendered. */
    readyAt?: number;
    failed?: number;
  };
}

/** Cached machine translation of one English string (Read mode, texts). */
export interface CachedTranslation {
  en: string;
  he: string;
  at: number;
}

/** Cached word lookup for words without authored content (src/content/enrich.ts, Gloss). */
export interface CachedGloss {
  lemma: string;
  gloss: Gloss;
  at: number;
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
  texts!: Table<StoredText, string>;
  translations!: Table<CachedTranslation, string>;
  glossCache!: Table<CachedGloss, string>;

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
    // 0.9.0: texts and lookup caches. New tables only, nothing to migrate.
    this.version(2).stores({
      texts: 'id, userId, updatedAt',
      translations: 'en',
      glossCache: 'lemma',
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
