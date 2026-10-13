import { describe, expect, it } from 'vitest';
import {
  chooseVoice,
  hasGoodVoice,
  qualityOf,
  rankVoices,
  voiceChoices,
  type VoiceLike,
} from './voices';

const v = (name: string, voiceURI: string, lang = 'en-US', localService = true): VoiceLike => ({
  name,
  voiceURI,
  lang,
  localService,
});

// What iOS 17/18 Safari reports: quality only in the URI, plain names, novelty voices mixed in.
const IPHONE: VoiceLike[] = [
  v('Albert', 'com.apple.speech.synthesis.voice.Albert'),
  v('Bad News', 'com.apple.speech.synthesis.voice.BadNews'),
  v('Bells', 'com.apple.speech.synthesis.voice.Bells'),
  v('Zarvox', 'com.apple.speech.synthesis.voice.Zarvox'),
  v('Fred', 'com.apple.speech.synthesis.voice.Fred'),
  v('Eddy', 'com.apple.eloquence.en-US.Eddy'),
  v('Grandpa', 'com.apple.eloquence.en-US.Grandpa'),
  v('Rocko', 'com.apple.eloquence.en-GB.Rocko', 'en-GB'),
  v('Samantha', 'com.apple.voice.compact.en-US.Samantha'),
  v('Samantha', 'com.apple.voice.enhanced.en-US.Samantha'),
  v('Ava', 'com.apple.voice.premium.en-US.Ava'),
  v('Nicky', 'com.apple.ttsbundle.siri_Nicky_en-US_compact'),
  v('Daniel', 'com.apple.voice.compact.en-GB.Daniel', 'en-GB'),
  v('Karen', 'com.apple.voice.compact.en-AU.Karen', 'en-AU'),
];

describe('system voices', () => {
  it('reads quality from the URI and from macOS-style names', () => {
    expect(qualityOf(IPHONE[10]!)).toBe('premium');
    expect(qualityOf(IPHONE[9]!)).toBe('enhanced');
    expect(qualityOf(IPHONE[8]!)).toBe('compact');
    expect(qualityOf(v('Ava (Premium)', 'com.apple.voice.premium.en-US.Ava'))).toBe('premium');
    expect(qualityOf(v('Samantha (Enhanced)', 'Samantha'))).toBe('enhanced');
    expect(qualityOf(v('Microsoft Aria Online (Natural)', 'x'))).toBe('enhanced');
    expect(qualityOf(v('Google US English', 'Google US English', 'en-US', false))).toBe('standard');
  });

  it('drops novelty and Eloquence voices, merges duplicates, best first', () => {
    const us = rankVoices(IPHONE, 'us');
    expect(us.map((r) => `${r.base}:${r.quality}`)).toEqual([
      'Ava:premium',
      'Samantha:enhanced',
      'Nicky:compact',
    ]);
    expect(rankVoices(IPHONE, 'uk').map((r) => r.base)).toEqual(['Daniel']);
  });

  it('defaults to the best voice and keeps a valid choice', () => {
    expect(chooseVoice(IPHONE, 'us')?.voiceURI).toBe('com.apple.voice.premium.en-US.Ava');
    expect(chooseVoice(IPHONE, 'us', 'com.apple.voice.enhanced.en-US.Samantha')?.name).toBe(
      'Samantha',
    );
    // A blocked or merged-away choice falls back to the best one.
    expect(chooseVoice(IPHONE, 'us', 'com.apple.speech.synthesis.voice.Bells')?.name).toBe('Ava');
    expect(chooseVoice(IPHONE, 'us', 'com.apple.voice.compact.en-US.Samantha')?.name).toBe('Ava');
  });

  it('caps the list and prefers known good names on equal quality', () => {
    const many = ['Tom', 'Zoe', 'Allison', 'Evan', 'Susan', 'Aaron', 'Ava'].map((n) =>
      v(n, `com.apple.voice.enhanced.en-US.${n}`),
    );
    expect(voiceChoices(many, 'us').map((r) => r.base)).toEqual([
      'Ava',
      'Zoe',
      'Evan',
      'Allison',
      'Susan',
    ]);
  });

  it('knows when a good voice is missing (the settings guide)', () => {
    expect(hasGoodVoice(IPHONE, 'us')).toBe(true);
    expect(hasGoodVoice(IPHONE, 'uk')).toBe(false);
    expect(hasGoodVoice([], 'us')).toBe(false);
  });

  it('never picks a novelty voice even without a voice for the locale', () => {
    const odd = [v('Bells', 'com.apple.speech.synthesis.voice.Bells', 'en-GB'), IPHONE[12]!];
    expect(chooseVoice(odd, 'uk')?.name).toBe('Daniel');
    expect(chooseVoice([v('Bells', 'x.Bells')], 'us')).toBeUndefined();
  });
});
