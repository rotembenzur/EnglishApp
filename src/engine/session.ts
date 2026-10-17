/**
 * Session composition (spec 4.6).
 */
import { type Rng, shuffle } from './rng';
import { retrievability } from './srs';
import type { ExerciseType, LemmaInfo, UserWord } from './types';

export type SessionMode =
  'learn' | 'review' | 'hard' | 'listening' | 'speed' | 'boss' | 'duel' | 'text';

export type ItemRole =
  'review' | 'intro' | 'recognition' | 'production' | 'probe' | 'match' | 'speed';

/**
 * Where a review item came from. Due reviews come first; the rest fills a session when the queue
 * is short (spec 4.6, cap reached): early reviews by lowest retrievability, then the hard-words
 * pool, then practice of words learned today, then repeats of the same words in other exercises.
 */
export type FillSource = 'due' | 'early' | 'hard' | 'today' | 'repeat';

export interface PlanItem {
  /** Stable key within the session (for React lists and resume). */
  key: string;
  lemmaId: number;
  type: ExerciseType;
  role: ItemRole;
  /** Match pairs carry all their words. */
  matchIds?: number[];
  /** Review items only (older saved plans have none). */
  source?: FillSource;
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
  /** Start of the user's local day: words reviewed or learned since then count as "today". */
  dayStart?: number;
  /** Words from a recently practiced text: they go first among due and fill reviews. */
  priority?: ReadonlySet<number>;
  /** Text practice: the text's words, in order. */
  textIds?: readonly number[];
  rng: Rng;
}

export const SESSION_SIZE = 20;
export const MAX_NEW_PER_SESSION = 5;
export const TYPING_EVERY = 5;
export const SPEED_ROUND_ITEMS = 60;
export const BOSS_SIZE = 30;
/** No session (besides the timed ones) is shorter than this when there is anything to practice. */
export const MIN_SESSION = 15;
/** Upper bound on how often one word may appear in a session when the pool is tiny. */
export const MAX_REPEATS = 5;
/** Extra practice items per new word when a session would otherwise be short. */
export const EXTRA_PER_NEW = 3;

/**
 * Smallest pool of learned words each optional mode needs to make sense. Below it the mode shows
 * a message with a way forward instead of a tiny session (review and learn always run).
 */
export const MODE_MIN: Record<SessionMode, number> = {
  learn: 0,
  review: 1,
  hard: 3,
  listening: 3,
  speed: 4,
  boss: 30,
  duel: 0,
  text: 0,
};

/** Most words one text practice takes (the rest wait for the next round). */
export const TEXT_SESSION_WORDS = 10;

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

/** Stable reorder: items whose lemma is in `p` first. */
function priorityFirst<T>(items: T[], id: (x: T) => number, p?: ReadonlySet<number>): T[] {
  if (!p?.size) return items;
  return [...items.filter((x) => p.has(id(x))), ...items.filter((x) => !p.has(id(x)))];
}

export function dueWords(words: readonly UserWord[], now: number): UserWord[] {
  return words
    .filter((w) => (w.state === 'learning' || w.state === 'review') && w.card.due <= now)
    .sort((a, b) => a.card.due - b.card.due);
}

const isProductionType = (t: ExerciseType) => t === 'typing' || t === 'spell_audio';

/** Learned words with at least one graded answer: the pool every practice mode draws from. */
export function practicePool(words: readonly UserWord[]): UserWord[] {
  return words.filter(
    (w) => (w.state === 'learning' || w.state === 'review') && w.card.fsrsState !== 0,
  );
}

/** Pool size for a mode, as the home screen shows it (speed rounds also use passed probes). */
export function modePoolSize(mode: SessionMode, words: readonly UserWord[]): number {
  if (mode === 'speed') return speedPool(words).length;
  return practicePool(words).length;
}

const HOUR = 3_600_000;

function touchedSince(w: UserWord, dayStart: number): boolean {
  return (
    w.firstSeenAt >= dayStart ||
    (w.lastReviewAt ?? 0) >= dayStart ||
    (w.card.lastReview ?? 0) >= dayStart
  );
}

/**
 * Words to fill a session once the due queue is used up, in order (spec 4.6, owner's bug report):
 *  1. early reviews: not due, not touched today, lowest FSRS retrievability first;
 *  2. the hard-words pool among words reviewed today: leeches, then lowest stability;
 *  3. practice of words learned today, weakest first.
 * FSRS schedules early and same-day reviews from the real elapsed time, so the intervals stay
 * honest (see applyAnswer for the one guard: no Easy bonus on a word that was not due).
 */
export function fillCandidates(
  words: readonly UserWord[],
  now: number,
  opts: { exclude?: ReadonlySet<number>; dayStart?: number; retention?: number } = {},
): { word: UserWord; source: FillSource }[] {
  const dayStart = opts.dayStart ?? now - 12 * HOUR;
  const pool = practicePool(words).filter((w) => w.card.due > now && !opts.exclude?.has(w.lemmaId));
  const early: { w: UserWord; r: number }[] = [];
  const hard: UserWord[] = [];
  const today: UserWord[] = [];
  for (const w of pool) {
    if (!touchedSince(w, dayStart))
      early.push({ w, r: retrievability(w.card, now, opts.retention) });
    else if (w.firstSeenAt < dayStart) hard.push(w);
    else today.push(w);
  }
  early.sort((a, b) => a.r - b.r || a.w.lemmaId - b.w.lemmaId);
  hard.sort(
    (a, b) =>
      Number(b.isLeech) - Number(a.isLeech) ||
      a.card.stability - b.card.stability ||
      b.lapses - a.lapses,
  );
  today.sort((a, b) => a.card.stability - b.card.stability || a.lemmaId - b.lemmaId);
  return [
    ...early.map((x) => ({ word: x.w, source: 'early' as const })),
    ...hard.map((w) => ({ word: w, source: 'hard' as const })),
    ...today.map((w) => ({ word: w, source: 'today' as const })),
  ];
}

/**
 * Tops a list of review words up to `target`: due words (already in `picked`), then fill
 * candidates, then repeats of the same words (each repeat is its own object so it gets its own
 * exercise type) up to MAX_REPEATS appearances per word.
 */
function topUp(
  picked: UserWord[],
  target: number,
  input: Pick<ComposeInput, 'words' | 'now' | 'dayStart' | 'retention' | 'priority'>,
  sources: Map<UserWord, FillSource>,
): UserWord[] {
  const out = [...picked];
  for (const w of out) if (!sources.has(w)) sources.set(w, 'due');
  if (out.length >= target) return out;
  const exclude = new Set(out.map((w) => w.lemmaId));
  const fill = fillCandidates(input.words, input.now, {
    exclude,
    dayStart: input.dayStart,
    retention: input.retention,
  });
  for (const { word, source } of priorityFirst(fill, (c) => c.word.lemmaId, input.priority)) {
    if (out.length >= target) break;
    out.push(word);
    exclude.add(word.lemmaId);
    sources.set(word, source);
  }
  const unique = [...out];
  for (let round = 1; round < MAX_REPEATS && out.length < target && unique.length; round++) {
    for (const w of unique) {
      if (out.length >= target) break;
      const copy = { ...w };
      out.push(copy);
      sources.set(copy, 'repeat');
    }
  }
  return out;
}

const VARIETY: ExerciseType[] = ['en_he', 'he_en', 'listening', 'typing', 'cloze'];

/** Repeated words get a different exercise each time they come back. */
function varyRepeats(items: PlanItem[], clozeable: ReadonlySet<number> | undefined) {
  const used = new Map<number, Set<ExerciseType>>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.role !== 'review' && it.role !== 'speed') continue;
    const seen = used.get(it.lemmaId) ?? new Set<ExerciseType>();
    if (seen.has(it.type)) {
      const alt = VARIETY.find(
        (t) => !seen.has(t) && (t !== 'cloze' || !clozeable || clozeable.has(it.lemmaId)),
      );
      if (alt) items[i] = { ...it, type: alt, role: 'review' };
    }
    seen.add(items[i]!.type);
    used.set(it.lemmaId, seen);
  }
}

/**
 * The same word never comes twice in a row when anything else can go in between. Only review and
 * production items move (a production stays after its recognition); the last item (the closer)
 * stays last when `keepLast` is set.
 */
function separateRepeats(items: PlanItem[], keepLast = false) {
  const movable = (k: number) =>
    (items[k]!.role === 'review' ||
      items[k]!.role === 'speed' ||
      items[k]!.role === 'production') &&
    !(keepLast && k === items.length - 1);
  // A new word's practice never moves ahead of its intro or recognition check (those never move).
  const anchorOf = (id: number) => {
    let at = -1;
    items.forEach((x, k) => {
      if (x.lemmaId === id && (x.role === 'intro' || x.role === 'recognition')) at = k;
    });
    return at;
  };
  const fits = (x: PlanItem, k: number) => k > anchorOf(x.lemmaId);
  const same = (a: number, b: number) =>
    a >= 0 && b < items.length && items[a]!.lemmaId === items[b]!.lemmaId;
  const clashAt = (k: number) => same(k - 1, k) || same(k, k + 1);
  for (let i = 1; i < items.length; i++) {
    if (!same(i - 1, i)) continue;
    // 1. Swap the movable one of the pair with an item elsewhere.
    const from = movable(i) ? i : movable(i - 1) ? i - 1 : -1;
    let fixed = false;
    for (let j = 0; from >= 0 && j < items.length && !fixed; j++) {
      if (j === from || !movable(j) || items[j]!.lemmaId === items[from]!.lemmaId) continue;
      if (!fits(items[from]!, j) || !fits(items[j]!, from)) continue;
      [items[from], items[j]] = [items[j]!, items[from]!];
      if (!clashAt(from) && !clashAt(j)) fixed = true;
      else [items[from], items[j]] = [items[j]!, items[from]!];
    }
    if (fixed) continue;
    // 2. Pull an earlier item of another word in between (moving later never breaks an anchor).
    for (let k = i - 2; k >= 0 && !fixed; k--) {
      if (!movable(k) || items[k]!.lemmaId === items[i]!.lemmaId) continue;
      if (same(k - 1, k + 1)) continue;
      const [moved] = items.splice(k, 1);
      items.splice(i - 1, 0, moved!);
      if (!clashAt(i - 1)) fixed = true;
      else items.splice(k, 0, items.splice(i - 1, 1)[0]!);
    }
  }
}

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
    case 'text':
      return composeText(input);
    default:
      break;
  }
  const size = mode === 'boss' ? BOSS_SIZE : (input.size ?? SESSION_SIZE);
  const due = priorityFirst(dueWords(input.words, now), (w) => w.lemmaId, input.priority);
  const newWords = mode === 'learn' ? (input.newWords ?? []) : [];
  const probe = mode === 'learn' ? (input.probe ?? null) : null;
  const probeSlots = probe ? 1 : 0;

  const reviewBudgetIfNew = Math.min(due.length, Math.ceil(size * 0.5));
  const newCount = Math.min(
    newWords.length,
    MAX_NEW_PER_SESSION,
    Math.max(0, Math.floor((size - probeSlots - reviewBudgetIfNew) / 3)),
  );
  const reviewSlots = Math.max(0, size - probeSlots - newCount * 3);
  // Due reviews first; when they run short (typically after the daily new-word cap), the session
  // is filled so it never shrinks to a lone probe (owner's bug report, 0.6.0).
  const sources = new Map<UserWord, FillSource>();
  let reviewWords = topUp(due.slice(0, reviewSlots), reviewSlots, input, sources);
  // A probe alone is not a session: with nothing else to practice, there is no session.
  if (!reviewWords.length && !newCount) return [];

  // Keep the easiest review for the final slot (end on a win).
  let closer: UserWord | undefined;
  if (reviewWords.length >= 2) {
    const easiest = [...reviewWords.filter((w) => sources.get(w) !== 'repeat')].sort(
      (a, b) =>
        retrievability(b.card, now, input.retention) - retrievability(a.card, now, input.retention),
    )[0]!;
    closer = easiest;
    reviewWords = reviewWords.filter((w) => w !== easiest);
  }

  // Match pairs take 5 review words as one item when there are enough reviews.
  const items: PlanItem[] = [];
  // Oldest due first; repeats go after every first appearance so copies are spread apart.
  const isRepeat = (w: UserWord) => (sources.get(w) === 'repeat' ? 1 : 0);
  let pool = shuffle(rng, reviewWords).sort(
    (a, b) => isRepeat(a) - isRepeat(b) || a.card.due - b.card.due,
  );
  const matchCount = pool.length >= 10 ? 1 : 0;
  const matchItems: PlanItem[] = [];
  for (let m = 0; m < matchCount; m++) {
    const seen = new Set<number>();
    const group = pool
      .filter((w) => w.crowns >= 1 && !seen.has(w.lemmaId) && seen.add(w.lemmaId))
      .slice(0, 5);
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
      source: sources.get(word) ?? 'due',
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
    // No reviews left to space the intros: an earlier word's recognition check does it, once at
    // least one item sits between that word's intro and its check.
    if (b >= backbone.length && i > 0) {
      const ready = pendingRecognition.findIndex(
        (p) =>
          items.length -
            items.findIndex((x) => x.role === 'intro' && x.lemmaId === p.item.lemmaId) >=
          2,
      );
      if (ready >= 0) items.push(pendingRecognition.splice(ready, 1)[0]!.item);
    }
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

  // Still short (a brand-new user, a low cap, almost nothing learned yet): the new words get extra
  // practice later in the session, after their recognition check.
  const extraTypes: ExerciseType[] = ['listening', 'he_en', 'cloze'];
  for (let round = 0; round < EXTRA_PER_NEW; round++) {
    for (const w of chosenNew) {
      if (items.length + (closer ? 1 : 0) >= size) break;
      const rec = items.findIndex((x) => x.role === 'recognition' && x.lemmaId === w.id);
      if (rec < 0) continue;
      const t = extraTypes[(round + w.id) % extraTypes.length]!;
      const type = t === 'cloze' && input.clozeable && !input.clozeable.has(w.id) ? 'he_en' : t;
      // A random spot after the recognition check, never next to the same word.
      const lo = rec + 2;
      const span = Math.max(1, items.length - lo + 1);
      const start = Math.floor(rng() * span);
      let at = -1;
      for (let k = 0; k < span && at < 0; k++) {
        const pos = Math.min(items.length, lo + ((start + k) % span));
        const before = items[pos - 1];
        const after = items[pos];
        if (before?.lemmaId !== w.id && after?.lemmaId !== w.id) at = pos;
      }
      if (at < 0) continue;
      items.splice(at, 0, {
        key: mkKey('review', w.id),
        lemmaId: w.id,
        type,
        role: 'review',
        source: 'today',
      });
    }
  }

  varyRepeats(items, input.clozeable);
  enforceNoTripleIntro(items);
  // After the intro rule (it pulls items forward); swaps keep the intro layout as it is.
  separateRepeats(items);
  enforceTypingRhythm(items);

  if (closer) {
    // A recognition, the easiest kind; another one if this word already had it (tiny pools).
    const had = new Set(items.filter((x) => x.lemmaId === closer.lemmaId).map((x) => x.type));
    const easy: ExerciseType[] = ['en_he', 'he_en', 'listening', 'cloze', 'speed'];
    const fresh = easy.filter(
      (t) => t !== 'cloze' || !input.clozeable || input.clozeable.has(closer.lemmaId),
    );
    const type = fresh.find((t) => !had.has(t)) ?? 'en_he';
    items.push({
      key: mkKey('review', closer.lemmaId),
      lemmaId: closer.lemmaId,
      type,
      role: type === 'speed' ? 'speed' : 'review',
      source: sources.get(closer) ?? 'due',
    });
    // End on a win, but never right after the same word.
    separateRepeats(items, true);
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

function speedPool(words: readonly UserWord[]): UserWord[] {
  return words.filter(
    (w) =>
      (w.state === 'review' || w.state === 'learning' || w.state === 'known') && w.card.reps > 0,
  );
}

function composeSpeed(input: ComposeInput): PlanItem[] {
  const learned = speedPool(input.words);
  // Fewer than a handful of words makes a 60-second round the same three questions on a loop.
  if (learned.length < MODE_MIN.speed) return [];
  const pool = shuffle(input.rng, learned);
  const out: PlanItem[] = [];
  for (let i = 0; i < SPEED_ROUND_ITEMS; i++) {
    let w = pool[i % pool.length]!;
    // Small pools wrap around: never the same word twice in a row.
    if (out.length && out[out.length - 1]!.lemmaId === w.lemmaId) w = pool[(i + 1) % pool.length]!;
    out.push({ key: mkKey('speed', w.lemmaId), lemmaId: w.lemmaId, type: 'speed', role: 'speed' });
  }
  return out;
}

/** Listening: due words, then fill (early, hard, today), then repeats, all as listening. */
function composeListening(input: ComposeInput): PlanItem[] {
  const size = input.size ?? SESSION_SIZE;
  if (practicePool(input.words).length < MODE_MIN.listening) return [];
  const sources = new Map<UserWord, FillSource>();
  const due = dueWords(input.words, input.now).slice(0, size);
  const pick = topUp(due, size, input, sources);
  const firsts = shuffle(
    input.rng,
    pick.filter((w) => sources.get(w) !== 'repeat'),
  );
  const repeats = pick.filter((w) => sources.get(w) === 'repeat');
  const items = [...firsts, ...repeats].map((w) => ({
    key: mkKey('review', w.lemmaId),
    lemmaId: w.lemmaId,
    type: 'listening' as ExerciseType,
    role: 'review' as ItemRole,
    source: sources.get(w) ?? 'due',
  }));
  separateRepeats(items);
  return items;
}

/**
 * Hard words: leeches first, then the lowest stability words. Production-heavy. A small pool is
 * repeated in other exercise types so the session keeps a normal length.
 */
function composeHard(input: ComposeInput): PlanItem[] {
  const size = input.size ?? SESSION_SIZE;
  const active = practicePool(input.words);
  if (active.length < MODE_MIN.hard) return [];
  const leeches = active.filter((w) => w.isLeech);
  const weak = active
    .filter((w) => !w.isLeech)
    .sort((a, b) => a.card.stability - b.card.stability || b.lapses - a.lapses);
  const unique = [...leeches, ...weak].slice(0, size);
  const sources = new Map<UserWord, FillSource>(unique.map((w) => [w, 'hard'] as const));
  const pick = topUp(unique, size, { ...input, words: unique }, sources);
  const types: ExerciseType[] = ['en_he', 'typing', 'cloze', 'he_en', 'listening'];
  const firsts = shuffle(
    input.rng,
    pick.filter((w) => sources.get(w) !== 'repeat'),
  );
  const repeats = pick.filter((w) => sources.get(w) === 'repeat');
  const items = [...firsts, ...repeats].map((w, i) => ({
    key: mkKey('review', w.lemmaId),
    lemmaId: w.lemmaId,
    type:
      types[i % types.length] === 'cloze' && input.clozeable && !input.clozeable.has(w.lemmaId)
        ? 'typing'
        : types[i % types.length]!,
    role: 'review' as ItemRole,
    source: sources.get(w) ?? 'hard',
  }));
  varyRepeats(items, input.clozeable);
  separateRepeats(items);
  return items;
}

/**
 * Practice of one text's words. New words get the full intro path (intro, recognition, cloze,
 * typing); words already in learning get a cloze and a typing or recall check. Clozes use the
 * text's own sentences (the caller puts them first in the content). Rounds keep a word's items
 * apart: first appearances, then recognitions, then clozes, then production.
 */
function composeText(input: ComposeInput): PlanItem[] {
  const ids = [...new Set(input.textIds ?? [])].slice(0, TEXT_SESSION_WORDS);
  const byId = new Map(input.words.map((w) => [w.lemmaId, w]));
  const isNew = (id: number) => {
    const w = byId.get(id);
    return !w || (w.card.reps === 0 && w.card.fsrsState === 0);
  };
  const order = shuffle(input.rng, ids);
  const item = (id: number, type: ExerciseType, role: ItemRole): PlanItem => ({
    key: mkKey(role, id),
    lemmaId: id,
    type,
    role,
    ...(role === 'review' ? { source: 'due' as const } : {}),
  });
  const first: PlanItem[] = [];
  const second: PlanItem[] = [];
  const third: PlanItem[] = [];
  const last: PlanItem[] = [];
  for (const id of order) {
    if (isNew(id)) {
      first.push(item(id, 'intro', 'intro'));
      second.push(item(id, input.rng() < 0.6 ? 'en_he' : 'listening', 'recognition'));
      third.push(item(id, 'cloze', 'review'));
      last.push(item(id, 'typing', 'production'));
    } else {
      const crowns = byId.get(id)?.crowns ?? 0;
      first.push(item(id, 'cloze', 'review'));
      last.push(item(id, crowns >= 1 ? 'typing' : 'he_en', 'review'));
    }
  }
  // Intros come in pairs at most: a known word's cloze goes between when there is one.
  const items = [...first, ...second, ...third, ...shuffle(input.rng, last)];
  enforceNoTripleIntro(items);
  separateRepeats(items);
  return items;
}

/** Rough minutes needed for a number of reviews (spec 7.2 "clear the queue" planning). */
export function minutesFor(reviews: number): number {
  return Math.max(1, Math.round((reviews * 15) / 60));
}
