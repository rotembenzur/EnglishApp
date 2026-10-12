import { describe, expect, it } from 'vitest';
import { introduceWord } from './learn';
import { createRng } from './rng';
import { composeSession, dueWords, TYPING_EVERY, type PlanItem } from './session';
import { review } from './srs';
import type { LemmaInfo, UserWord } from './types';

const DAY = 86_400_000;
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
    expect(plan.filter((p) => p.role === 'review')).toHaveLength(0);
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
