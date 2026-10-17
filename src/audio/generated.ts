/**
 * Generated clips: natural Kokoro audio rendered for the texts the user saves (src/audio/
 * textAudio.ts), stored on the phone in Cache Storage so they play offline. Same voices as the
 * recordings; sentences in the American voice, words in the accent's voice.
 *
 * Entries are keyed by voice and clip key (src/audio/key.ts) under a synthetic URL that is never
 * fetched. An in-memory set of stored keys answers "is it here?" without touching the cache.
 */
import type { Accent } from '@/data/db';
import { clipKey } from './key';

const CACHE = 'lexbites-tts-v1';
const BASE = `${import.meta.env.BASE_URL}tts-clip/`;
/** About 150 MB at 48 kbps; the oldest go first. */
const MAX_CLIPS = 8000;

const hasCaches = () => typeof caches !== 'undefined';
const url = (v: Accent, k: string) => `${BASE}${v}/${k}.m4a`;
const id = (v: Accent, k: string) => `${v}:${k}`;

let stored: Promise<Set<string>> | null = null;

/** Keys stored on this phone ("us:<key>"), loaded once. */
export function storedClips(): Promise<Set<string>> {
  stored ??= (async () => {
    const set = new Set<string>();
    if (!hasCaches()) return set;
    try {
      const cache = await caches.open(CACHE);
      for (const req of await cache.keys()) {
        const m = req.url.match(/tts-clip\/(us|uk)\/([0-9a-z]+)\.m4a$/);
        if (m) set.add(`${m[1]}:${m[2]}`);
      }
    } catch {
      // storage blocked: nothing stored
    }
    return set;
  })();
  return stored;
}

export async function hasClip(v: Accent, k: string): Promise<boolean> {
  return (await storedClips()).has(id(v, k));
}

export async function putClip(v: Accent, k: string, data: Uint8Array): Promise<void> {
  if (!hasCaches()) return;
  const cache = await caches.open(CACHE);
  await cache.put(url(v, k), new Response(new Blob([data as BlobPart], { type: 'audio/mp4' })));
  const set = await storedClips();
  set.add(id(v, k));
  if (set.size > MAX_CLIPS) void trim(cache, set);
}

async function trim(cache: Cache, set: Set<string>): Promise<void> {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_CLIPS))) {
    await cache.delete(req);
    const m = req.url.match(/tts-clip\/(us|uk)\/([0-9a-z]+)\.m4a$/);
    if (m) set.delete(`${m[1]}:${m[2]}`);
  }
}

async function getClip(v: Accent, k: string): Promise<Blob | null> {
  if (!hasCaches() || !(await hasClip(v, k))) return null;
  try {
    const res = await caches.match(url(v, k), { cacheName: CACHE });
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** A generated sentence clip (American voice). */
export async function generatedSentence(text: string): Promise<{ blob: Blob; key: string } | null> {
  const key = clipKey(text);
  const blob = await getClip('us', key);
  return blob ? { blob, key } : null;
}

/** A generated word clip: the accent's voice first, then the other one. */
export async function generatedWord(
  word: string,
  accent: Accent,
): Promise<{ blob: Blob; key: string; voice: Accent } | null> {
  const keys = [...new Set([clipKey(word), clipKey(word.toLowerCase())])];
  for (const v of [accent, accent === 'us' ? 'uk' : 'us'] as Accent[])
    for (const key of keys) {
      const blob = await getClip(v, key);
      if (blob) return { blob, key, voice: v };
    }
  return null;
}

export function resetGeneratedForTests(): void {
  stored = null;
}
