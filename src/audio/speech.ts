/**
 * Audio (spec 5.3): dictionary audio files when available (the service worker caches them on
 * first play), otherwise the Web Speech API with the best available English voice.
 * iOS only allows speech after a user gesture: call `unlockAudio()` from the first tap.
 */
import type { Accent } from '@/data/db';

let voices: SpeechSynthesisVoice[] = [];
let unlocked = false;
let current: HTMLAudioElement | null = null;

const PREFERRED: Record<Accent, string[]> = {
  us: [
    'Ava (Premium)',
    'Ava (Enhanced)',
    'Samantha (Enhanced)',
    'Allison (Enhanced)',
    'Zoe (Premium)',
    'Evan (Enhanced)',
    'Samantha',
    'Ava',
    'Allison',
    'Alex',
    'Google US English',
    'Microsoft Aria',
    'Microsoft Jenny',
  ],
  uk: [
    'Daniel (Enhanced)',
    'Serena (Premium)',
    'Serena (Enhanced)',
    'Kate (Enhanced)',
    'Daniel',
    'Serena',
    'Kate',
    'Arthur',
    'Google UK English Female',
    'Google UK English Male',
    'Microsoft Sonia',
    'Microsoft Libby',
  ],
};

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
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

export function englishVoices(): SpeechSynthesisVoice[] {
  return voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
}

/** Pick the best voice for an accent: explicit choice, then known premium voices, then locale. */
export function pickVoice(accent: Accent, voiceURI?: string): SpeechSynthesisVoice | undefined {
  const en = englishVoices();
  if (voiceURI) {
    const v = en.find((x) => x.voiceURI === voiceURI);
    if (v) return v;
  }
  for (const name of PREFERRED[accent]) {
    const v = en.find((x) => x.name === name || x.name.startsWith(name));
    if (v) return v;
  }
  const locale = accent === 'us' ? 'en-us' : 'en-gb';
  return (
    en.find((v) => v.lang.toLowerCase().replace('_', '-') === locale && v.localService) ??
    en.find((v) => v.lang.toLowerCase().replace('_', '-') === locale) ??
    en[0]
  );
}

/** Must run inside a user gesture once per page life (iOS). */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const s = synth();
  if (s) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    s.speak(u);
  }
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

export function stopAudio(): void {
  synth()?.cancel();
  if (current) {
    current.pause();
    current = null;
  }
}

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
    u.rate = opts.slow ? Math.max(0.5, opts.rate * 0.6) : opts.rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    s.speak(u);
    // Safari sometimes never fires onend; do not hang callers.
    setTimeout(resolve, Math.min(15000, 1200 + text.length * 120));
  });
}

/** Play a word: the dictionary recording when present and not slowed, else speech synthesis. */
export async function playWord(
  word: string,
  urls: { us?: string; uk?: string },
  opts: SpeakOpts,
): Promise<void> {
  const url = opts.accent === 'uk' ? (urls.uk ?? urls.us) : (urls.us ?? urls.uk);
  if (url && !opts.slow) {
    try {
      stopAudio();
      const a = new Audio(url);
      current = a;
      a.playbackRate = Math.min(1, Math.max(0.75, opts.rate));
      await a.play();
      await new Promise<void>((resolve) => {
        a.onended = () => resolve();
        a.onerror = () => resolve();
        setTimeout(resolve, 5000);
      });
      return;
    } catch {
      // fall back to synthesis
    }
  }
  await speak(word, opts);
}
