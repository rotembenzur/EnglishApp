/**
 * Audio (spec 5.3). Words: the pre-rendered recording (normal, or the real slow one on a long
 * press), then a dictionary recording (runtime Tier B words), then the system voice. Sentences:
 * the recording (American voice), then the system voice. Anything else (Read mode, notes): the
 * best installed system voice (see voices.ts).
 *
 * Recordings play through one persistent <audio> element. iOS only allows playback after a user
 * gesture, so `unlockAudio()` (called from the first tap) plays a silent clip on that element and
 * primes speech synthesis; later autoplay in the session reuses both.
 */
import { DEFAULT_SETTINGS, type Accent } from '@/data/db';
import { describeRecording, sentenceRecording, wordRecording, type Clip } from './recordings';
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

/** 0.1 s of silence as a WAV, used to unlock the <audio> element inside a gesture. */
function silentWav(): string {
  const rate = 8000;
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function element(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
  }
  return el;
}

let elementUnlocked = false;
let silentUrl = '';

/**
 * Must run inside a user gesture (iOS). Speech is primed once; the <audio> element is retried on
 * later gestures until a play succeeds (iOS counts touchend and click, not always pointerdown).
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
  const a = element();
  if (a && !elementUnlocked && a.paused) {
    try {
      silentUrl ||= silentWav();
      a.src = silentUrl;
      void a.play().then(
        () => (elementUnlocked = true),
        () => undefined,
      );
    } catch {
      // no media support
    }
  }
}

export function isAudioElementUnlocked(): boolean {
  return elementUnlocked;
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
  source: 'recording' | 'dictionary' | 'system';
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

/** Play a Blob on the shared element. Rejects when the element refuses (caller falls back). */
async function playBlob(blob: Blob, rate: number): Promise<void> {
  const a = element();
  if (!a) throw new Error('no audio element');
  stopAudio();
  const url = URL.createObjectURL(blob);
  try {
    a.src = url;
    a.defaultPlaybackRate = rate;
    a.playbackRate = rate;
    await a.play();
    elementUnlocked = true;
    await new Promise<void>((resolve) => {
      const done = () => {
        a.removeEventListener('ended', done);
        a.removeEventListener('error', done);
        a.removeEventListener('pause', done);
        clearTimeout(t);
        resolve();
      };
      stopCurrent = done;
      a.addEventListener('ended', done);
      a.addEventListener('error', done);
      a.addEventListener('pause', done);
      const t = setTimeout(done, Math.max(4000, ((a.duration || 10) / rate) * 1000 + 1500));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
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
  if (await playRecording(word, rec, recordingRate(opts.rate))) return;
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
