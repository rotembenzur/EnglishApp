/**
 * Clips being prepared for saved texts (src/audio/textAudio.ts), kept apart so every speaker
 * button can show "preparing" without loading the text audio code.
 */
import { create } from 'zustand';
import type { Accent } from '@/data/db';
import { clipKey } from './key';

/** "v:k": voice and clip key. */
export const usePendingClips = create<{ pending: Set<string> }>(() => ({ pending: new Set() }));

export function addPending(ids: Iterable<string>): void {
  usePendingClips.setState((st) => {
    const pending = new Set(st.pending);
    for (const id of ids) pending.add(id);
    return { pending };
  });
}

export function clearPending(ids: Iterable<string>): void {
  usePendingClips.setState((st) => {
    const pending = new Set(st.pending);
    for (const id of ids) pending.delete(id);
    return { pending };
  });
}

/** Is a natural clip for this text on its way (and not stuck)? */
export function isPending(
  pending: ReadonlySet<string>,
  text: string,
  kind: 'word' | 'sentence',
  accent: Accent,
): boolean {
  if (!pending.size) return false;
  if (kind === 'sentence') return pending.has(`us:${clipKey(text)}`);
  return (
    pending.has(`${accent}:${clipKey(text)}`) ||
    pending.has(`${accent}:${clipKey(text.toLowerCase())}`)
  );
}
