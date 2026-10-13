import { describe, expect, it } from 'vitest';
import { clipKey, KEY_LEN, normText } from './key';
import { _parsePacks } from './recordings';
import { recordingRate } from './speech';

describe('clip keys', () => {
  it('are fixed width and ignore spacing differences', () => {
    expect(clipKey('take off')).toHaveLength(KEY_LEN);
    expect(clipKey('  take   off ')).toBe(clipKey('take off'));
    expect(normText('a b')).toBe('a b');
    expect(clipKey('Read')).not.toBe(clipKey('read'));
  });

  it('are stable (the build and the phone must agree)', () => {
    // Changing the hash orphans every published clip: keep this value.
    expect(clipKey('decide')).toBe('2ds22n9b9ww');
    expect(/^[0-9a-z]{11}$/.test(clipKey('She decided to stay.'))).toBe(true);
  });
});

describe('word pack index', () => {
  it('turns lengths into offsets, normal then slow, skipping missing clips', () => {
    const a = clipKey('one');
    const b = clipKey('two');
    const c = clipKey('three');
    const map = _parsePacks({ packs: [{ f: 'p.pack', k: a + b + c, l: [10, 20, 0, 5, 7, 0] }] });
    expect(map.get(a)).toEqual({ pack: 'p.pack', n: [0, 10], s: [10, 20] });
    expect(map.get(b)).toEqual({ pack: 'p.pack', s: [30, 5] });
    expect(map.get(c)).toEqual({ pack: 'p.pack', n: [35, 7] });
  });
});

describe('recording speed', () => {
  it('plays recordings as made at the default speed and scales around it', () => {
    expect(recordingRate(0.95)).toBe(1);
    expect(recordingRate(0.6)).toBeCloseTo(0.7);
    expect(recordingRate(1.2)).toBeCloseTo(1.263, 2);
  });
});
