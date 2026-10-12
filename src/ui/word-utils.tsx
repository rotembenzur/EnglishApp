import type { WordContent } from '@/engine/types';

export function audioUrls(w: WordContent) {
  return {
    ...(w.audioUrl ? { us: w.audioUrl } : {}),
    ...(w.audioUrlUk ? { uk: w.audioUrlUk } : {}),
  };
}

/** Bold the target word (or an inflection) inside a sentence. */
export function highlight(sentence: string, word: Pick<WordContent, 'lemma' | 'forms'>) {
  const stems = [word.lemma, ...(word.forms ?? [])].map((s) => s.toLowerCase());
  const stem =
    word.lemma.length > 4
      ? word.lemma.slice(0, word.lemma.length - 2).toLowerCase()
      : word.lemma.toLowerCase();
  const parts = sentence.split(/(\b[\w'-]+\b)/);
  return parts.map((p, i) => {
    const l = p.toLowerCase();
    const hit = stems.includes(l) || (l.startsWith(stem) && l.length <= word.lemma.length + 4);
    return hit ? (
      <strong key={i} className="text-accent">
        {p}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    );
  });
}
