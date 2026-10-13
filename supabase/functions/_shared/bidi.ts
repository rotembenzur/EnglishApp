/**
 * Bidi for Hebrew text that carries English, numbers with units, signs, versions or URLs.
 *
 * One rule set, used everywhere: the app's UI strings (src/i18n/he.ts), React rendering
 * (src/ui/bidi.tsx), the canvas share cards, aria labels, toasts and the push notifications sent by
 * the Edge Function. It has no dependencies so the Deno function and the Vite app import the same
 * file.
 *
 * Plain text is fixed with directional marks only (LRM, RLM) plus a word joiner, never the Unicode
 * 6.3 isolate characters (LRI, RLI, FSI, PDI): WebKit, which renders every page, canvas and
 * notification on the iPhone, does not implement the isolates, while the marks work in every
 * engine. See docs/DECISIONS.md (RTL and bidi).
 *
 * An "LTR run" is a stretch without Hebrew that starts and ends with a Latin letter or a digit,
 * may hold spaces and ASCII punctuation inside (so "iOS 16.4", "40 XP", "403 BadJwtToken" and
 * URLs stay whole), and may start with a sign (+3, −0.4, ×2, ~25). Runs that contain a Latin
 * letter or a sign are wrapped in LRM ... LRM, so the run renders left to right as one unit and
 * the punctuation around it keeps to the Hebrew side. Plain numbers are left alone: they already
 * render correctly in Hebrew text.
 */

export const LRM = '\u200E';
export const RLM = '\u200F';
/** Word joiner: no line break between a Hebrew prefix like "ל־" and the word it is attached to. */
export const WJ = '\u2060';

/** Every bidi control and joiner this module emits or strips. */
const CONTROLS = /[\u200E\u200F\u2060\u202A-\u202E\u2066-\u2069]/g;
const HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const HEBREW_LETTER = /[\u05D0-\u05EA]/;
const LATIN = /[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02AF]/;
const SIGN = /^[+\-−±×~]/;

/*
 * The run pattern. Core characters are Latin letters and digits; inside a run spaces and ASCII
 * punctuation may join them; the run ends on a core character or a unit sign (%, °, +). A leading
 * sign counts only before a digit and only after a space, an opening bracket, a quote, a maqaf or
 * the start: "ל-5" is a prefix with a hyphen, "ב־+0.4" is a prefix with a plus sign.
 */
const CORE = 'A-Za-z0-9\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02AF';
const INNER = `${CORE} .,:;/\\\\_'’&+@#?=%°×*!\\-`;
const RUN = new RegExp(
  `(?:(?<=^|[\\s(\\[{"'״־])[+\\-−±×~](?=[0-9]))?[${CORE}](?:[${INNER}]*[${CORE}%°+])?`,
  'g',
);
/** A Hebrew prefix of one to three letters with its hyphen or maqaf, right before a run. */
const PREFIX = /(?:^|[^\u05D0-\u05EA])([\u05D0-\u05EA]{1,3}[\u05BE-])$/;

export interface BidiSegment {
  /** The text of this piece, without any bidi controls. */
  text: string;
  /** True for an LTR run that must be isolated (it holds a Latin letter or a sign). */
  ltr: boolean;
  /** For an LTR run: a Hebrew prefix with its hyphen ("מ־", "ל-") that must stay glued to it. */
  prefix?: string;
}

/** Removes every bidi control and word joiner (for comparisons, search, clipboard, tests). */
export function stripBidi(s: string): string {
  return s.replace(CONTROLS, '');
}

export function hasHebrew(s: string): boolean {
  return HEBREW.test(s);
}

export function hasLatin(s: string): boolean {
  return LATIN.test(s);
}

function needsIsolation(run: string): boolean {
  return LATIN.test(run) || SIGN.test(run);
}

/**
 * Splits text into Hebrew (or neutral) pieces and LTR runs. Text without Hebrew is one piece,
 * except when it holds a number with Latin letters or a sign ("10,000 XP", "+12 XP"): shown inside
 * the RTL layout such a string would otherwise render as "XP 10,000".
 */
export function splitBidi(input: string): BidiSegment[] {
  const s = stripBidi(input);
  if (!s) return [];
  const hebrew = hasHebrew(s);
  const out: BidiSegment[] = [];
  let last = 0;
  for (const m of s.matchAll(RUN)) {
    const run = m[0];
    const at = m.index ?? 0;
    const isolate = hebrew
      ? needsIsolation(run)
      : (SIGN.test(run) || /[0-9]/.test(run)) && LATIN.test(run);
    if (!isolate) continue;
    let before = s.slice(last, at);
    let prefix: string | undefined;
    const p = PREFIX.exec(before);
    if (p?.[1]) {
      prefix = p[1];
      before = before.slice(0, before.length - prefix.length);
    }
    if (before) out.push({ text: before, ltr: false });
    out.push(prefix ? { text: run, ltr: true, prefix } : { text: run, ltr: true });
    last = at + run.length;
  }
  if (last < s.length) out.push({ text: s.slice(last), ltr: false });
  return out;
}

/** The first character with a strong direction, after the marks are applied. */
function firstStrong(s: string): 'L' | 'R' | null {
  for (const ch of s) {
    if (ch === RLM || HEBREW_LETTER.test(ch) || HEBREW.test(ch)) return 'R';
    if (ch === LRM || LATIN.test(ch)) return 'L';
  }
  return null;
}

/**
 * Hebrew text made safe for any plain-text context: every LTR run with a Latin letter or a sign is
 * wrapped in LRM marks, a Hebrew prefix stays glued to its word, and an RLM leads the string when
 * it would otherwise start with an LTR run (so contexts that pick the direction from the first
 * strong character, like dir="auto" or a notification, still see a Hebrew paragraph).
 * Idempotent: existing marks are stripped first. Text that needs nothing comes back unchanged.
 */
export function bidi(input: string, opts: { rtl?: boolean } = {}): string {
  const segs = splitBidi(input);
  if (!segs.some((x) => x.ltr) && !opts.rtl) return input;
  const body = segs
    .map((x) => (x.ltr ? `${x.prefix ? x.prefix + WJ : ''}${LRM}${x.text}${LRM}` : x.text))
    .join('');
  const hebrew = hasHebrew(body);
  if (opts.rtl && hebrew) return RLM + body;
  return hebrew && firstStrong(body) !== 'R' ? RLM + body : body;
}

/**
 * For contexts with no CSS and no reliable base direction (push notifications, canvas text,
 * document title): like bidi(), and every Hebrew string starts with an RLM.
 */
export function bidiPlain(input: string): string {
  return hasHebrew(input) ? bidi(input, { rtl: true }) : bidi(input);
}

/** Wraps a fragment known to be LTR (a URL, a code, a version) for concatenation into Hebrew. */
export function ltr(fragment: string): string {
  return LRM + stripBidi(fragment) + LRM;
}

/**
 * True when the string is safe to show inside Hebrew text: every LTR run that needs isolation is
 * enclosed in LRM marks, and a Hebrew string does not start with an LTR run. The regression test
 * runs this on every UI string and every notification.
 */
export function isBidiSafe(s: string): boolean {
  return bidi(s) === s;
}
