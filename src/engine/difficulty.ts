/**
 * Static word difficulty model (spec 4.1).
 * d in [0, 100]: 70% log-frequency rank, 20% CEFR correction, 10% minor signals.
 * The same formula is implemented in scripts/build_lemmas.py; keep them in sync
 * (the test suite pins the anchor points from the spec).
 */

export type Band = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'C2+';
export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Piecewise-linear interpolation in log10(rank) space through the spec anchors:
 * rank 1 -> 0, 100 -> 5, 1,000 -> 25, 5,000 -> 50, 20,000 -> 75, 50,000 -> 90, 150,000 -> 100.
 */
const ANCHORS: [number, number][] = [
  [1, 0],
  [100, 5],
  [1000, 25],
  [5000, 50],
  [20000, 75],
  [50000, 90],
  [150000, 100],
];

export function rankToDifficulty(rank: number): number {
  const r = Math.max(1, rank);
  const lr = Math.log10(r);
  const first = ANCHORS[0]!;
  const last = ANCHORS[ANCHORS.length - 1]!;
  if (r <= first[0]) return first[1];
  if (r >= last[0]) return last[1];
  for (let i = 1; i < ANCHORS.length; i++) {
    const [r1, d1] = ANCHORS[i]!;
    if (r <= r1) {
      const [r0, d0] = ANCHORS[i - 1]!;
      const t = (lr - Math.log10(r0)) / (Math.log10(r1) - Math.log10(r0));
      return d0 + t * (d1 - d0);
    }
  }
  return last[1];
}

const CEFR_CENTER: Record<Cefr, number> = { A1: 8, A2: 22, B1: 38, B2: 55, C1: 72, C2: 88 };

export interface DifficultyInputs {
  rank: number;
  cefr?: Cefr | null;
  length: number;
  senses?: number;
  irregular?: boolean;
  abstract?: boolean;
}

/** Combined difficulty 0..100 with the spec weights. */
export function computeDifficulty(inp: DifficultyInputs): number {
  const base = rankToDifficulty(inp.rank);
  // CEFR: pull 20% of the way toward the CEFR band center when known.
  const cefrPart = inp.cefr ? CEFR_CENTER[inp.cefr] : base;
  // Minor signals, each a small +/- shift around the base.
  let minor = base;
  minor += clamp((inp.length - 7) * 0.6, -3, 4);
  if (inp.senses !== undefined) minor += inp.senses >= 6 ? -2 : inp.senses <= 1 ? 2 : 0;
  if (inp.irregular) minor += 1.5;
  if (inp.abstract) minor += 2;
  const d = 0.7 * base + 0.2 * cefrPart + 0.1 * minor;
  return Math.round(clamp(d, 0, 100) * 10) / 10;
}

export function bandOf(d: number): Band {
  if (d < 15) return 'A1';
  if (d < 30) return 'A2';
  if (d < 45) return 'B1';
  if (d < 62) return 'B2';
  if (d < 80) return 'C1';
  if (d < 92) return 'C2';
  return 'C2+';
}

export const BANDS: Band[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'C2+'];

export function bandRange(band: Band): [number, number] {
  switch (band) {
    case 'A1':
      return [0, 15];
    case 'A2':
      return [15, 30];
    case 'B1':
      return [30, 45];
    case 'B2':
      return [45, 62];
    case 'C1':
      return [62, 80];
    case 'C2':
      return [80, 92];
    case 'C2+':
      return [92, 100];
  }
}
