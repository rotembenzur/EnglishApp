/** "Explain the difference" cards for commonly confused words (spec 7.3). */
export interface Confusable {
  id: string;
  words: string[];
  d: number;
  explanation: string;
  tip: string;
  examples: { word: string; en: string; he: string }[];
}

let loading: Promise<Confusable[]> | null = null;

export function loadConfusables(): Promise<Confusable[]> {
  loading ??= fetch(`${import.meta.env.BASE_URL}content/confusables.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Confusable[]>) : []))
    .catch(() => []);
  return loading;
}

export async function confusablesFor(lemma: string): Promise<Confusable[]> {
  const all = await loadConfusables();
  const l = lemma.toLowerCase();
  return all.filter((c) => c.words.some((w) => w.toLowerCase() === l));
}
