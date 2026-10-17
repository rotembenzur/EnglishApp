/**
 * Getting a text ready for practice: content for every marked word (the text's own sentences,
 * translated), the session's word list, and priority in regular sessions for a few days.
 */
import { refreshTextAudio } from '@/audio/textAudio';
import { analyzeText, sentencesWith } from '@/content/text';
import { cachedTranslations, ensureContent, translateAll } from '@/content/gloss';
import { getContent, loadInventory } from '@/content/inventory';
import { boostWords, getText } from '@/data/texts';
import { TEXT_SESSION_WORDS } from '@/engine/session';
import type { Accent } from '@/data/db';
import type { Sentence, UserId, UserWord } from '@/engine/types';

export interface TextPractice {
  lemmaIds: number[];
  sentences: Map<number, Sentence[]>;
  /** Marked words that could not be prepared (no content and no network). */
  skipped: number;
}

/** Words not learned yet go first; then the weakest. */
function practiceOrder(ids: number[], words: Map<number, UserWord>): number[] {
  const score = (id: number) => {
    const w = words.get(id);
    if (!w) return -1;
    if (w.learnedAt) return 1000 + w.card.stability;
    return w.card.stability;
  };
  return [...ids].sort((a, b) => score(a) - score(b));
}

export async function prepareTextPractice(
  textId: string,
  userId: UserId,
  words: Map<number, UserWord>,
  opts: { online?: boolean; accent?: Accent } = {},
): Promise<TextPractice | null> {
  const text = await getText(textId);
  if (!text) return null;
  // The text's natural clips (its sentences are the session's clozes): take what is ready.
  if (opts.online !== false && text.audio && !text.audio.readyAt)
    await refreshTextAudio(textId, opts.accent ?? 'us').catch(() => null);
  const inv = await loadInventory();
  const analysis = analyzeText(text.body, inv.byLemma);
  const ids = practiceOrder(text.marked, words).slice(0, TEXT_SESSION_WORDS);
  const perWord = new Map(ids.map((id) => [id, sentencesWith(analysis, id).slice(0, 3)]));
  const all = [...new Set([...perWord.values()].flatMap((x) => x.map((s) => s.text)))];
  const he = opts.online === false ? await cachedTranslations(all) : await translateAll(all);
  const heOf = new Map(all.map((s, i) => [s, he[i] ?? '']));
  const sentences = new Map<number, Sentence[]>();
  const ready: number[] = [];
  for (const id of ids) {
    const info = inv.byId.get(id);
    const own = perWord.get(id) ?? [];
    if (!info) continue;
    const ok =
      opts.online === false
        ? !!(await getContent(id, { online: false }))
        : await ensureContent(
            info,
            own.map((s) => s.text),
          );
    if (!ok) continue;
    ready.push(id);
    sentences.set(
      id,
      own.map((s) => ({ en: s.text, he: heOf.get(s.text) ?? '' })),
    );
  }
  if (ready.length) await boostWords(userId, ready);
  return { lemmaIds: ready, sentences, skipped: ids.length - ready.length };
}
