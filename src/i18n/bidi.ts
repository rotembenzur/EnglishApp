/**
 * The app side of the bidi rules. The rules themselves live in one dependency-free file shared
 * with the push Edge Function (supabase/functions/_shared/bidi.ts); see that file for the details.
 */
export {
  LRM,
  RLM,
  WJ,
  bidi,
  bidiPlain,
  hasHebrew,
  hasLatin,
  isBidiSafe,
  ltr,
  splitBidi,
  stripBidi,
  type BidiSegment,
} from '../../supabase/functions/_shared/bidi.ts';
import { bidi } from '../../supabase/functions/_shared/bidi.ts';

type Fn = (...args: never[]) => unknown;

function mapValue(v: unknown): unknown {
  if (typeof v === 'string') return bidi(v);
  if (typeof v === 'function') {
    const fn = v as Fn;
    const wrapped = (...args: never[]) => mapValue(fn(...args));
    // Keep the arity: the string catalog (catalog.ts) samples functions by it.
    return Object.defineProperty(wrapped, 'length', { value: fn.length });
  }
  if (Array.isArray(v)) return v.map(mapValue);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapValue(x)]));
  }
  return v;
}

/**
 * Passes every string of a strings table, and every string a function in it returns, through
 * bidi(). The UI strings in he.ts are wrapped once with this, so every place that shows them
 * (React text, toasts, aria labels, canvas, titles) gets the same treatment.
 */
export function bidiStrings<T>(table: T): T {
  return mapValue(table) as T;
}
