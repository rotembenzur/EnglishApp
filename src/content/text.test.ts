import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng';
import type { LemmaInfo } from '@/engine/types';
import { analyzeText, autoMark, buildCheck, sentencesWith, splitSentences } from './text';

// prettier-ignore
const lemmas = [
  ['the', 1], ['model', 30], ['be', 1], ['multimodal', 70], ['release', 40], ['meta', 65],
  ['anthropic', 75], ['mistral', 80], ['new', 5], ['and', 1], ['a', 1], ['launch', 45],
  ['apple', 10], ['eat', 5], ['i', 1], ['an', 1], ['research', 35], ['lab', 40], ['say', 5],
  ['it', 1], ['open', 10], ['source', 30], ['weight', 40], ['today', 5],
] as const;
const byLemma = new Map<string, LemmaInfo>(
  lemmas.map(([lemma, d], i) => [
    lemma,
    { id: i + 1, lemma, rank: i + 1, pos: ['noun'], d, band: 'B2', tags: [], family: 0 },
  ]),
);
const id = (l: string) => byLemma.get(l)!.id;

const TEXT = `Anthropic released a new multimodal model today. Meta and Mistral launched models too.
The research lab says the weights are open source. I eat an apple. Apple says it is new.`;

describe('splitSentences', () => {
  it('splits at sentence ends and line breaks, not after abbreviations', () => {
    const s = splitSentences(
      'Dr. Smith met Mr. Jones in the U.S. Army. Then they left!\nNew line here',
    );
    expect(s.map((x) => x.text)).toEqual([
      'Dr. Smith met Mr. Jones in the U.S. Army.',
      'Then they left!',
      'New line here',
    ]);
    expect(s[1]!.gap).toBe('\n');
  });
});

describe('analyzeText', () => {
  const a = analyzeText(TEXT, byLemma);
  const words = a.sentences.flatMap((s) => s.tokens.filter((t) => t.word));
  const find = (part: string) => words.filter((t) => t.part === part);

  it('maps inflected words to lemmas', () => {
    expect(find('released')[0]!.lemma?.lemma).toBe('release');
    expect(find('weights')[0]!.lemma?.lemma).toBe('weight');
    expect(find('multimodal')[0]!.lemma?.lemma).toBe('multimodal');
  });

  it('leaves out names and brands, even ones that are also English words', () => {
    for (const name of ['Anthropic', 'Meta', 'Mistral']) {
      expect(find(name)[0]!.proper).toBe(true);
      expect(find(name)[0]!.lemma).toBeUndefined();
    }
    // "apple" in lower case is a word; "Apple says" at a sentence start is the company.
    expect(find('apple')[0]!.lemma?.lemma).toBe('apple');
    expect(find('Apple')[0]!.proper).toBe(true);
    // An ordinary capitalized sentence start is still a word.
    expect(find('The')[0]!.lemma?.lemma).toBe('the');
    expect(find('I')[0]!.proper).toBe(false);
  });

  it('marks the words above the level that are not studied, hardest first', () => {
    const marked = autoMark(a, new Set([id('release')]), 40);
    expect(marked).toContain(id('multimodal'));
    expect(marked).not.toContain(id('release'));
    expect(marked).not.toContain(id('anthropic'));
    expect(marked).not.toContain(id('meta'));
    expect(marked).not.toContain(id('the'));
    expect(marked[0]).toBe(id('multimodal'));
  });

  it('finds the sentences a word appears in', () => {
    expect(sentencesWith(a, id('model')).map((s) => s.index)).toEqual([0, 1]);
    expect(sentencesWith(a, id('model'))[1]!.surface).toBe('models');
  });
});

describe('buildCheck', () => {
  const sentences = [
    'The company released a new model this morning.',
    'It can read images and listen to speech.',
    'Researchers say it is faster than the last version.',
    'The weights will be open to everyone next month.',
    'Short one.',
  ];
  const he = ['א א א', 'ב ב ב', 'ג ג ג', 'ד ד ד', null];

  it('asks meaning, which and next questions with the right answer among three options', () => {
    const qs = buildCheck(sentences, he, createRng(3));
    expect(qs.length).toBe(4);
    expect(new Set(qs.map((q) => q.kind))).toEqual(new Set(['meaning', 'which', 'next']));
    for (const q of qs) {
      expect(q.options).toHaveLength(3);
      expect(new Set(q.options).size).toBe(3);
      const i = sentences.indexOf(q.kind === 'which' ? q.options[q.correct]! : q.prompt);
      if (q.kind === 'meaning') expect(q.options[q.correct]).toBe(he[i]);
      if (q.kind === 'which') expect(he[i]).toBe(q.prompt);
      if (q.kind === 'next') expect(q.options[q.correct]).toBe(sentences[i + 1]);
    }
  });

  it('asks nothing about a text that is too short', () => {
    expect(buildCheck(['One short sentence here today.'], ['א'], createRng(1))).toEqual([]);
  });
});
