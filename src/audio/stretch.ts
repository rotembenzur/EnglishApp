/**
 * Pitch-preserving time stretch (WSOLA) for speech clips played through Web Audio, where
 * `playbackRate` would change the pitch. `rate` < 1 slows down. Mono input, a few ms per clip.
 */
export function stretch(
  input: Float32Array,
  rate: number,
  sampleRate: number,
): Float32Array<ArrayBuffer> {
  if (Math.abs(rate - 1) < 0.005 || input.length < 1024) return new Float32Array(input);
  const win = Math.round(sampleRate * 0.03); // 30 ms frames
  const hop = Math.round(win / 2);
  const tol = Math.round(sampleRate * 0.008); // search +-8 ms for the best-matching frame
  const outLen = Math.ceil(input.length / rate);
  const out = new Float32Array(outLen + win);
  const norm = new Float32Array(outLen + win);
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  let prev = 0; // input position of the previous frame
  for (let o = 0; o < outLen; o += hop) {
    const ideal = Math.round(o * rate);
    let best = Math.min(Math.max(0, ideal), Math.max(0, input.length - win));
    if (o > 0) {
      // Continue the waveform: the frame that best matches where the previous one would go next.
      const natural = prev + hop;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const p = ideal + d;
        if (p < 0 || p + win > input.length) continue;
        let score = 0;
        for (let i = 0; i < hop; i += 2) {
          const a = input[natural + i] ?? 0;
          score += a * input[p + i]!;
        }
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }
    for (let i = 0; i < win && best + i < input.length; i++) {
      out[o + i] = out[o + i]! + input[best + i]! * w[i]!;
      norm[o + i] = norm[o + i]! + w[i]!;
    }
    prev = best;
  }
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) res[i] = norm[i]! > 1e-3 ? out[i]! / norm[i]! : 0;
  return res;
}
