/**
 * Live session state machine. Progress is saved per item (spec 4.6.6): every answer is written
 * to IndexedDB before the UI moves on, and the plan position is persisted for resume.
 */
import { prefetchSentences } from '@/audio/recordings';
import { create } from 'zustand';
import { applyAnswer, introduceWord } from '@/engine/learn';
import { createRng } from '@/engine/rng';
import type { PlanItem, SessionMode } from '@/engine/session';
import { speedProfile, type SpeedProfile } from '@/engine/srs';
import type { AnswerBehavior, ReviewRecord, UserWord } from '@/engine/types';
import { XP_BY_TYPE } from '@/engine/game';
import { matchTimeBonus } from '@/engine/exercises';
import { db, deviceId, getKv, setKv } from '@/data/db';
import {
  addEvent,
  bumpDaily,
  putWord,
  recordAnswer,
  recordReviewOnly,
  saveProfile,
  setPresence,
} from '@/data/repo';
import { todayKey, useApp } from '@/state/app';
import { buildSession, type BuiltSession } from './build';
import { buildExercise, type Exercise } from './exercise';
import { afterSession } from '@/gamification/awards';

export interface SessionSummary {
  mode: SessionMode;
  xp: number;
  graded: number;
  correct: number;
  newLearned: number[];
  introduced: number[];
  strengthened: number[];
  missed: number[];
  comboMax: number;
  ms: number;
  perfect: boolean;
  thetaBefore: number;
  thetaAfter: number;
  goalReachedNow: boolean;
  badges: string[];
  speedScore?: number;
  duel?: { correct: number; ms: number };
}

export interface Feedback {
  correct: boolean;
  near: boolean;
  xp: number;
  /** Answer the user gave (typing), for the highlighted diff. */
  typed?: string;
  expected?: string;
  learnedNow: boolean;
}

interface SessionState {
  status: 'idle' | 'building' | 'running' | 'done' | 'empty';
  built: BuiltSession | null;
  index: number;
  exercise: Exercise | null;
  /** Feedback for the current item once answered (null while unanswered). */
  feedback: Feedback | null;
  combo: number;
  summary: SessionSummary | null;
  startedAt: number;
  /** Speed round: wall-clock end time. */
  deadline: number | null;
  /** Lemmas whose remaining items were dropped (verified "I already know this"). */
  dropped: Set<number>;
  start: (mode: SessionMode, opts?: { lemmaIds?: number[]; seed?: number }) => Promise<void>;
  resume: () => Promise<boolean>;
  acknowledgeIntro: () => Promise<void>;
  answer: (
    b: AnswerBehavior,
    extra?: { typed?: string; expected?: string; near?: boolean },
  ) => Promise<Feedback>;
  answerMatch: (
    results: { lemmaId: number; correct: boolean; ms: number }[],
    totalMs: number,
  ) => Promise<void>;
  verifyKnown: (correct: boolean, ms: number) => Promise<boolean>;
  next: () => void;
  finish: () => Promise<void>;
  abandon: () => Promise<void>;
}

const acc = {
  xp: 0,
  graded: 0,
  correct: 0,
  newLearned: [] as number[],
  introduced: [] as number[],
  strengthened: new Set<number>(),
  missed: new Set<number>(),
  comboMax: 0,
  thetaBefore: 0,
  goalReachedNow: false,
  ms: 0,
};
let profileCache: SpeedProfile = {};

function resetAcc(theta: number) {
  acc.xp = 0;
  acc.graded = 0;
  acc.correct = 0;
  acc.newLearned = [];
  acc.introduced = [];
  acc.strengthened = new Set();
  acc.missed = new Set();
  acc.comboMax = 0;
  acc.thetaBefore = theta;
  acc.goalReachedNow = false;
  acc.ms = 0;
}

const SPEED_ROUND_MS = 60_000;

function persistKey() {
  return `session:${useApp.getState().userId ?? 'none'}`;
}

async function persist(state: { built: BuiltSession | null; index: number; startedAt: number }) {
  if (!state.built) return;
  await setKv(persistKey(), {
    mode: state.built.mode,
    seed: state.built.seed,
    plan: state.built.plan,
    index: state.index,
    startedAt: state.startedAt,
  });
}

function crownsOf(lemmaId: number): number {
  return useApp.getState().words.get(lemmaId)?.crowns ?? 0;
}

function exerciseAt(
  built: BuiltSession,
  index: number,
  dropped: Set<number>,
): { index: number; exercise: Exercise | null } {
  const rng = createRng(built.seed + index * 7919);
  for (let i = index; i < built.plan.length; i++) {
    const item = built.plan[i]!;
    if (dropped.has(item.lemmaId) && item.role !== 'intro') continue;
    const ex = buildExercise(item, {
      contents: built.contents,
      infos: built.infos,
      pool: built.pool,
      rng,
      crowns: crownsOf,
    });
    if (ex) return { index: i, exercise: ex };
  }
  return { index: built.plan.length, exercise: null };
}

async function loadSpeedProfile(userId: string) {
  const recent = await db.reviews.where('userId').equals(userId).reverse().limit(1500).toArray();
  profileCache = speedProfile(
    recent
      .reverse()
      .map((r) => ({ type: r.exerciseType, responseMs: r.responseMs, correct: r.correct })),
  );
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'idle',
  built: null,
  index: 0,
  exercise: null,
  feedback: null,
  combo: 0,
  summary: null,
  startedAt: 0,
  deadline: null,
  dropped: new Set(),

  start: async (mode, opts = {}) => {
    const app = useApp.getState();
    if (!app.profile || !app.today || !app.userId) return;
    set({ status: 'building', summary: null, feedback: null, combo: 0, dropped: new Set() });
    await loadSpeedProfile(app.userId);
    const built = await buildSession({
      mode,
      profile: app.profile,
      words: app.words,
      today: app.today,
      ...(opts.lemmaIds ? { lemmaIds: opts.lemmaIds } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });
    resetAcc(app.profile.ability?.theta ?? 40);
    if (!built.plan.length) {
      set({ status: 'empty', built });
      return;
    }
    const first = exerciseAt(built, 0, new Set());
    const startedAt = Date.now();
    set({
      status: 'running',
      built,
      index: first.index,
      exercise: first.exercise,
      startedAt,
      deadline: mode === 'speed' ? startedAt + SPEED_ROUND_MS : null,
    });
    void setPresence(app.userId, true);
    // The sentence recordings of this session, so it keeps its audio if the network drops.
    void prefetchSentences(
      [...built.contents.values()].flatMap((c) => c.sentences.map((x) => x.en)),
    );
    await persist({ built, index: first.index, startedAt });
  },

  resume: async () => {
    const app = useApp.getState();
    if (!app.profile || !app.today || !app.userId) return false;
    const saved = await getKv<{
      mode: SessionMode;
      seed: number;
      plan: PlanItem[];
      index: number;
      startedAt: number;
    } | null>(persistKey(), null);
    if (!saved || Date.now() - saved.startedAt > 12 * 3600_000 || saved.index >= saved.plan.length)
      return false;
    set({ status: 'building' });
    await loadSpeedProfile(app.userId);
    const { getContents, distractorPool, loadInventory } = await import('@/content/inventory');
    const { toOptionWord } = await import('./exercise');
    const inv = await loadInventory();
    const ids = [...new Set(saved.plan.flatMap((p) => p.matchIds ?? [p.lemmaId]))];
    const contents = await getContents(ids);
    const infos = new Map(
      ids.map((id) => [id, inv.byId.get(id)!]).filter(([, l]) => !!l) as [
        number,
        (typeof inv.lemmas)[number],
      ][],
    );
    const pool = [...(await distractorPool(ids)), ...contents.values()].map((c) =>
      toOptionWord(c, inv.byId.get(c.lemmaId)),
    );
    const built: BuiltSession = {
      mode: saved.mode,
      plan: saved.plan,
      contents,
      infos,
      pool,
      seed: saved.seed,
    };
    resetAcc(app.profile.ability?.theta ?? 40);
    const at = exerciseAt(built, saved.index, new Set());
    if (!at.exercise) {
      await setKv(persistKey(), null);
      set({ status: 'idle' });
      return false;
    }
    set({
      status: 'running',
      built,
      index: at.index,
      exercise: at.exercise,
      startedAt: Date.now(),
      deadline: null,
      feedback: null,
      combo: 0,
      dropped: new Set(),
    });
    return true;
  },

  acknowledgeIntro: async () => {
    const { exercise } = get();
    const app = useApp.getState();
    if (!exercise || exercise.kind !== 'intro' || !app.userId || !app.profile) return;
    const id = exercise.item.lemmaId;
    if (!app.words.has(id)) {
      const w = introduceWord(app.userId, id, Date.now(), await deviceId());
      await putWord(w);
      app.setWord(w);
      const { after } = await bumpDaily(
        app.userId,
        todayKey(),
        { newWords: 1 },
        app.profile.settings.dailyGoal,
      );
      app.setToday(after);
      acc.introduced.push(id);
    }
    get().next();
  },

  verifyKnown: async (correct, ms) => {
    const { exercise, built } = get();
    const app = useApp.getState();
    if (!exercise || !built || !app.userId || !app.profile?.ability) return false;
    const id = exercise.item.lemmaId;
    const info = built.infos.get(id);
    const out = applyAnswer({
      userId: app.userId,
      lemmaId: id,
      d: info?.d ?? 50,
      word: app.words.get(id),
      role: 'verify',
      behavior: { type: 'en_he', correct, hinted: false, nearMiss: false, responseMs: ms },
      ability: app.profile.ability,
      combo: get().combo,
      now: Date.now(),
      dayKey: todayKey(),
      deviceId: await deviceId(),
      reviewId: crypto.randomUUID(),
    });
    const profile = { ...app.profile, ability: out.ability, updatedAt: Date.now() };
    if (correct) {
      await recordAnswer({ word: out.word, review: out.review, profile });
      app.setWord(out.word);
      app.setProfile(profile);
      const dropped = new Set(get().dropped);
      dropped.add(id);
      set({ dropped });
      get().next();
      return true;
    }
    // Failed: no penalty, continue as a normal new word.
    await get().acknowledgeIntro();
    return false;
  },

  answer: async (b, extra = {}) => {
    const { exercise, built, combo } = get();
    const app = useApp.getState();
    if (!exercise || !built || !app.userId || !app.profile) {
      return { correct: false, near: false, xp: 0, learnedNow: false };
    }
    const id = exercise.item.lemmaId;
    const info = built.infos.get(id);
    const ability = app.profile.ability ?? {
      theta: 40,
      sigma: 20,
      answers: 0,
      assumedKnownBelow: 20,
    };
    const role = exercise.item.role === 'intro' ? 'recognition' : exercise.item.role;
    const out = applyAnswer({
      userId: app.userId,
      lemmaId: id,
      d: info?.d ?? 50,
      word: app.words.get(id),
      role,
      behavior: b,
      ability,
      combo,
      profile: profileCache,
      retention: app.profile.settings.retention,
      ...(app.profile.fsrsW ? { fsrsW: app.profile.fsrsW } : {}),
      now: Date.now(),
      dayKey: todayKey(),
      deviceId: await deviceId(),
      reviewId: crypto.randomUUID(),
    });
    let xp = out.xp;
    if (built.mode === 'speed') xp = Math.round(xp * 1.5);
    if (built.mode === 'duel') xp = b.correct ? XP_BY_TYPE.speed : 0;
    const review: ReviewRecord =
      built.mode === 'duel' ? { ...out.review, purpose: 'duel' } : out.review;
    const profile = { ...app.profile, ability: out.ability, updatedAt: Date.now() };
    const word: UserWord = out.word;
    if (built.mode === 'duel') {
      // Duels never touch the learning queue: log the answer and the ability only.
      await recordReviewOnly(review, profile);
    } else {
      await recordAnswer({ word, review, profile });
      app.setWord(word);
    }
    app.setProfile(profile);
    const { before, after } = await bumpDaily(
      app.userId,
      todayKey(),
      { xp, reviews: 1, correct: b.correct ? 1 : 0, ms: b.responseMs },
      app.profile.settings.dailyGoal,
    );
    app.setToday(after);
    if (!before.goalReached && after.goalReached) acc.goalReachedNow = true;

    acc.xp += xp;
    acc.graded++;
    acc.ms += b.responseMs;
    if (b.correct) {
      acc.correct++;
      if (exercise.item.role === 'review' || exercise.item.role === 'speed')
        acc.strengthened.add(id);
    } else acc.missed.add(id);
    if (out.learnedNow) acc.newLearned.push(id);
    acc.comboMax = Math.max(acc.comboMax, out.combo);
    const fb: Feedback = {
      correct: b.correct,
      near: !!extra.near,
      xp,
      ...(extra.typed !== undefined ? { typed: extra.typed } : {}),
      ...(extra.expected !== undefined ? { expected: extra.expected } : {}),
      learnedNow: out.learnedNow,
    };
    set({ combo: out.combo, feedback: fb });
    return fb;
  },

  answerMatch: async (results, totalMs) => {
    const { built, exercise } = get();
    const app = useApp.getState();
    if (!built || !exercise || !app.userId || !app.profile) return;
    let combo = get().combo;
    let ability = app.profile.ability ?? {
      theta: 40,
      sigma: 20,
      answers: 0,
      assumedKnownBelow: 20,
    };
    let xp = 0;
    let correct = 0;
    const dev = await deviceId();
    for (const r of results) {
      const out = applyAnswer({
        userId: app.userId,
        lemmaId: r.lemmaId,
        d: built.infos.get(r.lemmaId)?.d ?? 50,
        word: useApp.getState().words.get(r.lemmaId),
        role: 'review',
        behavior: {
          type: 'match',
          correct: r.correct,
          hinted: false,
          nearMiss: false,
          responseMs: r.ms,
        },
        ability,
        combo,
        profile: profileCache,
        retention: app.profile.settings.retention,
        now: Date.now(),
        dayKey: todayKey(),
        deviceId: dev,
        reviewId: crypto.randomUUID(),
      });
      ability = out.ability;
      combo = out.combo;
      xp += out.xp;
      if (r.correct) {
        correct++;
        acc.strengthened.add(r.lemmaId);
      } else acc.missed.add(r.lemmaId);
      await recordAnswer({
        word: out.word,
        review: out.review,
        profile: { ...app.profile, ability },
      });
      useApp.getState().setWord(out.word);
    }
    xp += matchTimeBonus(totalMs);
    const profile = { ...app.profile, ability, updatedAt: Date.now() };
    await saveProfile(profile);
    app.setProfile(profile);
    const { before, after } = await bumpDaily(
      app.userId,
      todayKey(),
      { xp, reviews: results.length, correct, ms: totalMs },
      app.profile.settings.dailyGoal,
    );
    app.setToday(after);
    if (!before.goalReached && after.goalReached) acc.goalReachedNow = true;
    acc.xp += xp;
    acc.graded += results.length;
    acc.correct += correct;
    acc.ms += totalMs;
    acc.comboMax = Math.max(acc.comboMax, combo);
    set({
      combo,
      feedback: { correct: correct === results.length, near: false, xp, learnedNow: false },
    });
    if (totalMs <= 10_000 && correct === results.length) {
      await addEvent({ userId: app.userId, type: 'session', payload: { matchUnder10s: true } });
    }
  },

  next: () => {
    const { built, index, dropped, deadline } = get();
    if (!built) return;
    if (deadline && Date.now() >= deadline) {
      void get().finish();
      return;
    }
    const nextAt = exerciseAt(built, index + 1, dropped);
    if (!nextAt.exercise) {
      void get().finish();
      return;
    }
    set({ index: nextAt.index, exercise: nextAt.exercise, feedback: null });
    void persist({ built, index: nextAt.index, startedAt: get().startedAt });
  },

  finish: async () => {
    const { built, startedAt } = get();
    const app = useApp.getState();
    if (!built || !app.userId || !app.profile) return;
    await setKv(persistKey(), null);
    const ms = Date.now() - startedAt;
    const thetaAfter = app.profile.ability?.theta ?? acc.thetaBefore;
    const perfect = acc.graded >= 8 && acc.correct === acc.graded;
    let profile = app.profile;
    if (app.profile.ability) {
      profile = await saveProfile({
        ...app.profile,
        thetaHistory: [
          ...app.profile.thetaHistory,
          [Date.now(), Math.round(thetaAfter * 100) / 100] as [number, number],
        ].slice(-2000),
      });
      app.setProfile(profile);
    }
    const { after } = await bumpDaily(
      app.userId,
      todayKey(),
      { sessions: 1 },
      app.profile.settings.dailyGoal,
    );
    app.setToday(after);
    await addEvent({
      userId: app.userId,
      type: 'session',
      payload: {
        mode: built.mode,
        xp: acc.xp,
        graded: acc.graded,
        correct: acc.correct,
        perfect,
        comboMax: acc.comboMax,
        ms,
        ...(built.mode === 'speed' ? { speedScore: acc.correct } : {}),
      },
    });
    if (built.mode === 'duel') {
      await addEvent({
        userId: app.userId,
        type: 'duel',
        payload: { date: todayKey(), correct: acc.correct, ms: acc.ms },
      });
    }
    void setPresence(app.userId, false);
    const badges = await afterSession(app.userId);
    const summary: SessionSummary = {
      mode: built.mode,
      xp: acc.xp,
      graded: acc.graded,
      correct: acc.correct,
      newLearned: acc.newLearned,
      introduced: acc.introduced,
      strengthened: [...acc.strengthened],
      missed: [...acc.missed],
      comboMax: acc.comboMax,
      ms,
      perfect,
      thetaBefore: acc.thetaBefore,
      thetaAfter,
      goalReachedNow: acc.goalReachedNow,
      badges,
      ...(built.mode === 'speed' ? { speedScore: acc.correct } : {}),
      ...(built.mode === 'duel' ? { duel: { correct: acc.correct, ms: acc.ms } } : {}),
    };
    set({ status: 'done', summary, exercise: null, feedback: null, deadline: null });
  },

  abandon: async () => {
    const { built, status } = get();
    const app = useApp.getState();
    if (app.userId) void setPresence(app.userId, false);
    // Answers are already saved. Keep the plan for resume unless nothing was answered.
    if (built && status === 'running' && acc.graded === 0 && acc.introduced.length === 0) {
      await setKv(persistKey(), null);
    }
    set({
      status: 'idle',
      built: null,
      exercise: null,
      feedback: null,
      summary: null,
      deadline: null,
    });
  },
}));
