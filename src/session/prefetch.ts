/**
 * Background prefetch: enriches the next likely new words while the app is idle and online, so
 * sessions start instantly and still have content when the phone goes offline later.
 */
import { prefetchSentences } from '@/audio/recordings';
import { getContents, loadInventory } from '@/content/inventory';
import { createRng } from '@/engine/rng';
import { selectNewWords } from '@/engine/selection';
import { useApp } from '@/state/app';

let running = false;

export async function prefetchUpcoming(count = 24): Promise<void> {
  if (running || typeof navigator === 'undefined' || !navigator.onLine) return;
  const { profile, words } = useApp.getState();
  if (!profile?.ability) return;
  running = true;
  try {
    const inv = await loadInventory();
    const picks = selectNewWords(
      inv.lemmas,
      {
        theta: profile.ability.theta,
        studied: new Set(words.keys()),
        topics: profile.settings.topics,
        disabledKinds: profile.settings.disabledKinds,
      },
      count,
      createRng(Date.now() >>> 0),
      inv.byId,
    );
    const remote = picks.filter((l) => l.tier !== 'A');
    // A few at a time to stay polite with the free APIs.
    for (let i = 0; i < remote.length; i += 4) {
      await getContents(
        remote.slice(i, i + 4).map((l) => l.id),
        { online: true },
      );
    }
    // Recorded sentences of the next session: likely new words and reviews due within a day.
    const soon = Date.now() + 86_400_000;
    const due = [...words.values()]
      .filter((w) => w.card && w.card.due <= soon && w.state !== 'ignored')
      .sort((a, b) => a.card!.due - b.card!.due)
      .slice(0, 30)
      .map((w) => w.lemmaId);
    const contents = await getContents([...picks.map((l) => l.id), ...due], { online: false });
    await prefetchSentences([...contents.values()].flatMap((c) => c.sentences.map((s) => s.en)));
  } finally {
    running = false;
  }
}

export function schedulePrefetch(delayMs = 4000): void {
  const run = () => void prefetchUpcoming();
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(run) : run()), delayMs);
}
