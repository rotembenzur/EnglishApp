/**
 * Audio (spec 5.3). Words: the pre-rendered recording (normal, or the real slow one on a long
 * press), then a dictionary recording (runtime Tier B words), then the system voice. Sentences:
 * the recording (American voice), then the system voice. Anything else (Read mode, notes): the
 * best installed system voice (see voices.ts).
 *
 * Recordings are decoded and played through the Web Audio API (an AudioBufferSourceNode), not an
 * <audio> element, so iOS shows no "Now Playing" media panel. iOS only allows audio after a user
 * gesture, so `unlockAudio()` (called from the first taps) resumes the AudioContext with a silent
 * buffer and primes speech synthesis; later autoplay in the session reuses both. Rates other than
 * 1 (speed slider, slow long press without a slow clip) are time-stretched with the pitch kept.
 *
 * Never silent (0.10.1): every step that can hang on iOS (Cache Storage, fetch, decoding, an
 * element's play(), speech synthesis) has a deadline and falls through to the next source; the
 * AudioContext is replaced inside the next tap once it may have gone silent (the app went to the
 * background, iOS interrupted it, a play did not start); speech synthesis is resumed and flushed
 * before every utterance and retried once when it does not start. A newer play supersedes one
 * still looking up its clip, so a late lookup never plays over it.
 */
import { DEFAULT_SETTINGS, type Accent } from '@/data/db';
import { generatedSentence, generatedWord } from './generated';
import { describeRecording, sentenceRecording, wordRecording, type Clip } from './recordings';
import { stretch } from './stretch';
import { chooseVoice } from './voices';

let voices: SpeechSynthesisVoice[] = [];
let unlocked = false;
let el: HTMLAudioElement | null = null;
let stopCurrent: (() => void) | null = null;
const voiceListeners = new Set<(v: SpeechSynthesisVoice[]) => void>();

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

let watching = false;
function watchVoices(s: SpeechSynthesis) {
  if (watching) return;
  watching = true;
  // iOS fills the list late and changes it when a voice is downloaded in Settings.
  s.addEventListener('voiceschanged', () => {
    voices = s.getVoices();
    for (const cb of voiceListeners) cb(voices);
  });
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  watchVoices(s);
  voices = s.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const done = () => {
      voices = s.getVoices();
      resolve(voices);
    };
    s.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Subscribe to voice list changes; returns the unsubscribe function. */
export function onVoicesChanged(cb: (v: SpeechSynthesisVoice[]) => void): () => void {
  voiceListeners.add(cb);
  return () => voiceListeners.delete(cb);
}

export function currentVoices(): SpeechSynthesisVoice[] {
  return voices;
}

export function pickVoice(accent: Accent, voiceURI?: string): SpeechSynthesisVoice | undefined {
  return chooseVoice(voices, accent, voiceURI);
}

let ctx: AudioContext | null = null;
let ctxUnlocked = false;
/**
 * The context may play silently even while it reports "running" (iOS after the background, a call,
 * Siri or other audio). It is replaced inside the next tap, the only place iOS lets a new one start.
 */
let ctxStale = false;
/** Last time the context made a sound; one idle this long is replaced on the next tap anyway. */
let ctxUsedAt = 0;
const IDLE_MS = 120_000;

/** Resolve to null after `ms` instead of hanging. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((r) => (t = setTimeout(() => r(null), ms))),
  ]).finally(() => clearTimeout(t));
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** iOS 17+: play like media, so the silent switch does not mute recordings (no media panel). */
function playbackSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session && session.type !== 'playback') session.type = 'playback';
}

function audioContext(fresh = false): AudioContext | null {
  if (ctx && !fresh && ctx.state !== 'closed') return ctx;
  const AC =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return null;
  playbackSession();
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  const c = new AC();
  ctx = c;
  ctxUnlocked = false;
  ctxStale = false;
  let ran = false;
  // We never suspend it ourselves: leaving "running" means iOS interrupted it.
  c.addEventListener?.('statechange', () => {
    if (c !== ctx) return;
    if (c.state === 'running') ran = true;
    else if (ran) ctxStale = true;
  });
  return c;
}

/** The shared context (sound effects use it too, so iOS juggles one context, not two). */
export function sharedAudioContext(): AudioContext | null {
  const c = audioContext();
  if (c && c.state !== 'running') void c.resume().catch(() => undefined);
  ctxUsedAt = Date.now();
  return c;
}

/** Resume within `ms`; iOS can leave a context "suspended" or "interrupted" after a call, a lock
 * screen or other audio, and `resume()` may never settle. */
async function resumeWithin(c: AudioContext, ms: number): Promise<boolean> {
  if (c.state === 'running') return true;
  await Promise.race([c.resume().catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);
  return (c.state as string) === 'running';
}

/** A running context for the next play: resume it, else replace it once. */
async function runningContext(): Promise<AudioContext | null> {
  playbackSession();
  const c = audioContext();
  if (!c) return null;
  if (await resumeWithin(c, 600)) return c;
  const n = audioContext(true);
  return n && (await resumeWithin(n, 600)) ? n : null;
}

/** The app went to the background: the context may come back silent, so the next tap replaces
 * it. */
export function audioHidden(): void {
  if (ctx) ctxStale = true;
}

/** When the app comes back to the foreground. */
export function resumeAudio(): void {
  playbackSession();
  // iOS can leave synthesis paused with utterances queued behind it; nothing speaks until then.
  const s = synth();
  if (s) {
    if (s.speaking || s.pending) s.cancel();
    s.resume();
  }
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed')
    void ctx.resume().catch(() => undefined);
}

/** Only for dictionary audio a server streams without CORS (no bytes to decode). */
function element(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  el ??= new Audio();
  return el;
}

/**
 * Must run inside a user gesture (iOS). Speech is primed on the first one and again after the
 * context went stale; a stale context (or one idle for two minutes, which iOS can silence without
 * a sign) is replaced here; the context is resumed with a silent buffer on later gestures until
 * it runs (iOS counts touchend and click, not always pointerdown).
 */
export function unlockAudio(): void {
  const stale =
    ctxStale || (!!ctx && !stopCurrent && ctxUsedAt > 0 && Date.now() - ctxUsedAt > IDLE_MS);
  if (!unlocked || stale) {
    unlocked = true;
    const s = synth();
    if (s && !s.speaking) {
      s.resume();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      s.speak(u);
    }
  }
  playbackSession();
  const c = audioContext(stale);
  if (stale) ctxUsedAt = Date.now();
  if (c && (!ctxUnlocked || c.state !== 'running')) {
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
      void c.resume().then(
        () => (ctxUnlocked = c.state === 'running'),
        () => undefined,
      );
    } catch {
      // no Web Audio
    }
  }
}

export function isAudioElementUnlocked(): boolean {
  return ctxUnlocked;
}

export function isAudioUnlocked(): boolean {
  return unlocked;
}

export interface SpeakOpts {
  accent: Accent;
  voiceURI?: string;
  rate: number;
  slow?: boolean;
}

/** One entry per play, newest last: what the user heard (for "report a problem"). */
export interface PlayedClip {
  text: string;
  /** generated: rendered for a saved text (src/audio/textAudio.ts). */
  source: 'recording' | 'generated' | 'dictionary' | 'system';
  voice: string;
  slow: boolean;
  at: number;
  key?: string;
  file?: string;
}

const played: PlayedClip[] = [];

function logPlay(p: Omit<PlayedClip, 'at'>): void {
  played.push({ ...p, at: Date.now() });
  if (played.length > 30) played.shift();
}

export function recentPlays(): readonly PlayedClip[] {
  return played;
}

/** Bumped by every play and every stop: a play whose id is no longer current stops quietly. */
let playId = 0;

/** Stop whatever plays; true when speech synthesis was cancelled. */
function halt(): boolean {
  const s = synth();
  const cancelled = !!s && (s.speaking || s.pending);
  if (cancelled) s.cancel();
  if (stopCurrent) {
    stopCurrent();
    stopCurrent = null;
  }
  if (el && !el.paused) el.pause();
  return cancelled;
}

export function stopAudio(): void {
  playId++;
  halt();
}

/** Start a play: stops the one before it and returns this play's id. */
function begin(): number {
  stopAudio();
  return playId;
}

/** The speed slider is relative to its default for recordings: the default plays them as made. */
export function recordingRate(rate: number): number {
  const r = rate / DEFAULT_SETTINGS.speechRate;
  return Math.abs(r - 1) < 0.01 ? 1 : Math.min(1.3, Math.max(0.7, r));
}

/**
 * Decode a clip and play it through Web Audio. False when a newer play took over first; rejects
 * when it cannot play (the caller falls back).
 */
async function playBlob(blob: Blob, rate: number, id: number): Promise<boolean> {
  const c = await runningContext();
  if (id !== playId) return false;
  if (!c) throw new Error('audio context not running');
  // Safari can leave decodeAudioData unsettled after an interruption.
  const decoded = await within(
    blob.arrayBuffer().then((b) => c.decodeAudioData(b)),
    4000,
  );
  if (id !== playId) return false;
  if (!decoded) {
    ctxStale = true;
    throw new Error('audio did not decode');
  }
  let buffer = decoded;
  if (Math.abs(rate - 1) >= 0.005) {
    const data = stretch(decoded.getChannelData(0), rate, decoded.sampleRate);
    buffer = c.createBuffer(1, data.length, decoded.sampleRate);
    buffer.copyToChannel(data, 0);
  }
  halt();
  ctxUsedAt = Date.now();
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(c.destination);
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(t);
      clearTimeout(stall);
      src.onended = null;
      if (stopCurrent === stop) stopCurrent = null;
      resolve();
    };
    const stop = () => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
      done();
    };
    stopCurrent = stop;
    src.onended = done;
    const t = setTimeout(done, buffer.duration * 1000 + 1500);
    // Silent failure guard: if the clock does not move, the context is stuck; the caller then
    // speaks with the system voice instead, and the next tap replaces the context.
    const t0 = c.currentTime;
    const stall = setTimeout(() => {
      if (c.state === 'running' && c.currentTime - t0 > 0.05) return;
      try {
        src.stop();
      } catch {
        // never started
      }
      clearTimeout(t);
      src.onended = null;
      if (stopCurrent === stop) stopCurrent = null;
      ctxStale = true;
      reject(new Error('audio did not start'));
    }, 700);
    src.start();
  });
  ctxUnlocked = true;
  return true;
}

/** The system voice. */
export function speak(text: string, opts: SpeakOpts): Promise<void> {
  return say(text, opts, begin());
}

/** Speak with the system voice; one retry when iOS swallows the utterance (it never starts). */
async function say(text: string, opts: SpeakOpts, id: number): Promise<void> {
  const s = synth();
  if (!s) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (id !== playId) return;
    const cancelled = halt();
    // iOS can leave synthesis paused (after the background or a call): queued speech stays silent.
    s.resume();
    // Right after cancel() iOS may drop the next utterance.
    if (attempt || cancelled) await wait(attempt ? 250 : 120);
    if (id !== playId) return;
    const outcome = await utter(s, text, opts, id, attempt === 0);
    if (outcome !== 'stuck') return;
  }
}

function utter(
  s: SpeechSynthesis,
  text: string,
  opts: SpeakOpts,
  id: number,
  log: boolean,
): Promise<'done' | 'stuck'> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(opts.accent, opts.voiceURI);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = opts.accent === 'us' ? 'en-US' : 'en-GB';
    }
    u.rate = opts.slow ? Math.max(0.5, opts.rate * 0.75) : opts.rate;
    let settled = false;
    let hang: ReturnType<typeof setTimeout> | undefined;
    const finish = (o: 'done' | 'stuck') => {
      if (settled) return;
      settled = true;
      clearTimeout(noStart);
      clearTimeout(hang);
      resolve(o);
    };
    u.onstart = () => {
      clearTimeout(noStart);
      // Safari sometimes never fires onend; do not hang callers.
      hang = setTimeout(() => finish('done'), Math.min(30000, 1500 + (text.length * 120) / u.rate));
    };
    u.onend = () => finish('done');
    u.onerror = () => finish('done');
    // Nothing at all within 3 seconds: synthesis is stuck; flush it and try again.
    const noStart = setTimeout(() => {
      if (id === playId) s.cancel();
      finish('stuck');
    }, 3000);
    s.speak(u);
    if (log) logPlay({ text, source: 'system', voice: v?.name ?? u.lang, slow: !!opts.slow });
  });
}

/** True when the chain is over: the clip played, or a newer play took over. */
async function playRecording(
  text: string,
  rec: { blob: Blob; clip: Clip } | null,
  rate: number,
  id: number,
): Promise<boolean> {
  if (!rec) return false;
  try {
    if (!(await playBlob(rec.blob, rate, id))) return true;
    logPlay({
      text,
      source: 'recording',
      voice: rec.clip.voice,
      slow: rec.clip.slow,
      key: rec.clip.key,
      file: rec.clip.file,
    });
    return true;
  } catch {
    return false;
  }
}

/** A clip rendered for a saved text (same voices as the recordings). */
async function playGenerated(
  text: string,
  clip: { blob: Blob; key: string } | null,
  voice: string,
  rate: number,
  slow: boolean,
  id: number,
): Promise<boolean> {
  if (!clip) return false;
  try {
    if (!(await playBlob(clip.blob, rate, id))) return true;
    logPlay({ text, source: 'generated', voice, slow, key: clip.key });
    return true;
  } catch {
    return false;
  }
}

/** Dictionary audio (Tier B): fetched as a Blob when the server allows CORS, else streamed. */
async function playDictionary(
  text: string,
  url: string,
  rate: number,
  id: number,
): Promise<boolean> {
  try {
    const res = await within(fetch(url, { mode: 'cors' }), 4000);
    if (id !== playId) return true;
    const blob = res?.ok ? await within(res.blob(), 4000) : null;
    if (id !== playId) return true;
    if (blob) {
      if (!(await playBlob(blob, rate, id))) return true;
      logPlay({ text, source: 'dictionary', voice: 'dictionary', slow: false, file: url });
      return true;
    }
  } catch {
    // no CORS, offline or undecodable: try the element directly below
  }
  if (id !== playId) return true;
  const a = element();
  if (!a) return false;
  try {
    halt();
    a.src = url;
    a.playbackRate = rate;
    // play() can stay pending on a stalled network.
    const started = await within(
      a.play().then(() => true),
      3000,
    );
    if (!started) {
      a.pause();
      return id !== playId;
    }
    await new Promise<void>((resolve) => {
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.onpause = () => resolve();
      setTimeout(resolve, 5000);
    });
    logPlay({ text, source: 'dictionary', voice: 'dictionary', slow: false, file: url });
    return true;
  } catch {
    return false;
  }
}

/** Play a word or curated item. */
export async function playWord(
  word: string,
  urls: { us?: string; uk?: string },
  opts: SpeakOpts,
): Promise<void> {
  const id = begin();
  const slow = !!opts.slow;
  const rec = await within(wordRecording(word, opts.accent, slow), 4000);
  if (id !== playId) return;
  const rate = recordingRate(opts.rate) * (rec?.clip.stretch ? 0.75 : 1);
  if (await playRecording(word, rec, rate, id)) return;
  const gen = await within(generatedWord(word, opts.accent), 3000);
  if (id !== playId) return;
  const genRate = recordingRate(opts.rate) * (slow ? 0.75 : 1);
  if (await playGenerated(word, gen, gen?.voice ?? opts.accent, genRate, slow, id)) return;
  const url = opts.accent === 'uk' ? (urls.uk ?? urls.us) : (urls.us ?? urls.uk);
  if (url && !slow && (await playDictionary(word, url, Math.min(1, Math.max(0.75, opts.rate)), id)))
    return;
  await say(word, opts, id);
}

/** Play an example sentence (or any text: without a recording it is the system voice). */
export async function playSentence(text: string, opts: SpeakOpts): Promise<void> {
  const id = begin();
  const rec = await within(sentenceRecording(text), 5000);
  if (id !== playId) return;
  // A long press slows the recording down (pitch kept) rather than switching voices.
  const rate = recordingRate(opts.rate) * (opts.slow ? 0.75 : 1);
  if (await playRecording(text, rec, rate, id)) return;
  const gen = await within(generatedSentence(text), 3000);
  if (id !== playId) return;
  if (await playGenerated(text, gen, 'us', rate, !!opts.slow, id)) return;
  await say(text, opts, id);
}

/**
 * What the user heard for any of these texts, newest first; else what would play now.
 * Attached to "report a problem" so a bad clip can be found and re-rendered.
 */
export async function clipForReport(
  word: string,
  sentences: string[],
  accent: Accent,
): Promise<Record<string, unknown> | null> {
  const texts = new Set([word, ...sentences]);
  const last = [...played].reverse().find((p) => texts.has(p.text));
  if (last) return { ...last, heard: true };
  const rec = await describeRecording(word, 'word', accent).catch(() => null);
  if (rec) return { text: word, source: 'recording', ...rec, heard: false };
  return { text: word, source: 'system', voice: pickVoice(accent)?.name ?? null, heard: false };
}

// Read-only hook for the e2e tests and for debugging on a phone (Safari Web Inspector).
if (typeof window !== 'undefined') {
  (window as Window & { __lexbitesAudio?: unknown }).__lexbitesAudio = { recentPlays };
}
