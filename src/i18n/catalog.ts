/**
 * Every UI string, enumerated: plain strings as they are, and every function called with sample
 * arguments picked by parameter name (a name, a count, an English detail, a signed delta...).
 * Used by the bidi regression test (bidi.test.ts) and the bidi test page (/dev/bidi), which lists
 * the strings that mix directions.
 */
import { levelTitle, rawStrings, relTime, t } from './he';
import { hasHebrew, stripBidi } from './bidi';

export interface CatalogEntry {
  key: string;
  text: string;
}

const NOW = Date.UTC(2026, 9, 13, 12);

/** Sample values per parameter name. A new parameter name needs a line here (the test says so). */
export const SAMPLES: Record<string, unknown[]> = {
  n: [1, 2, 12, 1234],
  name: ['רתם', 'נועה'],
  female: [false, true],
  now: [false, true],
  local: [0, 12],
  hour: [3, 9, 14, 19, 23],
  due: [0, 1, 12],
  fresh: [0, 1, 8],
  min: [1, 4],
  by: [40, 1250],
  c: [7],
  to: [5, 12],
  i: [5],
  known: ['4,200'],
  title: [levelTitle(10)],
  d: ['12.10'],
  delta: [0.4, -0.3],
  detail: ['', '403 BadJwtToken'],
  emoji: ['👋'],
  form: ['went'],
  word: ['decide'],
  rate: ['0.95'],
  s: [24],
  w: [120],
  r: [860],
  got: [3],
  total: [40],
  learned: [0, 7],
  mine: [465],
  theirs: [585],
  result: ['נועה ניצחה בשבוע שעבר'],
  a: ['רתם'],
  b: ['נועה'],
  aOk: [7],
  bOk: [6],
  aSec: ['7.2'],
  bSec: ['8.1'],
  when: [relTime(NOW - 20 * 60_000, NOW)],
  words: ['6,799'],
  sentences: ['20,292'],
  done: [12],
  names: ['Ava / Zoe', 'Serena / Jamie'],
  month: ['אוקטובר'],
  aWins: [0, 3],
  bWins: [2],
  ties: [0, 1],
};

/** Parameter names of a function, from its source. */
export function paramNames(fn: (...a: never[]) => unknown): string[] {
  const src = fn.toString();
  const m = /^(?:function[^(]*)?\(([^)]*)\)|^([\w$]+)\s*=>/.exec(src);
  const list = m?.[1] ?? m?.[2] ?? '';
  return list
    .split(',')
    .map((p) => p.replace(/[:=].*$/, '').trim())
    .filter(Boolean);
}

/** Cartesian product of the samples for these parameters (null when a name has no samples). */
export function sampleArgs(names: string[]): unknown[][] | null {
  let combos: unknown[][] = [[]];
  for (const name of names) {
    const values = SAMPLES[name];
    if (!values) return null;
    combos = combos.flatMap((c) => values.map((v) => [...c, v]));
  }
  return combos;
}

export function catalog(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  const add = (key: string, text: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    out.push({ key, text });
  };
  const walk = (key: string, v: unknown, raw: unknown) => {
    if (typeof v === 'string') add(key, v);
    else if (typeof v === 'function') {
      const names = paramNames(raw as (...a: never[]) => unknown);
      const combos = sampleArgs(names);
      if (!combos) throw new Error(`catalog: no samples for ${key}(${names.join(', ')})`);
      for (const args of combos) {
        const r = (v as (...a: unknown[]) => unknown)(...args);
        if (typeof r === 'string') add(`${key}(${args.map(String).join(', ')})`, r);
      }
    } else if (Array.isArray(v))
      v.forEach((x, i) => walk(`${key}[${i}]`, x, (raw as unknown[])[i]));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v))
        walk(key ? `${key}.${k}` : k, x, (raw as Record<string, unknown>)[k]);
  };
  walk('', t, rawStrings);
  for (const d of [-90_000, -3 * 3600_000, -26 * 3600_000, 5 * 86_400_000, 400 * 86_400_000])
    add(`relTime(${d})`, relTime(NOW + d, NOW));
  return out;
}

/** Strings that put English, digits or signs next to Hebrew: the ones bidi can get wrong. */
export function trickyStrings(): CatalogEntry[] {
  return catalog().filter((e) => {
    const s = stripBidi(e.text);
    return hasHebrew(s) ? /[A-Za-z0-9+−×~%]/.test(s) : /[0-9]/.test(s) && /[A-Za-z]/.test(s);
  });
}
