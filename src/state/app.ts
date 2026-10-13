/**
 * App state: the active profile, its words and today's stats, kept in memory for instant reads.
 * Writes go through the repository (IndexedDB + outbox) and then update this store.
 */
import { create } from 'zustand';
import { dayKey } from '@/engine/rng';
import type { UserId, UserWord } from '@/engine/types';
import { USER_IDS } from '@/engine/types';
import { db, getKv, setKv, type DailyStats, type UserProfile, type UserSettings } from '@/data/db';
import { getDaily, getProfile, getWords, saveProfile } from '@/data/repo';
import { runMigrations } from '@/data/migrations';
import { useTheme } from './theme';

export function todayKey(now = Date.now()): string {
  return dayKey(now, new Date(now).getTimezoneOffset());
}

interface AppState {
  ready: boolean;
  userId: UserId | null;
  /** PIN gate passed for this page life. */
  unlocked: boolean;
  profile: UserProfile | null;
  words: Map<number, UserWord>;
  today: DailyStats | null;
  /** Bumps whenever data changes, so screens can re-derive. */
  version: number;
  init: () => Promise<void>;
  selectUser: (id: UserId | null) => Promise<void>;
  unlock: () => void;
  reload: () => Promise<void>;
  setProfile: (p: UserProfile) => void;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  setWord: (w: UserWord) => void;
  setToday: (d: DailyStats) => void;
}

function rememberedUser(): UserId | null {
  try {
    const u = localStorage.getItem('lexbites.user');
    return u === 'rotem' || u === 'noa' ? u : null;
  } catch {
    return null;
  }
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  userId: null,
  unlocked: false,
  profile: null,
  words: new Map(),
  today: null,
  version: 0,

  init: async () => {
    // One-time data migrations first, so the profile below is read after them.
    await runMigrations().catch((e: unknown) => console.warn('migration failed', e));
    const stored = (await getKv<UserId | null>('currentUser', null)) ?? rememberedUser();
    const userId = stored && USER_IDS.includes(stored) ? stored : null;
    if (userId) {
      await get().selectUser(userId);
      const p = get().profile;
      set({ unlocked: !p?.pinHash });
    }
    set({ ready: true });
  },

  selectUser: async (id) => {
    useTheme.getState().applyUser(id);
    await setKv('currentUser', id);
    if (!id) {
      set({ userId: null, profile: null, words: new Map(), today: null, unlocked: false });
      return;
    }
    const [profile, words, today] = await Promise.all([
      getProfile(id),
      getWords(id),
      getDaily(id, todayKey()),
    ]);
    document.documentElement.dataset.text = profile.settings.largeText ? 'large' : '';
    set((s) => ({
      userId: id,
      profile,
      words: new Map(words.map((w) => [w.lemmaId, w])),
      today,
      unlocked: s.userId === id ? s.unlocked : !profile.pinHash,
      version: s.version + 1,
    }));
  },

  unlock: () => set({ unlocked: true }),

  reload: async () => {
    const id = get().userId;
    if (!id) return;
    const [profile, words, today] = await Promise.all([
      db.users.get(id).then((p) => p ?? getProfile(id)),
      getWords(id),
      getDaily(id, todayKey()),
    ]);
    set((s) => ({
      profile: { ...profile, settings: { ...s.profile?.settings, ...profile.settings } },
      words: new Map(words.map((w) => [w.lemmaId, w])),
      today,
      version: s.version + 1,
    }));
  },

  setProfile: (p) => set((s) => ({ profile: p, version: s.version + 1 })),

  updateSettings: async (patch) => {
    const p = get().profile;
    if (!p) return;
    const next = await saveProfile({ ...p, settings: { ...p.settings, ...patch } });
    if (patch.largeText !== undefined)
      document.documentElement.dataset.text = patch.largeText ? 'large' : '';
    set((s) => ({ profile: next, version: s.version + 1 }));
  },

  setWord: (w) =>
    set((s) => {
      const words = new Map(s.words);
      words.set(w.lemmaId, w);
      return { words, version: s.version + 1 };
    }),

  setToday: (d) => set((s) => ({ today: d, version: s.version + 1 })),
}));

/** SHA-256 of the PIN with a per-profile salt (a convenience lock, not security). */
export async function hashPin(userId: UserId, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`lexbites:${userId}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
