import { describe, expect, it } from 'vitest';
import type { LemmaInfo } from '@/engine/types';
import { lemmatize } from './lemmatize';

const L = (id: number, lemma: string, rank = id): LemmaInfo => ({
  id,
  lemma,
  rank,
  pos: [],
  d: 30,
  band: 'B1',
  tags: [],
  family: 0,
});
const byLemma = new Map(
  [
    L(1, 'go'),
    L(2, 'decide'),
    L(3, 'try'),
    L(4, 'child'),
    L(5, 'stop'),
    L(6, 'quick'),
    L(7, 'rate', 7),
    L(8, 'rated', 900),
  ].map((l) => [l.lemma, l]),
);

describe('lemmatize', () => {
  it('handles irregular and regular inflections', () => {
    expect(lemmatize('went', byLemma)?.lemma).toBe('go');
    expect(lemmatize('decided', byLemma)?.lemma).toBe('decide');
    expect(lemmatize('deciding', byLemma)?.lemma).toBe('decide');
    expect(lemmatize('tries', byLemma)?.lemma).toBe('try');
    expect(lemmatize('children', byLemma)?.lemma).toBe('child');
    expect(lemmatize('stopped', byLemma)?.lemma).toBe('stop');
    expect(lemmatize('quickly', byLemma)?.lemma).toBe('quick');
    expect(lemmatize('Go', byLemma)?.lemma).toBe('go');
  });
  it('prefers the more frequent base form over a rare surface lemma', () => {
    expect(lemmatize('rated', byLemma)?.lemma).toBe('rate');
  });
  it('returns undefined for unknown tokens', () => {
    expect(lemmatize('xyzzy', byLemma)).toBeUndefined();
  });
});
