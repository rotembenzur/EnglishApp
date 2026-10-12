/** Deterministic PRNG utilities so sessions, duels and tests are reproducible. */

export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for sampling. Returns floats in [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, used to seed from strings like "duel:2026-10-12". */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (!items.length) throw new Error('pick from empty list');
  return items[Math.floor(rng() * items.length)]!;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Weighted sample without replacement (Efraimidis-Spirakis). */
export function weightedSample<T>(
  rng: Rng,
  items: readonly T[],
  weight: (x: T) => number,
  k: number,
): T[] {
  const keyed: { item: T; key: number }[] = [];
  for (const item of items) {
    const w = weight(item);
    if (w <= 0) continue;
    keyed.push({ item, key: Math.pow(rng(), 1 / w) });
  }
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map((x) => x.item);
}

/** Local calendar day key YYYY-MM-DD for a timestamp in a given UTC offset (minutes). */
export function dayKey(ts: number, tzOffsetMinutes = 0): string {
  const d = new Date(ts - tzOffsetMinutes * 60000);
  return d.toISOString().slice(0, 10);
}
