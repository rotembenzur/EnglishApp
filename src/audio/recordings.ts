/**
 * Pre-rendered recordings (Kokoro, built by scripts/audio and the Audio workflow).
 *
 * Layout under `<base>audio/`: `index.json` (the root, re-checked when online), content-addressed
 * indexes for each voice's word packs and for the sentence clips, `w/<pack>` (all word and
 * curated-item clips of one content shard, normal and slow, concatenated) and `s/<key>.m4a`.
 *
 * Word packs of the chosen accent are downloaded in the background into Cache Storage, so every
 * word plays offline. Sentence clips are cached on play and prefetched for the next session.
 * Playback reads Blobs (slices of a pack, or a whole sentence file) and never streams a URL, so
 * Safari's range requests never meet the cache: it works offline in the home screen app.
 */
import { create } from 'zustand';
import type { Accent } from '@/data/db';
import { clipKey, KEY_LEN } from './key';

const ROOT = `${import.meta.env.BASE_URL}audio/`;
const INDEX_CACHE = 'lexbites-audio-index';
const WORD_CACHE = 'lexbites-audio-words';
const SENTENCE_CACHE = 'lexbites-audio-sentences';
/** About 60 MB of sentence clips; the oldest go first. */
const SENTENCE_CACHE_MAX = 3000;

export interface RootIndex {
  v: number;
  pipeline: number;
  builtAt: string;
  voices: { us: string; uk: string };
  w: { us: string; uk: string };
  s: string;
  bytes: number;
}

interface PackIndex {
  packs: { f: string; k: string; l: number[] }[];
}

interface WordLoc {
  pack: string;
  n?: [number, number];
  s?: [number, number];
}

export interface Clip {
  key: string;
  /** Pack or sentence file name, for reports. */
  file: string;
  voice: string;
  slow: boolean;
  /** Slow requested but only the normal clip exists: play it slower. */
  stretch?: boolean;
}

interface State {
  root: RootIndex | null;
  /** Word packs of the chosen accent stored for offline use. */
  packsReady: number;
  packsTotal: number;
  words: number;
  sentences: number;
  syncing: boolean;
}

export const useRecordings = create<State>(() => ({
  root: null,
  packsReady: 0,
  packsTotal: 0,
  words: 0,
  sentences: 0,
  syncing: false,
}));

const hasCaches = () => typeof caches !== 'undefined';
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** A fetch that gives up after `ms` (a weak connection can leave a request open for minutes). */
async function fetchWithin(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const ac = typeof AbortController === 'undefined' ? null : new AbortController();
  const t = setTimeout(() => ac?.abort(), ms);
  try {
    return await fetch(url, ac ? { ...init, signal: ac.signal } : init);
  } finally {
    clearTimeout(t);
  }
}

async function readJson<T>(res: Response | undefined | null): Promise<T | null> {
  if (!res || !res.ok) return null;
  try {
    return (await res.json()) as T;
  } catch {
    // An HTML fallback page (dev server, 404 bounce) is not an index.
    return null;
  }
}

/** Network first for the root (it changes on every audio update), cache as the offline copy. */
async function fetchRoot(): Promise<RootIndex | null> {
  const url = `${ROOT}index.json`;
  if (online()) {
    try {
      const res = await fetchWithin(url, 5000, { cache: 'no-cache' });
      const copy = res.clone();
      const root = await readJson<RootIndex>(res);
      if (root?.v === 1 && root.w && root.s) {
        if (hasCaches()) await (await caches.open(INDEX_CACHE)).put(url, copy);
        return root;
      }
    } catch {
      // offline or blocked: fall through to the stored copy
    }
  }
  if (!hasCaches()) return null;
  const root = await readJson<RootIndex>(await caches.match(url, { cacheName: INDEX_CACHE }));
  return root?.v === 1 ? root : null;
}

/** Content-addressed files never change: cache first. */
async function fetchImmutableJson<T>(name: string): Promise<T | null> {
  const url = `${ROOT}${name}`;
  if (hasCaches()) {
    const hit = await readJson<T>(await caches.match(url, { cacheName: INDEX_CACHE }));
    if (hit) return hit;
  }
  if (!online()) return null;
  try {
    const res = await fetchWithin(url, 15000);
    const copy = res.clone();
    const data = await readJson<T>(res);
    if (data && hasCaches()) await (await caches.open(INDEX_CACHE)).put(url, copy);
    return data;
  } catch {
    return null;
  }
}

let rootPromise: Promise<RootIndex | null> | null = null;
const wordIndex = new Map<string, Promise<Map<string, WordLoc> | null>>();
let sentencePromise: Promise<Set<string> | null> | null = null;
let sentenceFile = '';

export function loadRecordings(force = false): Promise<RootIndex | null> {
  if (!rootPromise || force) {
    const p: Promise<RootIndex | null> = fetchRoot().then((root) => {
      const prev = useRecordings.getState().root;
      if (
        root &&
        prev &&
        (prev.w.us !== root.w.us || prev.w.uk !== root.w.uk || prev.s !== root.s)
      ) {
        wordIndex.clear();
        sentencePromise = null;
      }
      useRecordings.setState({ root });
      // Not reachable now (offline at start, say): try again on the next play.
      if (!root && rootPromise === p) rootPromise = null;
      return root;
    });
    rootPromise = p;
    return p;
  }
  return rootPromise;
}

function parsePacks(idx: PackIndex): Map<string, WordLoc> {
  const map = new Map<string, WordLoc>();
  for (const p of idx.packs) {
    let off = 0;
    for (let i = 0; i * KEY_LEN < p.k.length; i++) {
      const key = p.k.slice(i * KEY_LEN, (i + 1) * KEY_LEN);
      const ln = p.l[2 * i] ?? 0;
      const ls = p.l[2 * i + 1] ?? 0;
      const loc: WordLoc = { pack: p.f };
      if (ln) loc.n = [off, ln];
      off += ln;
      if (ls) loc.s = [off, ls];
      off += ls;
      map.set(key, loc);
    }
  }
  return map;
}

export { parsePacks as _parsePacks };

async function wordsFor(accent: Accent): Promise<Map<string, WordLoc> | null> {
  const root = await loadRecordings();
  if (!root) return null;
  const name = root.w[accent];
  let p = wordIndex.get(name);
  if (!p) {
    p = fetchImmutableJson<PackIndex>(name).then((idx) => (idx ? parsePacks(idx) : null));
    wordIndex.set(name, p);
    void p.then((m) => {
      if (!m) wordIndex.delete(name);
    });
  }
  return p;
}

async function sentenceKeys(): Promise<Set<string> | null> {
  const root = await loadRecordings();
  if (!root) return null;
  if (!sentencePromise || sentenceFile !== root.s) {
    sentenceFile = root.s;
    sentencePromise = fetchImmutableJson<{ k: string }>(root.s).then((d) => {
      if (!d) {
        sentencePromise = null;
        return null;
      }
      const set = new Set<string>();
      for (let i = 0; i < d.k.length; i += KEY_LEN) set.add(d.k.slice(i, i + KEY_LEN));
      useRecordings.setState({ sentences: set.size });
      return set;
    });
  }
  return sentencePromise;
}

/** Resolve within `ms` or give up (playback must never wait long on an index). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

// ------------------------------------------------------------------------------------------------
// Blobs

const packBlobs = new Map<string, Blob>();

async function cachedPack(file: string): Promise<Blob | null> {
  const mem = packBlobs.get(file);
  if (mem) return mem;
  if (!hasCaches()) return null;
  const res = await caches.match(`${ROOT}w/${file}`, { cacheName: WORD_CACHE });
  if (!res) return null;
  const blob = await res.blob();
  packBlobs.set(file, blob);
  if (packBlobs.size > 4) packBlobs.delete(packBlobs.keys().next().value!);
  return blob;
}

async function packSlice(file: string, [off, len]: [number, number]): Promise<Blob | null> {
  const blob = await cachedPack(file);
  if (blob) return blob.slice(off, off + len, 'audio/mp4');
  if (!online()) return null;
  // Not downloaded yet: fetch just this clip.
  const res = await fetch(`${ROOT}w/${file}`, {
    headers: { Range: `bytes=${off}-${off + len - 1}` },
  });
  if (res.status === 206) return new Blob([await res.arrayBuffer()], { type: 'audio/mp4' });
  if (res.ok) {
    const whole = await res.blob();
    if (hasCaches())
      await (await caches.open(WORD_CACHE)).put(`${ROOT}w/${file}`, new Response(whole));
    return whole.slice(off, off + len, 'audio/mp4');
  }
  return null;
}

/** The recorded clip of a word or curated item, if there is one. */
export async function wordRecording(
  text: string,
  accent: Accent,
  slow: boolean,
): Promise<{ blob: Blob; clip: Clip } | null> {
  const words = await within(wordsFor(accent), 3000);
  const key = clipKey(text);
  const loc =
    words?.get(key) ??
    (text !== text.toLowerCase() ? words?.get(clipKey(text.toLowerCase())) : undefined);
  // No confirmed slow clip: the normal one, played slower by the caller (`stretch`).
  const part = loc && (slow ? (loc.s ?? loc.n) : loc.n);
  if (!loc || !part) return null;
  const blob = await packSlice(loc.pack, part);
  if (!blob) return null;
  const root = useRecordings.getState().root;
  const stretch = slow && !loc.s;
  return {
    blob,
    clip: {
      key,
      file: loc.pack,
      voice: root?.voices[accent] ?? accent,
      slow,
      ...(stretch ? { stretch } : {}),
    },
  };
}

function sentenceUrl(key: string): string {
  const v = useRecordings.getState().root?.pipeline ?? 1;
  return `${ROOT}s/${key}.m4a?v=${v}`;
}

async function trimSentenceCache(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - SENTENCE_CACHE_MAX)))
    await cache.delete(req);
}

async function sentenceBlob(key: string): Promise<Blob | null> {
  const url = sentenceUrl(key);
  const cache = hasCaches() ? await caches.open(SENTENCE_CACHE) : null;
  const hit = await cache?.match(url);
  if (hit) return hit.blob();
  if (!online()) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (cache) {
    await cache.put(url, new Response(blob, { headers: { 'content-type': 'audio/mp4' } }));
    void trimSentenceCache(cache);
  }
  return blob;
}

/**
 * Which clip keys have a recording: sentences (American voice) and the accent's words. Null for a
 * kind whose index cannot be loaded (offline before the first download).
 */
export async function recordedKeys(
  accent: Accent,
): Promise<{ sentences: Set<string> | null; words: Set<string> | null }> {
  const [sentences, words] = await Promise.all([
    sentenceKeys().catch(() => null),
    wordsFor(accent).catch(() => null),
  ]);
  return { sentences, words: words ? new Set(words.keys()) : null };
}

/** Load the indexes ahead of the first tap, so the first word played is never a timeout. */
export function warmRecordings(accent: Accent): void {
  void sentenceKeys().catch(() => null);
  void wordsFor(accent).catch(() => null);
}

/** The recorded clip of an example sentence (American voice), if there is one. */
export async function sentenceRecording(text: string): Promise<{ blob: Blob; clip: Clip } | null> {
  const keys = await within(sentenceKeys(), 3000);
  const key = clipKey(text);
  if (!keys?.has(key)) return null;
  const blob = await sentenceBlob(key);
  if (!blob) return null;
  const root = useRecordings.getState().root;
  return { blob, clip: { key, file: `s/${key}.m4a`, voice: root?.voices.us ?? 'us', slow: false } };
}

/** What would play for a text, without playing it (for reports). */
export async function describeRecording(
  text: string,
  kind: 'word' | 'sentence',
  accent: Accent,
): Promise<Clip | null> {
  const key = clipKey(text);
  const root = await within(loadRecordings(), 1500);
  if (!root) return null;
  if (kind === 'sentence') {
    const keys = await within(sentenceKeys(), 1500);
    return keys?.has(key)
      ? { key, file: `s/${key}.m4a`, voice: root.voices.us, slow: false }
      : null;
  }
  const loc = (await within(wordsFor(accent), 1500))?.get(key);
  return loc ? { key, file: loc.pack, voice: root.voices[accent], slow: false } : null;
}

// ------------------------------------------------------------------------------------------------
// Offline: word packs and sentence prefetch

let syncRun = 0;

/** Download every word pack of the accent that is not stored yet; drop stale ones. */
export async function syncWordPacks(accent: Accent): Promise<void> {
  if (!hasCaches()) return;
  const run = ++syncRun;
  const root = await loadRecordings();
  if (!root || run !== syncRun) return;
  void sentenceKeys(); // also fills the sentence count shown in settings
  const idx = await fetchImmutableJson<PackIndex>(root.w[accent]);
  if (!idx || run !== syncRun) return;
  const words = idx.packs.reduce((n, p) => n + p.k.length / KEY_LEN, 0);
  const cache = await caches.open(WORD_CACHE);
  const stored = new Set(
    (await cache.keys()).map((r) => new URL(r.url).pathname.split('/').pop()!),
  );
  const wanted = idx.packs.map((p) => p.f);
  let ready = wanted.filter((f) => stored.has(f)).length;
  useRecordings.setState({ packsReady: ready, packsTotal: wanted.length, words, syncing: true });
  try {
    try {
      await navigator.storage?.persist?.();
    } catch {
      // not supported
    }
    for (const f of wanted) {
      if (stored.has(f)) continue;
      if (run !== syncRun || !online()) return;
      const res = await fetch(`${ROOT}w/${f}`);
      if (res.status !== 200) continue;
      await cache.put(`${ROOT}w/${f}`, res);
      ready++;
      useRecordings.setState({ packsReady: ready });
    }
    // Stale packs of this accent (replaced by a newer build) are removed.
    const prefix = `w-${accent}-`;
    for (const req of await cache.keys()) {
      const f = new URL(req.url).pathname.split('/').pop()!;
      if (f.startsWith(prefix) && !wanted.includes(f)) await cache.delete(req);
    }
  } finally {
    if (run === syncRun) useRecordings.setState({ syncing: false });
  }
}

/** Store the sentence clips of upcoming words, so the next session plays them offline. */
export async function prefetchSentences(texts: string[]): Promise<number> {
  if (!hasCaches() || !online()) return 0;
  const keys = await sentenceKeys();
  if (!keys) return 0;
  const cache = await caches.open(SENTENCE_CACHE);
  let n = 0;
  for (const t of texts) {
    const key = clipKey(t);
    if (!keys.has(key)) continue;
    const url = sentenceUrl(key);
    if (await cache.match(url)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      await cache.put(url, res);
      n++;
    } catch {
      return n;
    }
  }
  if (n) void trimSentenceCache(cache);
  return n;
}
