/**
 * Applying one answer: the single pure transition used by sessions, probes and shortcuts.
 * (word, behavior) -> (word', review log row, ability', xp)
 */
import { updateAbility } from './ability';
import { xpForAnswer, XP_NEW_WORD_LEARNED, XP_PROBE_PASSED } from './game';
import type { ItemRole } from './session';
import {
  crownsFor,
  deriveRating,
  isLeech,
  knownCard,
  newCard,
  review,
  scoreOf,
  speedRoundRating,
  type SpeedProfile,
} from './srs';
import type { Ability, AnswerBehavior, FsrsRating, ReviewRecord, UserId, UserWord } from './types';

export function introduceWord(
  userId: UserId,
  lemmaId: number,
  now: number,
  deviceId: string,
  origin: UserWord['origin'] = 'new',
): UserWord {
  const card = newCard(now);
  return {
    userId,
    lemmaId,
    state: 'learning',
    card,
    crowns: 0,
    lapses: 0,
    isLeech: false,
    favorite: false,
    origin,
    firstSeenAt: now,
    nextDueAt: card.due,
    updatedAt: now,
    deviceId,
  };
}

export interface AnswerInput {
  userId: UserId;
  lemmaId: number;
  d: number;
  /** Existing row, or undefined for probes on never-seen words. */
  word: UserWord | undefined;
  role: ItemRole | 'verify';
  behavior: AnswerBehavior;
  ability: Ability;
  /** Consecutive correct answers in this session before this one. */
  combo: number;
  profile?: SpeedProfile;
  retention?: number;
  fsrsW?: readonly number[];
  now: number;
  dayKey: string;
  deviceId: string;
  reviewId: string;
}

export interface AnswerOutcome {
  word: UserWord;
  review: ReviewRecord;
  ability: Ability;
  xp: number;
  combo: number;
  /** First successful production: the word now counts as learned. */
  learnedNow: boolean;
  /** Probe failed: the word moved into normal learning. */
  probeFailed: boolean;
}

export function applyAnswer(i: AnswerInput): AnswerOutcome {
  const { behavior: b, now } = i;
  const score = scoreOf(b);
  const correct = b.correct;
  const combo = correct ? i.combo + 1 : 0;
  const opts = { retention: i.retention, w: i.fsrsW };

  // Probe or "I already know this" verification.
  if (i.role === 'probe' || i.role === 'verify') {
    const kind = i.role === 'probe' ? 'probe' : 'known_shortcut';
    const ability = updateAbility(i.ability, { d: i.d, score, kind, dayKey: i.dayKey });
    let word: UserWord;
    if (correct) {
      const base =
        i.word ??
        introduceWord(
          i.userId,
          i.lemmaId,
          now,
          i.deviceId,
          i.role === 'probe' ? 'probe' : 'known_shortcut',
        );
      const card = knownCard(now, opts);
      word = {
        ...base,
        // A passed probe stays assumed known (no reviews); a verified shortcut enters SRS with a
        // long first interval so it is still checked eventually.
        state: i.role === 'probe' ? 'known' : 'review',
        origin: i.role === 'probe' ? 'probe' : 'known_shortcut',
        card,
        crowns: crownsFor(card),
        nextDueAt: card.due,
        lastReviewAt: now,
        learnedAt: base.learnedAt ?? now,
        updatedAt: now,
        deviceId: i.deviceId,
      };
    } else {
      const base =
        i.word ??
        introduceWord(i.userId, i.lemmaId, now, i.deviceId, i.role === 'probe' ? 'probe' : 'new');
      word = { ...base, updatedAt: now, deviceId: i.deviceId };
    }
    return {
      word,
      review: {
        id: i.reviewId,
        userId: i.userId,
        lemmaId: i.lemmaId,
        exerciseType: b.type,
        rating: correct ? 4 : 1,
        correct,
        score,
        responseMs: b.responseMs,
        firstExposure: false,
        purpose: i.role === 'probe' ? 'probe' : 'verify',
        d: i.d,
        at: now,
        deviceId: i.deviceId,
      },
      ability,
      xp: correct ? XP_PROBE_PASSED : 0,
      combo,
      learnedNow: false,
      probeFailed: i.role === 'probe' && !correct,
    };
  }

  const base = i.word ?? introduceWord(i.userId, i.lemmaId, now, i.deviceId);
  const firstExposure = i.role === 'recognition' || i.role === 'production';
  // Early review: a graded word answered before it was due (sessions filled after the daily cap).
  const early = !firstExposure && base.card.fsrsState !== 0 && base.card.due > now;
  const derived =
    i.role === 'speed' ? speedRoundRating(correct, b.responseMs) : deriveRating(b, i.profile);
  // FSRS already scales the stability gain by retrievability, so an early Good is honest. Easy
  // would add its bonus on top of a word that was not even due and overshoot: cap it at Good.
  const rating: FsrsRating = early && derived === 4 ? 3 : derived;
  const card = review(base.card, rating, now, opts);
  const learnedNow = i.role === 'production' && correct && !base.learnedAt;
  const crowns = crownsFor(card);
  const word: UserWord = {
    ...base,
    state: card.fsrsState === 2 ? 'review' : 'learning',
    card,
    crowns,
    lapses: card.lapses,
    isLeech: base.isLeech || isLeech(card.lapses),
    lastReviewAt: now,
    nextDueAt: card.due,
    ...(learnedNow ? { learnedAt: now } : {}),
    updatedAt: now,
    deviceId: i.deviceId,
  };
  const ability = updateAbility(i.ability, {
    d: i.d,
    score,
    kind: firstExposure ? 'first' : 'review',
    dayKey: i.dayKey,
  });
  const xp = xpForAnswer(b.type, score, combo) + (learnedNow ? XP_NEW_WORD_LEARNED : 0);
  return {
    word,
    review: {
      id: i.reviewId,
      userId: i.userId,
      lemmaId: i.lemmaId,
      exerciseType: b.type,
      rating,
      correct,
      score,
      responseMs: b.responseMs,
      firstExposure,
      purpose: i.role === 'speed' ? 'speed' : firstExposure ? 'learn' : 'review',
      ...(early ? { early: true } : {}),
      d: i.d,
      at: now,
      deviceId: i.deviceId,
    },
    ability,
    xp,
    combo,
    learnedNow,
    probeFailed: false,
  };
}

/** Ignore / unignore are reversible (spec 5.5). */
export function ignoreWord(w: UserWord, now: number, deviceId: string): UserWord {
  if (w.state === 'ignored') return w;
  return { ...w, prevState: w.state, state: 'ignored', updatedAt: now, deviceId };
}

export function unignoreWord(w: UserWord, now: number, deviceId: string): UserWord {
  if (w.state !== 'ignored') return w;
  const { prevState, ...rest } = w;
  return { ...rest, state: prevState ?? 'learning', updatedAt: now, deviceId };
}

/**
 * Rebuild a word row from its review log (spec 9.3 "rebuild from log"). Replays ratings in order.
 * Probe and verify rows reproduce the known/long-interval outcomes.
 */
export function rebuildWord(
  userId: UserId,
  lemmaId: number,
  log: readonly ReviewRecord[],
  deviceId: string,
  keep?: Pick<UserWord, 'favorite' | 'note' | 'state' | 'prevState'>,
  opts: { retention?: number; w?: readonly number[] } = {},
): UserWord | null {
  const rows = log.filter((r) => r.lemmaId === lemmaId).sort((a, b) => a.at - b.at);
  if (!rows.length) return null;
  let w = introduceWord(userId, lemmaId, rows[0]!.at, deviceId);
  for (const r of rows) {
    if (r.purpose === 'probe' || r.purpose === 'verify') {
      if (r.correct) {
        const card = knownCard(r.at, opts);
        w = {
          ...w,
          state: r.purpose === 'probe' ? 'known' : 'review',
          origin: r.purpose === 'probe' ? 'probe' : 'known_shortcut',
          card,
          crowns: crownsFor(card),
          nextDueAt: card.due,
          lastReviewAt: r.at,
          learnedAt: w.learnedAt ?? r.at,
        };
      } else if (r.purpose === 'probe') {
        w = { ...w, origin: 'probe' };
      }
      continue;
    }
    const card = review(w.card, r.rating, r.at, opts);
    w = {
      ...w,
      state: card.fsrsState === 2 ? 'review' : 'learning',
      card,
      crowns: crownsFor(card),
      lapses: card.lapses,
      isLeech: w.isLeech || isLeech(card.lapses),
      lastReviewAt: r.at,
      nextDueAt: card.due,
      ...(r.exerciseType === 'typing' && r.correct && r.firstExposure && !w.learnedAt
        ? { learnedAt: r.at }
        : {}),
    };
  }
  const last = rows[rows.length - 1]!.at;
  w = { ...w, updatedAt: last };
  if (keep) {
    w = { ...w, favorite: keep.favorite, ...(keep.note ? { note: keep.note } : {}) };
    if (keep.state === 'ignored') w = { ...w, prevState: w.state, state: 'ignored' };
  }
  return w;
}
