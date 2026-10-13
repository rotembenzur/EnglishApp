/**
 * System voices (the fallback for text without a recording, such as Read mode and notes).
 *
 * Apple reports quality in the voice URI (`com.apple.voice.premium.en-US.Ava`,
 * `...enhanced...`, `...compact...`); macOS also puts it in the name ("Ava (Premium)"). Novelty
 * voices (Bells, Zarvox...) and the robotic Eloquence voices (Eddy, Grandma...) are never offered.
 * Duplicates (the compact and the enhanced Samantha) are merged into the best one.
 */
import type { Accent } from '@/data/db';

export type VoiceQuality = 'premium' | 'enhanced' | 'standard' | 'compact';

export interface VoiceLike {
  name: string;
  voiceURI: string;
  lang: string;
  localService: boolean;
}

export interface RankedVoice<V extends VoiceLike = VoiceLike> {
  voice: V;
  /** Name without the "(Enhanced)" or "(English (US))" suffix. */
  base: string;
  quality: VoiceQuality;
}

/** Apple's novelty voices and the Eloquence voices (iOS 16+ and macOS). */
export const BLOCKED = new Set(
  [
    'Albert',
    'Bad News',
    'Bahh',
    'Bells',
    'Boing',
    'Bubbles',
    'Cellos',
    'Deranged',
    'Good News',
    'Hysterical',
    'Jester',
    'Organ',
    'Pipe Organ',
    'Superstar',
    'Trinoids',
    'Whisper',
    'Wobble',
    'Zarvox',
    'Fred',
    'Junior',
    'Kathy',
    'Ralph',
    'Princess',
    // Eloquence
    'Eddy',
    'Flo',
    'Grandma',
    'Grandpa',
    'Reed',
    'Rocko',
    'Sandy',
    'Shelley',
  ].map((n) => n.toLowerCase()),
);

/** Best-sounding voices first, by accent; ties in quality are broken by this order. */
export const PREFERRED: Record<Accent, string[]> = {
  us: [
    'Ava',
    'Zoe',
    'Evan',
    'Nathan',
    'Noelle',
    'Joelle',
    'Samantha',
    'Allison',
    'Susan',
    'Tom',
    'Aaron',
    'Nicky',
    'Alex',
  ],
  uk: ['Serena', 'Jamie', 'Stephanie', 'Daniel', 'Kate', 'Arthur', 'Martha', 'Oliver'],
};

const RANK: Record<VoiceQuality, number> = { premium: 3, enhanced: 2, standard: 1, compact: 0 };

export const MAX_CHOICES = 5;

export function baseName(name: string): string {
  return name.replace(/\s*\(.*$/, '').trim();
}

export function localeOf(v: VoiceLike): string {
  return v.lang.toLowerCase().replace('_', '-');
}

export function qualityOf(v: VoiceLike): VoiceQuality {
  const s = `${v.voiceURI} ${v.name}`.toLowerCase();
  if (s.includes('premium')) return 'premium';
  if (s.includes('enhanced')) return 'enhanced';
  if (s.includes('compact')) return 'compact';
  // Neural voices of Edge and Chrome (desktop, Android): close to Apple's enhanced ones.
  if (/\b(natural|neural)\b/.test(s)) return 'enhanced';
  return 'standard';
}

export function isBlocked(v: VoiceLike): boolean {
  return (
    v.voiceURI.toLowerCase().includes('eloquence') || BLOCKED.has(baseName(v.name).toLowerCase())
  );
}

function prefIndex(base: string, accent: Accent): number {
  const i = PREFERRED[accent].findIndex((p) => base.toLowerCase().startsWith(p.toLowerCase()));
  return i < 0 ? 99 : i;
}

/**
 * The voices worth offering for an accent, best first: right locale, no novelty or Eloquence
 * voices, one entry per name (its best quality).
 */
export function rankVoices<V extends VoiceLike>(all: V[], accent: Accent): RankedVoice<V>[] {
  const locale = accent === 'us' ? 'en-us' : 'en-gb';
  const best = new Map<string, RankedVoice<V>>();
  for (const voice of all) {
    if (localeOf(voice) !== locale || isBlocked(voice)) continue;
    const r: RankedVoice<V> = { voice, base: baseName(voice.name), quality: qualityOf(voice) };
    const k = r.base.toLowerCase();
    const prev = best.get(k);
    if (
      !prev ||
      RANK[r.quality] > RANK[prev.quality] ||
      (RANK[r.quality] === RANK[prev.quality] && voice.localService && !prev.voice.localService)
    )
      best.set(k, r);
  }
  return [...best.values()].sort(
    (a, b) =>
      RANK[b.quality] - RANK[a.quality] ||
      prefIndex(a.base, accent) - prefIndex(b.base, accent) ||
      Number(b.voice.localService) - Number(a.voice.localService) ||
      a.base.localeCompare(b.base),
  );
}

/** The short list shown in settings. */
export function voiceChoices<V extends VoiceLike>(all: V[], accent: Accent): RankedVoice<V>[] {
  return rankVoices(all, accent).slice(0, MAX_CHOICES);
}

/** The voice to speak with: the user's choice if it is still offered, else the best one. */
export function chooseVoice<V extends VoiceLike>(
  all: V[],
  accent: Accent,
  voiceURI?: string,
): V | undefined {
  const ranked = rankVoices(all, accent);
  if (voiceURI) {
    const chosen = ranked.find((r) => r.voice.voiceURI === voiceURI);
    if (chosen) return chosen.voice;
  }
  if (ranked[0]) return ranked[0].voice;
  // No voice for this locale at all: any English voice that is not a novelty one.
  return all.find((v) => localeOf(v).startsWith('en') && !isBlocked(v));
}

/** True when an enhanced or premium voice for the accent is installed. */
export function hasGoodVoice(all: VoiceLike[], accent: Accent): boolean {
  return rankVoices(all, accent).some((r) => RANK[r.quality] >= RANK.enhanced);
}
