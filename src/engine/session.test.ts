import { describe, expect, it } from 'vitest';
import { introduceWord } from './learn';
import { createRng } from './rng';
import {
  composeSession,
  dueWords,
  fillCandidates,
  MAX_NEW_PER_SESSION,
  MAX_REPEATS,
  MIN_SESSION,
  modePoolSize,
  SESSION_SIZE,
  TYPING_EVERY,
  type PlanItem,
} from './session';
import { retrievability, review } from './srs';
import type { LemmaInfo, UserWord } from './types';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.UTC(2026, 9, 12, 8);

function reviewWord(id: number, ageDays: number, stability: number, crowns = 2): UserWord {
  const w = introduceWord('rotem', id, now - 60 * DAY, 'dev');
  let card = review(w.card, 3, now - 60 * DAY);
  card = review(card, 3, card.due);
  return {
    ...w,
    state: 'review',
    card: { ...card, fsrsState: 2, stability, due: now - ageDays * DAY },
    crowns,
  };
}

const lemma = (id: number): LemmaInfo => ({
  id,
  lemma: `new${id}`,
  rank: id,
  pos: ['noun'],
  d: 50,
  band: 'B2',
  tags: [],
  family: 0,
});

function graded(items: PlanItem[]) {
  return items.filter((i) => i.role !== 'intro');
}

describe('composeSession (learn)', () => {
  const words = Array.from({ length: 30 }, (_, i) => reviewWord(i + 1, 30 - i, 5 + i * 3));
  const newWords = [lemma(101), lemma(102), lemma(103), lemma(104), lemma(105), lemma(106)];
  const plan = composeSession({
    mode: 'learn',
    now,
    words,
    newWords,
    probe: lemma(900),
    rng: createRng(1),
  });

  it('is about 20 items', () => {
    const units = plan.reduce((s, i) => s + (i.matchIds ? i.matchIds.length : 1), 0);
    expect(units).toBeGreaterThanOrEqual(18);
    expect(units).toBeLessThanOrEqual(21);
  });

  it('takes due reviews oldest first', () => {
    const ids = new Set(plan.flatMap((p) => p.matchIds ?? [p.lemmaId]));
    // The 5 most overdue words are always in.
    for (const id of [1, 2, 3, 4, 5]) expect(ids.has(id)).toBe(true);
    // The least overdue ones are left for later.
    expect(ids.has(30)).toBe(false);
  });

  it('fits new words with intro, then recognition, then production', () => {
    const introduced = plan.filter((p) => p.role === 'intro').map((p) => p.lemmaId);
    expect(introduced.length).toBeGreaterThanOrEqual(2);
    for (const id of introduced) {
      const intro = plan.findIndex((p) => p.role === 'intro' && p.lemmaId === id);
      const rec = plan.findIndex((p) => p.role === 'recognition' && p.lemmaId === id);
      const prod = plan.findIndex((p) => p.role === 'production' && p.lemmaId === id);
      expect(intro).toBeGreaterThanOrEqual(0);
      expect(rec).toBeGreaterThan(intro + 1);
      expect(prod).toBeGreaterThan(rec);
      expect(['typing', 'spell_audio']).toContain(plan[prod]!.type);
    }
  });

  it('never has more than 2 new-word intros in a row', () => {
    for (let i = 2; i < plan.length; i++) {
      const triple = [plan[i - 2]!, plan[i - 1]!, plan[i]!].every((p) => p.role === 'intro');
      expect(triple).toBe(false);
    }
  });

  it('includes exactly one sanity probe', () => {
    expect(plan.filter((p) => p.role === 'probe')).toHaveLength(1);
  });

  it(`has typing at least every ${TYPING_EVERY}th graded item`, () => {
    let since = 0;
    for (const it of graded(plan)) {
      if (it.type === 'typing' || it.type === 'spell_audio') since = 0;
      else since++;
      expect(since).toBeLessThan(TYPING_EVERY);
    }
  });

  it('ends on a likely win: the most stable review as a recognition', () => {
    const last = plan[plan.length - 1]!;
    expect(last.role).toBe('review');
    expect(last.type).toBe('en_he');
    const reviewed = words.filter((w) =>
      plan.some((p) => p.lemmaId === w.lemmaId || p.matchIds?.includes(w.lemmaId)),
    );
    const maxStab = Math.max(...reviewed.map((w) => w.card.stability));
    expect(words.find((w) => w.lemmaId === last.lemmaId)!.card.stability).toBe(maxStab);
  });

  it('roughly follows the exercise mix', () => {
    const types = graded(plan).map((p) => p.type);
    expect(types.some((t) => t === 'typing' || t === 'spell_audio')).toBe(true);
    expect(types.some((t) => t === 'en_he' || t === 'he_en')).toBe(true);
    expect(types.some((t) => t === 'listening')).toBe(true);
    expect(types.some((t) => t === 'cloze')).toBe(true);
  });

  it('spell-from-audio only for words with 2+ crowns', () => {
    const young = Array.from({ length: 20 }, (_, i) => reviewWord(i + 1, 5, 2, 1));
    for (let s = 0; s < 20; s++) {
      const p = composeSession({ mode: 'review', now, words: young, rng: createRng(s) });
      expect(p.some((x) => x.type === 'spell_audio')).toBe(false);
    }
  });
});

describe('composeSession (other modes)', () => {
  it('a brand-new user gets new words and no reviews', () => {
    const plan = composeSession({
      mode: 'learn',
      now,
      words: [],
      newWords: [lemma(1), lemma(2), lemma(3), lemma(4), lemma(5), lemma(6), lemma(7), lemma(8)],
      rng: createRng(2),
    });
    expect(plan.filter((p) => p.role === 'intro').length).toBe(5);
    // No reviews of other words; only extra practice of today's new words.
    const fresh = new Set(plan.filter((p) => p.role === 'intro').map((p) => p.lemmaId));
    expect(plan.filter((p) => p.role === 'review' && !fresh.has(p.lemmaId))).toHaveLength(0);
  });

  it('review-only sessions have no new words and top up when the queue is short', () => {
    const words = Array.from({ length: 30 }, (_, i) => reviewWord(i + 1, i < 5 ? 1 : -3, 10));
    const plan = composeSession({
      mode: 'review',
      now,
      words,
      newWords: [lemma(99)],
      rng: createRng(3),
    });
    expect(plan.some((p) => p.role === 'intro')).toBe(false);
    const units = plan.reduce((s, i) => s + (i.matchIds ? i.matchIds.length : 1), 0);
    expect(units).toBe(20);
  });

  it('hard words sessions start with leeches', () => {
    const words = Array.from({ length: 30 }, (_, i) => ({
      ...reviewWord(i + 1, 1, 10 + i),
      isLeech: i >= 28,
    }));
    const plan = composeSession({ mode: 'hard', now, words, size: 5, rng: createRng(4) });
    const ids = plan.map((p) => p.lemmaId);
    expect(ids).toContain(29);
    expect(ids).toContain(30);
    expect(ids).toContain(1);
  });

  it('listening sessions are listening only', () => {
    const words = Array.from({ length: 10 }, (_, i) => reviewWord(i + 1, 1, 10));
    const plan = composeSession({ mode: 'listening', now, words, rng: createRng(5) });
    expect(plan.every((p) => p.type === 'listening')).toBe(true);
  });

  it('speed rounds are speed items over learned words', () => {
    const words = Array.from({ length: 10 }, (_, i) => reviewWord(i + 1, -5, 10));
    const plan = composeSession({ mode: 'speed', now, words, rng: createRng(6) });
    expect(plan.length).toBeGreaterThan(10);
    expect(plan.every((p) => p.type === 'speed')).toBe(true);
  });

  it('dueWords ignores ignored, known and future words', () => {
    const a = reviewWord(1, 2, 5);
    const b = { ...reviewWord(2, 2, 5), state: 'ignored' as const };
    const c = { ...reviewWord(3, 2, 5), state: 'known' as const };
    const d = reviewWord(4, -2, 5);
    expect(dueWords([a, b, c, d], now).map((w) => w.lemmaId)).toEqual([1]);
  });
});

describe('composeSession after the daily new-word cap (bug: 1-item sessions)', () => {
  const dayStart = now - 8 * HOUR;
  /** A word learned today: introduced, recognized and typed this morning. */
  function learnedToday(id: number, minutesAgo = 120): UserWord {
    const at = now - minutesAgo * 60_000;
    const w = introduceWord('rotem', id, at, 'dev');
    let card = review(w.card, 3, at);
    card = review(card, 3, at + 5 * 60_000);
    card = review(card, 3, at + 20 * 60_000);
    return {
      ...w,
      state: card.fsrsState === 2 ? 'review' : 'learning',
      card,
      crowns: 1,
      lastReviewAt: at + 20 * 60_000,
      learnedAt: at + 20 * 60_000,
    };
  }
  const units = (plan: PlanItem[]) =>
    plan.reduce((n, i) => n + (i.matchIds ? i.matchIds.length : 1), 0);
  function noBackToBack(plan: PlanItem[]) {
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.lemmaId).not.toBe(plan[i - 1]!.lemmaId);
  }

  it('reproduces: cap reached, nothing due, 30 learned words', () => {
    // Every word was reviewed recently and is due in a few days; no new words are left today.
    const words = Array.from({ length: 30 }, (_, i) => reviewWord(i + 1, -(2 + (i % 5)), 10 + i));
    const plan = composeSession({
      mode: 'learn',
      now,
      words,
      newWords: [],
      probe: lemma(900),
      dayStart,
      rng: createRng(11),
    });
    // Before 0.6.0 this was a single item: the sanity probe.
    expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
    expect(units(plan)).toBe(SESSION_SIZE);
    expect(plan.filter((p) => p.role === 'probe')).toHaveLength(1);
    expect(plan.some((p) => p.role === 'intro')).toBe(false);
    // Early reviews, lowest recall probability first: the 19 weakest words are in, never a repeat.
    const r = (w: UserWord) => retrievability(w.card, now);
    const weakest = [...words].sort((a, b) => r(a) - r(b)).slice(0, SESSION_SIZE - 1);
    const ids = new Set(plan.flatMap((p) => p.matchIds ?? [p.lemmaId]));
    for (const w of weakest) expect(ids.has(w.lemmaId)).toBe(true);
    expect(plan.filter((p) => p.role === 'review').every((p) => p.source === 'early')).toBe(true);
    noBackToBack(plan);
  });

  it('cap reached with a few due reviews: due first, then early reviews', () => {
    const due = [reviewWord(1, 3, 8), reviewWord(2, 1, 9), reviewWord(3, 0.2, 12)];
    const later = Array.from({ length: 25 }, (_, i) => reviewWord(i + 10, -(1 + i / 5), 20 + i));
    const plan = composeSession({
      mode: 'learn',
      now,
      words: [...due, ...later],
      newWords: [],
      probe: lemma(900),
      dayStart,
      rng: createRng(12),
    });
    expect(units(plan)).toBe(SESSION_SIZE);
    const ids = new Set(plan.flatMap((p) => p.matchIds ?? [p.lemmaId]));
    for (const id of [1, 2, 3]) expect(ids.has(id)).toBe(true);
    // The rest are early reviews (the due ones may sit in the match board, which has no source).
    const sources = plan.filter((p) => p.role === 'review').map((p) => p.source);
    expect(sources.every((x) => x === 'due' || x === 'early')).toBe(true);
    expect(sources.filter((x) => x === 'early').length).toBeGreaterThanOrEqual(10);
    noBackToBack(plan);
  });

  it('a brand-new user: new words fill a normal session', () => {
    const plan = composeSession({
      mode: 'learn',
      now,
      words: [],
      newWords: Array.from({ length: 8 }, (_, i) => lemma(i + 1)),
      probe: lemma(900),
      dayStart,
      rng: createRng(13),
    });
    expect(plan.filter((p) => p.role === 'intro')).toHaveLength(MAX_NEW_PER_SESSION);
    expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
  });

  it("a brand-new user later the same day: today's words fill the session", () => {
    // Five words learned in the first session, three new ones left under the cap.
    const words = [1, 2, 3, 4, 5].map((id) => learnedToday(id, 30));
    const plan = composeSession({
      mode: 'learn',
      now,
      words,
      newWords: [lemma(6), lemma(7), lemma(8)],
      probe: lemma(900),
      dayStart,
      rng: createRng(14),
    });
    expect(plan.filter((p) => p.role === 'intro')).toHaveLength(3);
    expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
    noBackToBack(plan);
  });

  it('a user with only a handful of learned words: repeats in other exercises', () => {
    const words = [1, 2, 3].map((id) => learnedToday(id));
    for (let seed = 0; seed < 20; seed++) {
      const plan = composeSession({
        mode: 'learn',
        now,
        words,
        newWords: [],
        probe: lemma(900),
        dayStart,
        rng: createRng(seed),
      });
      expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
      noBackToBack(plan);
      for (const id of [1, 2, 3]) {
        const mine = plan.filter((p) => p.lemmaId === id);
        expect(mine.length).toBeLessThanOrEqual(MAX_REPEATS);
        // Each comeback is a different exercise (typing may repeat for the typing rhythm).
        const types = mine.map((p) => p.type).filter((t) => t !== 'typing');
        expect(new Set(types).size).toBe(types.length);
      }
    }
  });

  it('a brand-new user with the lowest cap (3) still gets a normal session', () => {
    for (let seed = 0; seed < 20; seed++) {
      const plan = composeSession({
        mode: 'learn',
        now,
        words: [],
        newWords: [lemma(1), lemma(2), lemma(3)],
        probe: lemma(900),
        dayStart,
        rng: createRng(seed),
      });
      expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
      noBackToBack(plan);
      // Every practice item of a new word comes after its intro and recognition check.
      for (const id of [1, 2, 3]) {
        const rec = plan.findIndex((p) => p.role === 'recognition' && p.lemmaId === id);
        const intro = plan.findIndex((p) => p.role === 'intro' && p.lemmaId === id);
        expect(rec).toBeGreaterThan(intro);
        plan.forEach((p, k) => {
          if (p.lemmaId === id && p.role === 'review') expect(k).toBeGreaterThan(rec);
        });
      }
    }
  });

  it('a probe alone is never a session', () => {
    const plan = composeSession({
      mode: 'learn',
      now,
      words: [],
      newWords: [],
      probe: lemma(900),
      rng: createRng(15),
    });
    expect(plan).toEqual([]);
  });

  it('fills in order: early (lowest recall), hard pool, then words learned today', () => {
    const early = [reviewWord(1, -3, 15), reviewWord(2, -1, 15)];
    // Reviewed this morning (not learned today): a leech and a weak word.
    const reviewedToday = (id: number, stability: number, leech: boolean): UserWord => ({
      ...reviewWord(id, -2, stability),
      firstSeenAt: now - 30 * DAY,
      lastReviewAt: now - HOUR,
      isLeech: leech,
    });
    const hard = [reviewedToday(3, 1.5, false), reviewedToday(4, 9, true)];
    const today = [learnedToday(5), learnedToday(6)];
    const order = fillCandidates([...today, ...hard, ...early], now, { dayStart });
    expect(order.map((x) => [x.word.lemmaId, x.source])).toEqual([
      [1, 'early'],
      [2, 'early'],
      [4, 'hard'],
      [3, 'hard'],
      [5, 'today'],
      [6, 'today'],
    ]);
  });
});

describe('scarce content in the other modes', () => {
  const few = (n: number) => Array.from({ length: n }, (_, i) => reviewWord(i + 1, -2, 10 + i));

  it('review: a short queue is filled, a tiny pool repeats', () => {
    const plan = composeSession({ mode: 'review', now, words: few(3), rng: createRng(21) });
    expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
    expect(composeSession({ mode: 'review', now, words: [], rng: createRng(21) })).toEqual([]);
  });

  it('hard words: a small pool repeats in other exercises, below 3 words there is no session', () => {
    const plan = composeSession({ mode: 'hard', now, words: few(4), rng: createRng(22) });
    expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.lemmaId).not.toBe(plan[i - 1]!.lemmaId);
    expect(composeSession({ mode: 'hard', now, words: few(2), rng: createRng(22) })).toEqual([]);
  });

  it('listening: a small pool repeats, below 3 words there is no session', () => {
    const plan = composeSession({ mode: 'listening', now, words: few(3), rng: createRng(23) });
    expect(plan.length).toBeGreaterThanOrEqual(MIN_SESSION);
    expect(plan.every((p) => p.type === 'listening')).toBe(true);
    expect(composeSession({ mode: 'listening', now, words: few(2), rng: createRng(23) })).toEqual(
      [],
    );
  });

  it('speed: needs 4 words, never the same word twice in a row', () => {
    expect(composeSession({ mode: 'speed', now, words: few(3), rng: createRng(24) })).toEqual([]);
    const plan = composeSession({ mode: 'speed', now, words: few(4), rng: createRng(24) });
    expect(plan.length).toBeGreaterThan(MIN_SESSION);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.lemmaId).not.toBe(plan[i - 1]!.lemmaId);
  });

  it('boss: 30 items even when few are due', () => {
    const plan = composeSession({ mode: 'boss', now, words: few(30), rng: createRng(25) });
    expect(units(plan)).toBe(30);
  });

  it('mode pools count learned words only', () => {
    const words = [...few(3), { ...reviewWord(9, 1, 5), state: 'ignored' as const }];
    expect(modePoolSize('hard', words)).toBe(3);
    expect(
      modePoolSize('speed', [...words, { ...reviewWord(10, -50, 300), state: 'known' as const }]),
    ).toBe(4);
  });
});

function units(plan: PlanItem[]) {
  return plan.reduce((n, i) => n + (i.matchIds ? i.matchIds.length : 1), 0);
}

describe('composeSession over many pool shapes (property check)', () => {
  const dayStart = now - 8 * HOUR;
  it('keeps every rule for 0 to 30 learned words, 0 to 5 new words, with or without a probe', () => {
    for (const learned of [0, 1, 2, 3, 4, 6, 10, 30]) {
      for (const fresh of [0, 1, 3, 5]) {
        for (const withProbe of [false, true]) {
          for (let seed = 0; seed < 12; seed++) {
            const rng = createRng(seed * 31 + learned * 7 + fresh);
            const words = Array.from({ length: learned }, (_, i) =>
              reviewWord(i + 1, seed % 3 === 0 && i < 2 ? 1 : -(1 + (i % 6)), 3 + i * 2),
            );
            const plan = composeSession({
              mode: 'learn',
              now,
              words,
              newWords: Array.from({ length: fresh }, (_, i) => lemma(100 + i)),
              probe: withProbe ? lemma(900) : null,
              dayStart,
              rng,
            });
            const label = `learned ${learned}, new ${fresh}, probe ${withProbe}, seed ${seed}`;
            if (!learned && !fresh) {
              expect(plan, label).toEqual([]);
              continue;
            }
            if (learned >= 3 || fresh >= 3) {
              expect(plan.length, label).toBeGreaterThanOrEqual(MIN_SESSION);
            }
            expect(plan.length, label).toBeLessThanOrEqual(SESSION_SIZE + 1);
            for (let i = 1; i < plan.length; i++) {
              expect(plan[i]!.lemmaId === plan[i - 1]!.lemmaId && learned + fresh >= 3, label).toBe(
                false,
              );
            }
            for (let i = 2; i < plan.length; i++) {
              expect(
                [plan[i - 2]!, plan[i - 1]!, plan[i]!].every((p) => p.role === 'intro'),
                label,
              ).toBe(false);
            }
            for (const w of plan.filter((p) => p.role === 'intro')) {
              const intro = plan.indexOf(w);
              const rec = plan.findIndex(
                (p) => p.role === 'recognition' && p.lemmaId === w.lemmaId,
              );
              const prod = plan.findIndex(
                (p) => p.role === 'production' && p.lemmaId === w.lemmaId,
              );
              // Something sits between an intro and its check whenever there is anything else.
              const distinct = new Set(plan.map((p) => p.lemmaId)).size;
              expect(rec, label).toBeGreaterThan(distinct >= 3 ? intro + 1 : intro);
              expect(prod, label).toBeGreaterThan(rec);
              plan.forEach((p, k) => {
                if (p.lemmaId === w.lemmaId && p.role === 'review')
                  expect(k, label).toBeGreaterThan(rec);
              });
            }
            const perWord = new Map<number, number>();
            for (const p of plan) perWord.set(p.lemmaId, (perWord.get(p.lemmaId) ?? 0) + 1);
            for (const [id, n] of perWord) {
              if (id >= 100) continue; // new words: intro, checks and extra practice
              expect(n, label).toBeLessThanOrEqual(MAX_REPEATS);
            }
            for (const m of plan.filter((p) => p.matchIds)) {
              expect(new Set(m.matchIds).size, label).toBe(m.matchIds!.length);
            }
            expect(plan.filter((p) => p.role === 'probe').length, label).toBe(withProbe ? 1 : 0);
          }
        }
      }
    }
  });
});
