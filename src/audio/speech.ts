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
  ctx = new AC();
  return ctx;
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

/** On every tap and when the app comes back to the foreground. */
export function resumeAudio(): void {
  playbackSession();
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
 * Must run inside a user gesture (iOS). Speech is primed once; the AudioContext is resumed with a
 * silent buffer on later gestures until it runs (iOS counts touchend and click, not always
 * pointerdown).
 */
export function unlockAudio(): void {
  if (!unlocked) {
    unlocked = true;
    const s = synth();
    if (s) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      s.speak(u);
    }
  }
  const c = audioContext();
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

export function stopAudio(): void {
  synth()?.cancel();
  if (stopCurrent) {
    stopCurrent();
    stopCurrent = null;
  }
  if (el && !el.paused) el.pause();
}

/** The speed slider is relative to its default for recordings: the default plays them as made. */
export function recordingRate(rate: number): number {
  const r = rate / DEFAULT_SETTINGS.speechRate;
  return Math.abs(r - 1) < 0.01 ? 1 : Math.min(1.3, Math.max(0.7, r));
}

/** Decode a clip and play it through Web Audio. Rejects when it cannot (caller falls back). */
async function playBlob(blob: Blob, rate: number): Promise<void> {
  stopAudio();
  const c = await runningContext();
  if (!c) throw new Error('audio context not running');
  const decoded = await c.decodeAudioData(await blob.arrayBuffer());
  let buffer = decoded;
  if (Math.abs(rate - 1) >= 0.005) {
    const data = stretch(decoded.getChannelData(0), rate, decoded.sampleRate);
    buffer = c.createBuffer(1, data.length, decoded.sampleRate);
    buffer.copyToChannel(data, 0);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(c.destination);
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(t);
      clearTimeout(stall);
      src.onended = null;
      if (stopCurrent === done) stopCurrent = null;
      resolve();
    };
    stopCurrent = () => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
      done();
    };
    src.onended = done;
    const t = setTimeout(done, buffer.duration * 1000 + 1500);
    // Silent failure guard: if the clock does not move, the context is stuck; the caller then
    // speaks with the system voice instead.
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
      if (stopCurrent) stopCurrent = null;
      reject(new Error('audio did not start'));
    }, 700);
    src.start();
  });
  ctxUnlocked = true;
}

/** The system voice. */
export function speak(text: string, opts: SpeakOpts): Promise<void> {
  const s = synth();
  if (!s) return Promise.resolve();
  stopAudio();
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
    u.onend = () => resolve();
    u.onerror = () => resolve();
    s.speak(u);
    logPlay({ text, source: 'system', voice: v?.name ?? u.lang, slow: !!opts.slow });
    // Safari sometimes never fires onend; do not hang callers.
    setTimeout(resolve, Math.min(15000, 1200 + text.length * 120));
  });
}

async function playRecording(
  text: string,
  rec: { blob: Blob; clip: Clip } | null,
  rate: number,
): Promise<boolean> {
  if (!rec) return false;
  try {
    await playBlob(rec.blob, rate);
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
): Promise<boolean> {
  if (!clip) return false;
  try {
    await playBlob(clip.blob, rate);
    logPlay({ text, source: 'generated', voice, slow, key: clip.key });
    return true;
  } catch {
    return false;
  }
}

/** Dictionary audio (Tier B): fetched as a Blob when the server allows CORS, else streamed. */
async function playDictionary(text: string, url: string, rate: number): Promise<boolean> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) {
      await playBlob(await res.blob(), rate);
      logPlay({ text, source: 'dictionary', voice: 'dictionary', slow: false, file: url });
      return true;
    }
  } catch {
    // no CORS or offline: try the element directly below
  }
  const a = element();
  if (!a) return false;
  try {
    stopAudio();
    a.src = url;
    a.playbackRate = rate;
    await a.play();
    await new Promise<void>((resolve) => {
      a.onended = () => resolve();
      a.onerror = () => resolve();
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
  const slow = !!opts.slow;
  const rec = await wordRecording(word, opts.accent, slow).catch(() => null);
  const rate = recordingRate(opts.rate) * (rec?.clip.stretch ? 0.75 : 1);
  if (await playRecording(word, rec, rate)) return;
  const gen = await generatedWord(word, opts.accent).catch(() => null);
  const genRate = recordingRate(opts.rate) * (slow ? 0.75 : 1);
  if (await playGenerated(word, gen, gen?.voice ?? opts.accent, genRate, slow)) return;
  const url = opts.accent === 'uk' ? (urls.uk ?? urls.us) : (urls.us ?? urls.uk);
  if (url && !slow && (await playDictionary(word, url, Math.min(1, Math.max(0.75, opts.rate)))))
    return;
  await speak(word, opts);
}

/** Play an example sentence (or any text: without a recording it is the system voice). */
export async function playSentence(text: string, opts: SpeakOpts): Promise<void> {
  const rec = await sentenceRecording(text).catch(() => null);
  // A long press slows the recording down (pitch kept) rather than switching voices.
  const rate = recordingRate(opts.rate) * (opts.slow ? 0.75 : 1);
  if (await playRecording(text, rec, rate)) return;
  const gen = await generatedSentence(text).catch(() => null);
  if (await playGenerated(text, gen, 'us', rate, !!opts.slow)) return;
  await speak(text, opts);
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
