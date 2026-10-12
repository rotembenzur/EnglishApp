/**
 * Turns a plan item plus content into a concrete exercise view model.
 */
import {
  buildMatch,
  buildOptions,
  chooseDistractors,
  makeCloze,
  type Cloze,
  type MatchBoard,
  type OptionWord,
  type Options,
} from '@/engine/exercises';
import { pick, shuffle, type Rng } from '@/engine/rng';
import type { PlanItem } from '@/engine/session';
import type { LemmaInfo, WordContent } from '@/engine/types';

export type Exercise =
  | { kind: 'intro'; item: PlanItem; word: WordContent }
  | {
      kind: 'choice';
      item: PlanItem;
      word: WordContent;
      prompt: 'en' | 'he' | 'audio';
      options: Options;
      timerMs?: number;
    }
  | {
      kind: 'typing';
      item: PlanItem;
      word: WordContent;
      accepted: string[];
      cloze: Cloze | null;
      audioOnly: boolean;
    }
  | {
      kind: 'cloze';
      item: PlanItem;
      word: WordContent;
      cloze: Cloze;
      sentenceHe: string;
      options: Options | null;
    }
  | { kind: 'match'; item: PlanItem; words: WordContent[]; board: MatchBoard };

export function toOptionWord(c: WordContent, info?: LemmaInfo): OptionWord {
  return {
    lemmaId: c.lemmaId,
    lemma: c.lemma,
    pos: c.pos.length ? c.pos : (info?.pos ?? []),
    d: info?.d ?? 50,
    hebrew: c.hebrew,
    ...(info?.family ? { family: info.family } : {}),
  };
}

/** Apply the inflection relation answer/lemma to another lemma (for cloze multiple choice). */
export function inflectLike(answer: string, lemma: string, other: string): string {
  const a = answer.toLowerCase();
  const l = lemma.toLowerCase();
  if (a === l) return other;
  const stemE = (s: string) => (s.endsWith('e') ? s.slice(0, -1) : s);
  if (a.endsWith('ing')) return stemE(other) + 'ing';
  if (a.endsWith('ied') && l.endsWith('y'))
    return other.endsWith('y') ? other.slice(0, -1) + 'ied' : stemE(other) + 'ed';
  if (a.endsWith('ed'))
    return other.endsWith('e')
      ? other + 'd'
      : other.endsWith('y')
        ? other.slice(0, -1) + 'ied'
        : other + 'ed';
  if (a.endsWith('ies')) return other.endsWith('y') ? other.slice(0, -1) + 'ies' : other + 's';
  if (a.endsWith('es') && !l.endsWith('e'))
    return /(s|x|z|ch|sh)$/.test(other) ? other + 'es' : other + 's';
  if (a.endsWith('s'))
    return other.endsWith('y') && !/[aeiou]y$/.test(other)
      ? other.slice(0, -1) + 'ies'
      : other + 's';
  if (a.endsWith('ly') && !l.endsWith('ly'))
    return other.endsWith('y') ? other.slice(0, -1) + 'ily' : other + 'ly';
  return other;
}

const matchCase = (sample: string, s: string) =>
  sample[0] && sample[0] === sample[0].toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export interface BuildContext {
  contents: Map<number, WordContent>;
  infos: Map<number, LemmaInfo>;
  pool: OptionWord[];
  rng: Rng;
  /** Crowns per lemma: typing in cloze for mature words, choice for young ones. */
  crowns: (lemmaId: number) => number;
}

export function buildExercise(item: PlanItem, ctx: BuildContext): Exercise | null {
  const word = ctx.contents.get(item.lemmaId);
  if (!word) return null;
  const info = ctx.infos.get(item.lemmaId);
  const target = toOptionWord(word, info);
  const options = (side: 'he' | 'en') => {
    const ds = chooseDistractors(target, ctx.pool, 3, ctx.rng);
    if (ds.length < 3) return null;
    return buildOptions(target, ds, side, ctx.rng);
  };

  switch (item.type) {
    case 'intro':
      return { kind: 'intro', item, word };
    case 'en_he':
    case 'speed':
    case 'he_en': {
      const side = item.type === 'he_en' ? 'en' : 'he';
      const o = options(side);
      if (!o) return null;
      return {
        kind: 'choice',
        item,
        word,
        prompt: item.type === 'he_en' ? 'he' : 'en',
        options: o,
        ...(item.type === 'speed' ? { timerMs: 6000 } : {}),
      };
    }
    case 'listening': {
      // Alternate between picking the meaning and picking the written word.
      const o = options(ctx.rng() < 0.6 ? 'he' : 'en');
      if (!o) return null;
      return { kind: 'choice', item, word, prompt: 'audio', options: o };
    }
    case 'typing':
    case 'spell_audio': {
      const sentence = word.sentences.length ? pick(ctx.rng, word.sentences) : null;
      const cloze =
        sentence && item.type === 'typing' ? makeCloze(sentence, word.lemma, word.forms) : null;
      return {
        kind: 'typing',
        item,
        word,
        accepted: [word.lemma],
        cloze: cloze && cloze.answer.toLowerCase() === word.lemma.toLowerCase() ? cloze : null,
        audioOnly: item.type === 'spell_audio',
      };
    }
    case 'cloze': {
      const sentences = word.sentences;
      let cloze: Cloze | null = null;
      let he = '';
      for (const s of shuffle(ctx.rng, sentences)) {
        cloze = makeCloze(s, word.lemma, word.forms);
        if (cloze) {
          he = s.he;
          break;
        }
      }
      if (!cloze) {
        // No blankable sentence: fall back to typing the word.
        return {
          kind: 'typing',
          item: { ...item, type: 'typing' },
          word,
          accepted: [word.lemma],
          cloze: null,
          audioOnly: false,
        };
      }
      const typed = ctx.crowns(item.lemmaId) >= 2;
      let opts: Options | null = null;
      if (!typed) {
        const ds = chooseDistractors(
          target,
          ctx.pool.filter((p) => !p.lemma.includes(' ')),
          3,
          ctx.rng,
        );
        if (ds.length < 3) return null;
        const answer = cloze.answer;
        const labeled = [target, ...ds].map((w) => ({
          lemmaId: w.lemmaId,
          label:
            w.lemmaId === target.lemmaId
              ? answer
              : matchCase(answer, inflectLike(answer, word.lemma, w.lemma)),
        }));
        const shuffled = shuffle(ctx.rng, labeled);
        opts = {
          options: shuffled,
          correctIndex: shuffled.findIndex((o) => o.lemmaId === target.lemmaId),
        };
      }
      return { kind: 'cloze', item, word, cloze, sentenceHe: he, options: opts };
    }
    case 'match': {
      const ids = item.matchIds ?? [item.lemmaId];
      const words = ids.map((id) => ctx.contents.get(id)).filter((c): c is WordContent => !!c);
      const board = buildMatch(
        words.map((c) => toOptionWord(c, ctx.infos.get(c.lemmaId))),
        ctx.rng,
      );
      if (!board) return null;
      return { kind: 'match', item, words, board };
    }
  }
}
