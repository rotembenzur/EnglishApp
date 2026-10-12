import { loadInventory } from '@/content/inventory';
import { duelWords } from '@/engine/stats';
import type { UserId } from '@/engine/types';
import { db } from '@/data/db';
import { todayKey } from '@/state/app';

/** Today's duel words: identical on both phones (same date, same bundled Tier A inventory). */
export async function duelLemmaIds(date: string): Promise<number[]> {
  const inv = await loadInventory();
  const pool = inv.lemmas
    .filter((l) => l.kind === 'word' && l.tier === 'A' && l.d >= 25 && l.d <= 55)
    .map((l) => l.id);
  return duelWords(date, pool);
}

export async function todayDuel(userId: UserId): Promise<{ correct: number; ms: number } | null> {
  const date = todayKey();
  const ev = await db.events
    .where('userId')
    .equals(userId)
    .filter((e) => e.type === 'duel' && e.payload.date === date)
    .first();
  return ev ? { correct: Number(ev.payload.correct), ms: Number(ev.payload.ms) } : null;
}
