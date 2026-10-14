import { describe, expect, it } from 'vitest';
import { stretch } from './stretch';

const tone = (hz: number, sec: number, sr = 24000) =>
  Float32Array.from({ length: Math.round(sec * sr) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / sr),
  );

/** Dominant frequency by zero crossings. */
function pitch(x: Float32Array, sr = 24000): number {
  let z = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) z++;
  return (z * sr) / x.length;
}

describe('time stretch', () => {
  it('slows down without changing the pitch', () => {
    const x = tone(220, 1);
    const y = stretch(x, 0.75, 24000);
    expect(y.length).toBe(Math.ceil(x.length / 0.75));
    expect(pitch(y.subarray(2000, y.length - 2000))).toBeCloseTo(220, -1);
  });

  it('leaves rate 1 untouched', () => {
    const x = tone(220, 0.5);
    expect(stretch(x, 1, 24000)).toEqual(x);
  });
});
