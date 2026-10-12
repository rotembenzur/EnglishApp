/**
 * Tiny synthesized sound effects (WebAudio, no files). Off by default (spec 6.1); toggled in
 * settings. Played only after a user gesture.
 */
import { useApp } from '@/state/app';

export type Sfx = 'correct' | 'wrong' | 'goal' | 'level' | 'tap';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.12,
) {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export function sfx(kind: Sfx): void {
  if (!useApp.getState().profile?.settings.sounds) return;
  switch (kind) {
    case 'correct':
      tone(660, 0, 0.12, 'triangle');
      tone(990, 0.08, 0.16, 'triangle');
      break;
    case 'wrong':
      tone(220, 0, 0.18, 'sawtooth', 0.06);
      break;
    case 'goal':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.25, 'triangle'));
      break;
    case 'level':
      [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.3, 'square', 0.05));
      break;
    case 'tap':
      tone(880, 0, 0.04, 'sine', 0.05);
      break;
  }
}

/** Light haptic tap where supported (Android; iOS ignores). */
export function buzz(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // unsupported
  }
}
