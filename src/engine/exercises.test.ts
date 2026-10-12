import { describe, expect, it } from 'vitest';
import {
  buildMatch,
  buildOptions,
  checkTyping,
  chooseDistractors,
  diffSpelling,
  levenshtein,
  makeCloze,
  matchTimeBonus,
  type OptionWord,
} from './exercises';
import { createRng } from './rng';

const w = (
  lemmaId: number,
  lemma: string,
  pos: string,
  d: number,
  hebrew: string[],
  family?: number,
): OptionWord => ({ lemmaId, lemma, pos: [pos], d, hebrew, ...(family ? { family } : {}) });

const pool: OptionWord[] = [
  w(1, 'decide', 'verb', 20, ['להחליט'], 1),
  w(2, 'decision', 'noun', 22, ['החלטה'], 1),
  w(3, 'choose', 'verb', 21, ['לבחור']),
  w(4, 'select', 'verb', 30, ['לבחור']),
  w(5, 'arrive', 'verb', 22, ['להגיע']),
  w(6, 'reach', 'verb', 23, ['להגיע', 'להשיג']),
  w(7, 'table', 'noun', 15, ['שולחן']),
  w(8, 'happy', 'adj', 12, ['שמח']),
  w(9, 'explain', 'verb', 24, ['להסביר']),
  w(10, 'forget', 'verb', 19, ['לשכוח']),
  w(11, 'determine', 'verb', 35, ['לקבוע', 'להחליט']),
];

describe('distractors', () => {
  it('are valid: same POS, unique Hebrew, no family, no overlap with the answer', () => {
    for (let s = 0; s < 50; s++) {
      const target = pool[0]!;
      const ds = chooseDistractors(target, pool, 3, createRng(s));
      expect(ds).toHaveLength(3);
      const hes = ds.flatMap((d) => d.hebrew);
      expect(new Set(hes).size).toBe(hes.length);
      for (const d of ds) {
        expect(d.pos[0]).toBe('verb');
        expect(d.family).not.toBe(1);
        expect(d.hebrew).not.toContain('להחליט');
        expect(d.lemmaId).not.toBe(1);
      }
      // "choose" and "select" share a gloss: never both.
      expect(ds.filter((d) => d.lemmaId === 3 || d.lemmaId === 4).length).toBeLessThanOrEqual(1);
      // "determine" overlaps with the answer's gloss: never offered.
      expect(ds.find((d) => d.lemmaId === 11)).toBeUndefined();
    }
  });
  it('falls back to other parts of speech only when needed', () => {
    const small = [pool[0]!, pool[6]!, pool[7]!, pool[2]!];
    const ds = chooseDistractors(pool[0]!, small, 3, createRng(1));
    expect(ds).toHaveLength(3);
    expect(ds[0]!.pos[0]).toBe('verb');
  });
  it('builds 4 shuffled options with the right answer index', () => {
    const ds = chooseDistractors(pool[0]!, pool, 3, createRng(2));
    const o = buildOptions(pool[0]!, ds, 'he', createRng(3));
    expect(o.options).toHaveLength(4);
    expect(o.options[o.correctIndex]!.lemmaId).toBe(1);
    expect(o.options[o.correctIndex]!.label).toBe('להחליט');
    const en = buildOptions(pool[0]!, ds, 'en', createRng(3));
    expect(en.options[en.correctIndex]!.label).toBe('decide');
  });
});

describe('typing tolerance', () => {
  it('accepts exact answers ignoring case and spaces', () => {
    expect(checkTyping('  Decide ', ['decide']).verdict).toBe('correct');
  });
  it('distance 1 on words of length 5+ is a near miss', () => {
    expect(checkTyping('decyde', ['decide']).verdict).toBe('near');
    expect(checkTyping('recieve', ['receive']).verdict).toBe('wrong'); // transposition = 2 edits
    expect(checkTyping('recive', ['receive']).verdict).toBe('near');
  });
  it('short words must be exact', () => {
    expect(checkTyping('cot', ['cat']).verdict).toBe('wrong');
    expect(checkTyping('tabel', ['table']).verdict).toBe('wrong');
    expect(checkTyping('tble', ['table']).verdict).toBe('near');
  });
  it('accepts British and American spellings', () => {
    expect(checkTyping('colour', ['color']).verdict).toBe('correct');
    expect(checkTyping('organise', ['organize']).verdict).toBe('correct');
    expect(checkTyping('centre', ['center']).verdict).toBe('correct');
    expect(checkTyping('travelled', ['traveled']).verdict).toBe('correct');
  });
  it('accepts curly apostrophes', () => {
    expect(checkTyping('o’clock', ["o'clock"]).verdict).toBe('correct');
  });
  it('levenshtein basics', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
  it('diff marks the wrong and missing letters', () => {
    const ops = diffSpelling('recive', 'receive');
    expect(ops.map((o) => o.ch).join('')).toBe('receive');
    expect(ops.filter((o) => o.op === 'missing')).toHaveLength(1);
    expect(diffSpelling('decyde', 'decide').filter((o) => o.op === 'wrong')).toHaveLength(1);
  });
});

describe('cloze', () => {
  it('blanks the inflected form', () => {
    const c = makeCloze({ en: 'She decided to quit her job.', he: '' }, 'decide')!;
    expect(c.answer).toBe('decided');
    expect(c.before + '___' + c.after).toBe('She ___ to quit her job.');
  });
  it('uses irregular forms', () => {
    const c = makeCloze({ en: 'We went home early.', he: '' }, 'go', ['went', 'gone'])!;
    expect(c.answer).toBe('went');
  });
  it('handles y -> ies and doubling', () => {
    expect(makeCloze({ en: 'He tried twice.', he: '' }, 'try')!.answer).toBe('tried');
    expect(makeCloze({ en: 'They stopped talking.', he: '' }, 'stop')!.answer).toBe('stopped');
  });
  it('does not match inside other words', () => {
    expect(makeCloze({ en: 'The category is wide.', he: '' }, 'cat')).toBeNull();
  });
  it('handles phrases', () => {
    const c = makeCloze({ en: 'Please give up smoking.', he: '' }, 'give up')!;
    expect(c.answer).toBe('give up');
  });
});

describe('match pairs', () => {
  it('builds 5 unique pairs', () => {
    const m = buildMatch(pool, createRng(1))!;
    expect(m.left).toHaveLength(5);
    expect(m.right).toHaveLength(5);
    expect(new Set(m.right.map((r) => r.label)).size).toBe(5);
    expect(new Set(m.left.map((l) => l.lemmaId))).toEqual(new Set(m.right.map((r) => r.lemmaId)));
  });
  it('time bonus shrinks with time', () => {
    expect(matchTimeBonus(5000)).toBe(10);
    expect(matchTimeBonus(20000)).toBe(5);
    expect(matchTimeBonus(40000)).toBe(0);
  });
});
