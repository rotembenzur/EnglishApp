/**
 * Session composition (spec 4.6).
 */
import { type Rng, shuffle } from './rng';
import { retrievability } from './srs';
import type { ExerciseType, LemmaInfo, UserWord } from './types';

export type SessionMode = 'learn' | 'review' | 'hard' | 'listening' | 'speed' | 'boss' | 'duel';

export type ItemRole =
  'review' | 'intro' | 'recognition' | 'production' | 'probe' | 'match' | 'speed';

export interface PlanItem {
  /** Stable key within the session (for React lists and resume). */
  key: string;
  lemmaId: number;
  type: ExerciseType;
  role: ItemRole;
  /** Match pairs carry all their words. */
  matchIds?: number[];
}

export interface ComposeInput {
  mode: SessionMode;
  now: number;
  /** All active (non-ignored, non-new) user words; the composer picks due ones. */
  words: readonly UserWord[];
  /** New words already chosen by selection (learn mode only). */
  newWords?: readonly LemmaInfo[];
  probe?: LemmaInfo | null;
  size?: number;
  retention?: number;
  /** Lemma ids that have usable sentences for cloze. */
  clozeable?: ReadonlySet<number>;
  rng: Rng;
}

export const SESSION_SIZE = 20;
export const MAX_NEW_PER_SESSION = 5;
export const TYPING_EVERY = 5;
export const SPEED_ROUND_ITEMS = 60;
export const BOSS_SIZE = 30;

/** Approximate exercise mix for review items (spec 4.6 item 4). */
export const MIX: Record<
  'recognition' | 'typing' | 'listening' | 'cloze' | 'match' | 'speed',
  number
> = {
  recognition: 0.35,
  typing: 0.2,
  listening: 0.15,
  cloze: 0.15,
  match: 0.1,
  speed: 0.05,
};

export function dueWords(words: readonly UserWord[], now: number): UserWord[] {
  return words
    .filter((w) => (w.state === 'learning' || w.state === 'review') && w.card.due <= now)
    .sort((a, b) => a.card.due - b.card.due);
}

const isProductionType = (t: ExerciseType) => t === 'typing' || t === 'spell_audio';

/** Distribute review exercise types across words: mature words get the production-heavy types. */
function assignReviewTypes(
  words: UserWord[],
  rng: Rng,
  clozeable: ReadonlySet<number> | undefined,
): { word: UserWord; type: ExerciseType }[] {
  const n = words.length;
  const quota = {
    typing: Math.round(n * MIX.typing),
    listening: Math.round(n * MIX.listening),
    cloze: Math.round(n * MIX.cloze),
    speed: Math.round(n * MIX.speed),
  };
  // Most mature first so they receive the harder production types.
  const byMaturity = [...words].sort((a, b) => b.card.stability - a.card.stability);
  const out = new Map<UserWord, ExerciseType>();
  for (const w of byMaturity) {
    if (quota.typing > 0 && w.crowns >= 1) {
      out.set(w, w.crowns >= 2 && rng() < 0.35 ? 'spell_audio' : 'typing');
      quota.typing--;
    } else if (quota.cloze > 0 && (!clozeable || clozeable.has(w.lemmaId))) {
      out.set(w, 'cloze');
      quota.cloze--;
    } else if (quota.listening > 0) {
      out.set(w, 'listening');
      quota.listening--;
    } else if (quota.speed > 0 && w.crowns >= 1) {
      out.set(w, 'speed');
      quota.speed--;
    } else {
      out.set(w, rng() < 0.55 ? 'en_he' : 'he_en');
    }
  }
  // Young words left over get typing if the typing quota is still open.
  for (const w of words) {
    if (quota.typing <= 0) break;
    const t = out.get(w);
    if (t === 'en_he' || t === 'he_en') {
      out.set(w, 'typing');
      quota.typing--;
    }
  }
  return words.map((w) => ({ word: w, type: out.get(w)! }));
}

let keySeq = 0;
const mkKey = (role: string, id: number) => `${role}:${id}:${(keySeq++).toString(36)}`;

/**
 * Standard learn session:
 *  1. due reviews first (oldest first), capped so new words still fit;
 *  2. new words interleaved (intro, recognition a few items later, production near the end),
 *     never more than 2 intros in a row;
 *  3. one sanity probe;
 *  4. review types follow the mix; typing at least every 5th item;
 *  5. the last item is the one most likely to be right.
 */
export function composeSession(input: ComposeInput): PlanItem[] {
  const { mode, now, rng } = input;
  switch (mode) {
    case 'speed':
      return composeSpeed(input);
    case 'listening':
      return composeListening(input);
    case 'hard':
      return composeHard(input);
    default:
      break;
  }
  const size = mode === 'boss' ? BOSS_SIZE : (input.size ?? SESSION_SIZE);
  const due = dueWords(input.words, now);
  const newWords = mode === 'learn' ? (input.newWords ?? []) : [];
  const probe = mode === 'learn' ? (input.probe ?? null) : null;
  const probeSlots = probe ? 1 : 0;

  const reviewBudgetIfNew = Math.min(due.length, Math.ceil(size * 0.5));
  const newCount = Math.min(
    newWords.length,
    MAX_NEW_PER_SESSION,
    Math.max(0, Math.floor((size - probeSlots - reviewBudgetIfNew) / 3)),
  );
  let reviewWords = due.slice(0, Math.max(0, size - probeSlots - newCount * 3));

  // Review and boss sessions top up with the weakest not-yet-due words when the queue is short.
  if (mode !== 'learn' && reviewWords.length < size) {
    const extra = input.words
      .filter(
        (w) =>
          (w.state === 'learning' || w.state === 'review') &&
          !reviewWords.includes(w) &&
          w.card.fsrsState !== 0,
      )
      .map((w) => ({ w, r: retrievability(w.card, now, input.retention) }))
      .sort((a, b) => a.r - b.r)
      .slice(0, size - reviewWords.length)
      .map((x) => x.w);
    reviewWords = [...reviewWords, ...extra];
  }

  // Keep the easiest review for the final slot (end on a win).
  let closer: UserWord | undefined;
  if (reviewWords.length >= 2) {
    const easiest = [...reviewWords].sort(
      (a, b) =>
        retrievability(b.card, now, input.retention) - retrievability(a.card, now, input.retention),
    )[0]!;
    closer = easiest;
    reviewWords = reviewWords.filter((w) => w !== easiest);
  }

  // Match pairs take 5 review words as one item when there are enough reviews.
  const items: PlanItem[] = [];
  let pool = shuffle(rng, reviewWords).sort((a, b) => a.card.due - b.card.due);
  const matchCount = pool.length >= 10 ? 1 : 0;
  const matchItems: PlanItem[] = [];
  for (let m = 0; m < matchCount; m++) {
    const group = pool.filter((w) => w.crowns >= 1).slice(0, 5);
    if (group.length < 5) break;
    pool = pool.filter((w) => !group.includes(w));
    matchItems.push({
      key: mkKey('match', group[0]!.lemmaId),
      lemmaId: group[0]!.lemmaId,
      type: 'match',
      role: 'match',
      matchIds: group.map((w) => w.lemmaId),
    });
  }

  const reviews: PlanItem[] = assignReviewTypes(pool, rng, input.clozeable).map(
    ({ word, type }) => ({
      key: mkKey('review', word.lemmaId),
      lemmaId: word.lemmaId,
      type,
      role: type === 'speed' ? 'speed' : 'review',
    }),
  );

  // Lay out reviews, inserting intros at a steady rhythm and match boards spread out.
  const chosenNew = newWords.slice(0, newCount);
  const backbone: PlanItem[] = [...reviews];
  matchItems.forEach((m, i) => backbone.splice(Math.min(backbone.length, 3 + i * 6), 0, m));
  const total = backbone.length + chosenNew.length * 3 + probeSlots;
  const gap = chosenNew.length
    ? Math.max(1, Math.floor(backbone.length / (chosenNew.length + 1)))
    : 0;
  let b = 0;
  const pendingRecognition: { at: number; item: PlanItem }[] = [];
  for (let i = 0; i < chosenNew.length; i++) {
    // Up to `gap` reviews before each intro (at least one between consecutive intro pairs).
    const run = i === 0 ? Math.min(1, backbone.length) : gap;
    for (let r = 0; r < run && b < backbone.length; r++) items.push(backbone[b++]!);
    const w = chosenNew[i]!;
    items.push({ key: mkKey('intro', w.id), lemmaId: w.id, type: 'intro', role: 'intro' });
    pendingRecognition.push({
      at: items.length + 2 + Math.floor(rng() * 3),
      item: {
        key: mkKey('recognition', w.id),
        lemmaId: w.id,
        type: rng() < 0.6 ? 'en_he' : 'listening',
        role: 'recognition',
      },
    });
    // Flush recognitions that are due at this point.
    flushRecognitions(items, pendingRecognition);
  }
  while (b < backbone.length) {
    items.push(backbone[b++]!);
    flushRecognitions(items, pendingRecognition);
  }
  for (const p of pendingRecognition) items.push(p.item);
  pendingRecognition.length = 0;

  if (probe) {
    const at = Math.min(items.length, Math.max(2, Math.floor(items.length / 2)));
    items.splice(at, 0, {
      key: mkKey('probe', probe.id),
      lemmaId: probe.id,
      type: rng() < 0.5 ? 'en_he' : 'he_en',
      role: 'probe',
    });
  }

  // Production checks for each new word, placed in the last third.
  const productions = chosenNew.map((w) => ({
    key: mkKey('production', w.id),
    lemmaId: w.id,
    type: 'typing' as ExerciseType,
    role: 'production' as ItemRole,
  }));
  for (const p of productions) {
    const lastThird = Math.max(items.length - Math.ceil(total / 3), 0);
    const recIdx = items.findIndex((x) => x.role === 'recognition' && x.lemmaId === p.lemmaId);
    const at = Math.max(lastThird, recIdx + 2);
    items.splice(Math.min(items.length, at + Math.floor(rng() * 2)), 0, p);
  }

  enforceNoTripleIntro(items);
  enforceTypingRhythm(items);

  if (closer) {
    items.push({
      key: mkKey('review', closer.lemmaId),
      lemmaId: closer.lemmaId,
      type: 'en_he',
      role: 'review',
    });
  }
  return items;
}

function flushRecognitions(items: PlanItem[], pending: { at: number; item: PlanItem }[]) {
  for (let i = 0; i < pending.length;) {
    if (items.length >= pending[i]!.at) {
      items.push(pending[i]!.item);
      pending.splice(i, 1);
    } else i++;
  }
}

/** Never more than 2 new-word intros in a row: pull a later non-intro item forward. */
function enforceNoTripleIntro(items: PlanItem[]) {
  for (let i = 2; i < items.length; i++) {
    if (
      items[i]!.role === 'intro' &&
      items[i - 1]!.role === 'intro' &&
      items[i - 2]!.role === 'intro'
    ) {
      const j = items.findIndex((x, k) => k > i && x.role !== 'intro');
      if (j < 0) break;
      const [moved] = items.splice(j, 1);
      items.splice(i, 0, moved!);
    }
  }
}

/** Typing at least every 5th item: in any 5 consecutive graded items, one is a production type. */
function enforceTypingRhythm(items: PlanItem[]) {
  let since = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (isProductionType(it.type)) {
      since = 0;
      continue;
    }
    if (it.role === 'intro') continue;
    since++;
    if (since >= TYPING_EVERY) {
      // Convert this item (or the nearest earlier convertible one) to typing.
      for (let k = i; k > i - TYPING_EVERY && k >= 0; k--) {
        const c = items[k]!;
        if (c.role === 'review' || c.role === 'recognition' || c.role === 'speed') {
          // A recognition right after its intro stays a recognition when possible.
          items[k] = { ...c, type: 'typing', role: c.role === 'speed' ? 'review' : c.role };
          break;
        }
      }
      since = 0;
    }
  }
}

function composeSpeed(input: ComposeInput): PlanItem[] {
  const learned = input.words.filter(
    (w) =>
      (w.state === 'review' || w.state === 'learning' || w.state === 'known') && w.card.reps > 0,
  );
  const pool = shuffle(input.rng, learned);
  const out: PlanItem[] = [];
  for (let i = 0; i < SPEED_ROUND_ITEMS && pool.length; i++) {
    const w = pool[i % pool.length]!;
    out.push({ key: mkKey('speed', w.lemmaId), lemmaId: w.lemmaId, type: 'speed', role: 'speed' });
  }
  return out;
}

function composeListening(input: ComposeInput): PlanItem[] {
  const size = input.size ?? SESSION_SIZE;
  const due = dueWords(input.words, input.now);
  let pick = due.slice(0, size);
  if (pick.length < size) {
    const rest = input.words
      .filter((w) => (w.state === 'learning' || w.state === 'review') && !pick.includes(w))
      .sort((a, b) => (b.lastReviewAt ?? 0) - (a.lastReviewAt ?? 0));
    pick = [...pick, ...rest.slice(0, size - pick.length)];
  }
  return shuffle(input.rng, pick).map((w) => ({
    key: mkKey('review', w.lemmaId),
    lemmaId: w.lemmaId,
    type: 'listening' as ExerciseType,
    role: 'review' as ItemRole,
  }));
}

/** Hard words: leeches first, then the lowest stability words. Production-heavy. */
function composeHard(input: ComposeInput): PlanItem[] {
  const size = input.size ?? SESSION_SIZE;
  const active = input.words.filter(
    (w) => (w.state === 'learning' || w.state === 'review') && w.card.fsrsState !== 0,
  );
  const leeches = active.filter((w) => w.isLeech);
  const weak = active
    .filter((w) => !w.isLeech)
    .sort((a, b) => a.card.stability - b.card.stability || b.lapses - a.lapses);
  const pick = [...leeches, ...weak].slice(0, size);
  const types: ExerciseType[] = ['en_he', 'typing', 'cloze', 'he_en', 'listening'];
  return shuffle(input.rng, pick).map((w, i) => ({
    key: mkKey('review', w.lemmaId),
    lemmaId: w.lemmaId,
    type:
      types[i % types.length] === 'cloze' && input.clozeable && !input.clozeable.has(w.lemmaId)
        ? 'typing'
        : types[i % types.length]!,
    role: 'review' as ItemRole,
  }));
}

/** Rough minutes needed for a number of reviews (spec 7.2 "clear the queue" planning). */
export function minutesFor(reviews: number): number {
  return Math.max(1, Math.round((reviews * 15) / 60));
}
