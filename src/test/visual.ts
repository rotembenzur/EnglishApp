/**
 * Test helper: the visual (left to right, as drawn) order of a string under the Unicode
 * Bidirectional Algorithm, using bidi-js. Marks are removed and mirrored brackets swapped, so a
 * test can assert what the eye sees, for example that "(403 BadJwtToken)" is not drawn as
 * "(BadJwtToken 403)".
 */
// @ts-expect-error bidi-js ships no types
import bidiFactory from 'bidi-js';

interface BidiJs {
  getEmbeddingLevels(text: string, dir?: 'ltr' | 'rtl' | 'auto'): unknown;
  getReorderSegments(text: string, levels: unknown): [number, number][];
  getMirroredCharacter(ch: string): string | null;
}
const engine = (bidiFactory as () => BidiJs)();

export function visual(input: string, base: 'ltr' | 'rtl' | 'auto' = 'rtl'): string {
  // bidi-js classifies UTF-16 code units, so an emoji (a surrogate pair) would count as two
  // strong LTR characters. Emoji are neutral: stand in a neutral BMP symbol for each.
  const text = input.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '\u263A');
  const levels = engine.getEmbeddingLevels(text, base) as { levels: Uint8Array };
  // Indices are UTF-16 code units; odd levels draw mirrored brackets.
  const chars = text
    .split('')
    .map((c, i) => ((levels.levels[i] ?? 0) & 1 ? (engine.getMirroredCharacter(c) ?? c) : c));
  for (const [start, end] of engine.getReorderSegments(text, levels)) {
    const slice = chars.slice(start, end + 1).reverse();
    chars.splice(start, slice.length, ...slice);
  }
  return chars.join('').replace(/[\u200E\u200F\u2060]/g, '');
}

/** The paragraph direction bidi-js resolves for "auto" (first strong character). */
export function paragraphDir(input: string): 'ltr' | 'rtl' {
  const text = input.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '\u263A');
  const levels = engine.getEmbeddingLevels(text, 'auto') as { paragraphs: { level: number }[] };
  return (levels.paragraphs[0]?.level ?? 0) % 2 ? 'rtl' : 'ltr';
}
