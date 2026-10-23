import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ways iOS used to leave the app silent until it was closed: a lookup or a decode that never
 * settles, speech synthesis that swallows utterances, and an AudioContext that comes back from the
 * background silent. Every one must end in a sound (or a newer play), never in silence.
 */

const lookups = {
  word: vi.fn<() => Promise<unknown>>(),
  sentence: vi.fn<() => Promise<unknown>>(),
};

vi.mock('./recordings', () => ({
  wordRecording: () => lookups.word(),
  sentenceRecording: () => lookups.sentence(),
  describeRecording: () => Promise.resolve(null),
}));
vi.mock('./generated', () => ({
  generatedWord: () => Promise.resolve(null),
  generatedSentence: () => Promise.resolve(null),
}));

const never = () => new Promise<never>(() => undefined);

class FakeContext {
  static made: FakeContext[] = [];
  state: string = 'suspended';
  currentTime = 0;
  decode: (b: ArrayBuffer) => Promise<unknown> = () =>
    Promise.resolve({
      duration: 0.3,
      sampleRate: 24000,
      getChannelData: () => new Float32Array(1),
    });
  started = 0;
  destination = {};
  constructor() {
    FakeContext.made.push(this);
  }
  addEventListener() {}
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  decodeAudioData(b: ArrayBuffer) {
    return this.decode(b);
  }
  createBuffer() {
    return { duration: 0.3, copyToChannel() {} };
  }
  createBufferSource() {
    const src = {
      buffer: null as unknown,
      onended: null as null | (() => void),
      connect() {},
      start: () => {
        this.started++;
        this.currentTime += 0.5;
      },
      stop() {},
    };
    return src;
  }
}

interface Utt {
  text: string;
  volume: number;
  rate: number;
  lang: string;
  voice: unknown;
  onstart: null | (() => void);
  onend: null | (() => void);
  onerror: null | (() => void);
}

const synth = {
  spoken: [] as Utt[],
  /** When true, utterances are swallowed (no start, no end), as on a stuck iPhone. */
  stuck: false,
  speaking: false,
  pending: false,
  resumed: 0,
  cancelled: 0,
  speak(u: Utt) {
    this.spoken.push(u);
    if (this.stuck || !u.text.trim()) return;
    setTimeout(() => u.onstart?.(), 50);
    setTimeout(() => u.onend?.(), 300);
  },
  cancel() {
    this.cancelled++;
  },
  resume() {
    this.resumed++;
  },
  getVoices: () => [],
  addEventListener() {},
};

const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeContext.made = [];
  synth.spoken = [];
  synth.stuck = false;
  synth.resumed = 0;
  synth.cancelled = 0;
  lookups.word.mockReset().mockResolvedValue(null);
  lookups.sentence.mockReset().mockResolvedValue(null);
  g.window = globalThis;
  g.AudioContext = FakeContext;
  g.speechSynthesis = synth;
  g.SpeechSynthesisUtterance = class {
    volume = 1;
    rate = 1;
    lang = '';
    voice: unknown = null;
    onstart = null;
    onend = null;
    onerror = null;
    constructor(public text: string) {}
  };
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of ['window', 'AudioContext', 'speechSynthesis', 'SpeechSynthesisUtterance'])
    delete g[k];
});

const opts = { accent: 'us' as const, rate: 0.95 };
const clip = () => ({
  blob: new Blob([new Uint8Array(8)]),
  clip: { key: 'k', voice: 'af_heart', slow: false, file: 'f', stretch: false },
});
const said = () => synth.spoken.filter((u) => u.text.trim()).map((u) => u.text);

async function load() {
  return import('./speech');
}

describe('audio never goes silent', () => {
  it('a recording lookup that never settles falls back to the system voice', async () => {
    const a = await load();
    a.unlockAudio();
    lookups.word.mockImplementation(never);
    const done = a.playWord('wonderful', {}, opts);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(said()).toEqual(['wonderful']);
  });

  it('a decode that never settles falls back, and the next tap replaces the context', async () => {
    const a = await load();
    a.unlockAudio();
    expect(FakeContext.made).toHaveLength(1);
    FakeContext.made[0]!.decode = never;
    lookups.word.mockResolvedValue(clip());
    const done = a.playWord('wonderful', {}, opts);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(said()).toEqual(['wonderful']);
    a.unlockAudio();
    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[0]!.state).toBe('closed');
  });

  it('plays the recording through Web Audio when all is well', async () => {
    const a = await load();
    a.unlockAudio();
    lookups.word.mockResolvedValue(clip());
    const done = a.playWord('wonderful', {}, opts);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(FakeContext.made[0]!.started).toBeGreaterThan(1);
    expect(a.recentPlays().at(-1)?.source).toBe('recording');
    expect(said()).toEqual([]);
  });

  it('speech that never starts is flushed and tried again', async () => {
    const a = await load();
    synth.stuck = true;
    const done = a.speak('hello', opts);
    await vi.advanceTimersByTimeAsync(3_100);
    synth.stuck = false;
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(said()).toEqual(['hello', 'hello']);
    expect(synth.cancelled).toBeGreaterThan(0);
    expect(synth.resumed).toBeGreaterThan(1);
    // Logged once, not once per attempt.
    expect(a.recentPlays().filter((p) => p.text === 'hello')).toHaveLength(1);
  });

  it('after the background the next tap starts a fresh context', async () => {
    const a = await load();
    a.unlockAudio();
    a.unlockAudio();
    expect(FakeContext.made).toHaveLength(1);
    a.audioHidden();
    a.resumeAudio();
    expect(synth.resumed).toBeGreaterThan(0);
    a.unlockAudio();
    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[1]!.state).toBe('running');
  });

  it('a context idle for minutes is replaced on the next tap', async () => {
    const a = await load();
    a.unlockAudio();
    lookups.word.mockResolvedValue(clip());
    const done = a.playWord('wonderful', {}, opts);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    a.unlockAudio();
    expect(FakeContext.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(130_000);
    a.unlockAudio();
    expect(FakeContext.made).toHaveLength(2);
  });

  it('a newer play takes over one still looking up its clip', async () => {
    const a = await load();
    a.unlockAudio();
    let release: (v: unknown) => void = () => undefined;
    lookups.word.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = a.playWord('first', {}, opts);
    const second = a.playWord('second', {}, opts);
    await vi.advanceTimersByTimeAsync(100);
    release(null);
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([first, second]);
    expect(said()).toEqual(['second']);
  });

  it('stop cancels a play that is still looking up its clip', async () => {
    const a = await load();
    a.unlockAudio();
    lookups.sentence.mockImplementation(never);
    const done = a.playSentence('A sentence.', opts);
    await vi.advanceTimersByTimeAsync(100);
    a.stopAudio();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(said()).toEqual([]);
  });
});
