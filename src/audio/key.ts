/**
 * Clip keys: the recorded audio for a word or sentence is found by a hash of its text, so the
 * app needs no id mapping and the build (scripts/audio) and the phone always agree.
 */

export function normText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** cyrb53: a fast 53-bit string hash (public domain). */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const KEY_LEN = 11;

/** 11 base-36 characters, fixed width so keys can be concatenated in the index files. */
export function clipKey(text: string): string {
  return cyrb53(normText(text)).toString(36).padStart(KEY_LEN, '0');
}
