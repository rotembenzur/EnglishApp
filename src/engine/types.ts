/**
 * Shared engine types. Plain data only: the engine never touches IO, the DOM or the clock
 * (callers pass `now` explicitly), so every rule is unit-testable.
 */
import type { Band } from './difficulty';

export type UserId = 'rotem' | 'noa';
export const USER_IDS: UserId[] = ['rotem', 'noa'];

export type Pos =
  | 'noun'
  | 'verb'
  | 'adj'
  | 'adv'
  | 'prep'
  | 'conj'
  | 'pron'
  | 'det'
  | 'aux'
  | 'interj'
  | 'num'
  | 'other';

/** Static inventory row (content/lemmas.json, packed at build time). */
export interface LemmaInfo {
  id: number;
  lemma: string;
  rank: number;
  pos: string[];
  d: number;
  band: Band;
  tags: string[];
  family: number;
  /** Content tier available locally: A authored, B enriched, C lemma only. */
  tier?: 'A' | 'B' | 'C';
  /** Curated items (phrasal verbs, idioms, collocations) use their own namespace. */
  kind?: 'word' | 'phrasal' | 'idiom' | 'collocation';
}

export interface Sentence {
  en: string;
  he: string;
}

/** Everything a card needs to render a word. Tier A comes from shards, Tier B from APIs. */
export interface WordContent {
  lemmaId: number;
  lemma: string;
  tier: 'A' | 'B';
  pos: string[];
  ipa?: string;
  ipaUk?: string;
  hebrew: string[];
  definition?: string;
  sentences: Sentence[];
  collocations?: string[];
  hook?: string;
  context?: Sentence;
  forms?: string[];
  audioUrl?: string;
  audioUrlUk?: string;
  auto: boolean;
}

export type ExerciseType =
  | 'intro'
  | 'en_he'
  | 'he_en'
  | 'listening'
  | 'typing'
  | 'cloze'
  | 'match'
  | 'speed'
  | 'spell_audio';

/** Graded exercise types (intro is not graded). */
export type GradedType = Exclude<ExerciseType, 'intro'>;

export type WordState = 'new' | 'learning' | 'review' | 'known' | 'ignored';

/** FSRS card fields, stored flat with epoch-ms dates so they survive JSON and IndexedDB. */
export interface SrsCard {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning (ts-fsrs State). */
  fsrsState: 0 | 1 | 2 | 3;
  lastReview?: number;
}

export interface UserWord {
  userId: UserId;
  lemmaId: number;
  state: WordState;
  /** State before the word was ignored, so "unignore" restores it. */
  prevState?: WordState;
  card: SrsCard;
  crowns: number;
  lapses: number;
  isLeech: boolean;
  favorite: boolean;
  note?: string;
  /** How the word entered: studied normally, verified via "I already know this", or a failed probe. */
  origin: 'new' | 'known_shortcut' | 'probe' | 'manual';
  firstSeenAt: number;
  /** First successful production (typing) answer: the moment the word counts as learned. */
  learnedAt?: number;
  lastReviewAt?: number;
  nextDueAt: number;
  updatedAt: number;
  deviceId: string;
}

export type FsrsRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

/** Append-only review log row: the source of truth for everything derived. */
export interface ReviewRecord {
  id: string;
  userId: UserId;
  lemmaId: number;
  exerciseType: GradedType;
  rating: FsrsRating;
  correct: boolean;
  /** 1, 0.5 (hint or near miss) or 0. */
  score: number;
  responseMs: number;
  /** First graded exposure of a new word (weighs more for theta). */
  firstExposure: boolean;
  /** Theta-only items (placement, probes) do not schedule. */
  purpose: 'learn' | 'review' | 'probe' | 'verify' | 'speed' | 'duel';
  d: number;
  at: number;
  deviceId: string;
}

/** Behavior observed on one graded answer, input to rating derivation. */
export interface AnswerBehavior {
  type: GradedType;
  correct: boolean;
  hinted: boolean;
  nearMiss: boolean;
  responseMs: number;
}

export interface Ability {
  theta: number;
  sigma: number;
  /** Graded answers since placement, drives the K decay. */
  answers: number;
  /** Day key (YYYY-MM-DD) and accumulated theta change for the daily movement budget. */
  dayKey?: string;
  dayDelta?: number;
  /** Below this difficulty, unstudied words count as assumed known (spec 4.2). */
  assumedKnownBelow: number;
  placedAt?: number;
}
