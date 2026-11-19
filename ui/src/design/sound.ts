// A tiny WebAudio synthesiser for the brief's cues. No audio files: every cue is built from oscillators and a
// shared noise buffer. The AudioContext is created lazily on the first user gesture (browsers refuse to start one
// earlier) and `play(cue)` is a no-op while sound is off.
import { useSettings } from './settings';

export type Cue = 'tick' | 'msg' | 'tock' | 'out' | 'flip' | 'roar' | 'pager';

export type CueSpec = {
  /** What the cue means in the game. */
  when: string;
  /** What it should sound like. */
  sounds: string;
  /** Seconds from start to silence. The brief caps every cue at 1.5s. */
  duration: number;
  /** Relative loudness, 0..1, before the player's volume. */
  level: number;
};

export const CUES: Record<Cue, CueSpec> = {
  tick: { when: 'tab or palette move', sounds: 'a soft high click', duration: 0.05, level: 0.35 },
  msg: {
    when: 'a chat message arrives',
    sounds: 'a two-note glass chime',
    duration: 0.42,
    level: 0.45,
  },
  tock: {
    when: 'bat on ball: a level passes',
    sounds: 'a hollow wooden knock',
    duration: 0.32,
    level: 0.9,
  },
  out: { when: 'a check fails', sounds: 'a falling two-step tone', duration: 0.62, level: 0.55 },
  flip: {
    when: 'a scoreboard digit flips',
    sounds: 'a split-flap clack',
    duration: 0.06,
    level: 0.4,
  },
  roar: {
    when: 'chapter complete',
    sounds: 'a crowd swelling and fading',
    duration: 1.45,
    level: 0.7,
  },
  pager: {
    when: 'incident or dangerous command',
    sounds: 'three urgent beeps',
    duration: 0.5,
    level: 0.35,
  },
};

export const CUE_NAMES = Object.keys(CUES) as Cue[];

/** Overall ceiling: "quiet by default". At volume 1 the loudest cue peaks around -10 dBFS. */
export const MASTER_LEVEL = 0.32;

/** Pure: the gain a cue plays at, given the player's volume. */
export const cueGain = (cue: Cue, volume: number): number =>
  MASTER_LEVEL * CUES[cue].level * Math.min(1, Math.max(0, volume));

type Ctx = BaseAudioContext;
type Voice = (ctx: Ctx, out: AudioNode, t: number) => void;

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function noiseBuffer(c: Ctx): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const b = c.createBuffer(1, Math.floor(c.sampleRate * 1.5), c.sampleRate);
  const d = b.getChannelData(0);
  // Pinkish noise (Paul Kellet's economy filter): warmer than white, closer to a crowd or a wooden knock.
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  noise = b;
  return b;
}

/** A gain node with an attack/decay envelope, connected to `out`. */
function env(
  c: Ctx,
  out: AudioNode,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function tone(
  c: Ctx,
  out: AudioNode,
  t: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  glide: number,
  a: number,
  d: number,
  peak = 1,
) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  o.connect(env(c, out, t, peak, a, d));
  o.start(t);
  o.stop(t + a + d + 0.02);
}

function burst(
  c: Ctx,
  out: AudioNode,
  t: number,
  filter: BiquadFilterType,
  freq: number,
  q: number,
  a: number,
  d: number,
  peak = 1,
) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  f.Q.value = q;
  s.connect(f).connect(env(c, out, t, peak, a, d));
  s.start(t, Math.random() * 0.5);
  s.stop(t + a + d + 0.02);
}

const VOICES: Record<Cue, Voice> = {
  tick: (c, o, t) => {
    tone(c, o, t, 'triangle', 2600, 1700, 0.03, 0.002, 0.035, 0.7);
    burst(c, o, t, 'highpass', 5000, 0.7, 0.001, 0.015, 0.25);
  },
  msg: (c, o, t) => {
    tone(c, o, t, 'sine', 988, 988, 0, 0.004, 0.22, 0.8);
    tone(c, o, t, 'sine', 1976, 1976, 0, 0.004, 0.08, 0.12);
    tone(c, o, t + 0.11, 'sine', 1480, 1480, 0, 0.004, 0.28, 0.75);
    tone(c, o, t + 0.11, 'sine', 2960, 2960, 0, 0.004, 0.09, 0.1);
  },
  tock: (c, o, t) => {
    // The ball: a fast pitch drop gives the "thock"; the bat: a short resonant body and a bright contact crack.
    tone(c, o, t, 'sine', 520, 140, 0.07, 0.002, 0.18, 1);
    tone(c, o, t, 'triangle', 820, 640, 0.05, 0.001, 0.09, 0.35);
    burst(c, o, t, 'bandpass', 2400, 1.4, 0.001, 0.03, 0.9);
    burst(c, o, t, 'lowpass', 900, 0.8, 0.002, 0.12, 0.35);
  },
  out: (c, o, t) => {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(o);
    tone(c, lp, t, 'sawtooth', 392, 370, 0.18, 0.006, 0.22, 0.45);
    tone(c, lp, t, 'triangle', 392, 370, 0.18, 0.006, 0.22, 0.6);
    tone(c, lp, t + 0.2, 'sawtooth', 294, 262, 0.35, 0.006, 0.38, 0.45);
    tone(c, lp, t + 0.2, 'triangle', 294, 262, 0.35, 0.006, 0.38, 0.6);
  },
  flip: (c, o, t) => {
    burst(c, o, t, 'highpass', 2800, 0.9, 0.001, 0.022, 0.9);
    tone(c, o, t, 'square', 1150, 700, 0.012, 0.001, 0.018, 0.18);
    burst(c, o, t + 0.018, 'bandpass', 1600, 2, 0.001, 0.02, 0.35);
  },
  roar: (c, o, t) => {
    // Many voices: band-passed pink noise that swells, with a slow flutter and a rising filter (the crowd gets up).
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(1300, t + 0.6);
    bp.frequency.exponentialRampToValueAtTime(800, t + 1.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.35);
    g.gain.setValueAtTime(1, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.42);
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 7;
    depth.gain.value = 0.18;
    lfo.connect(depth).connect(g.gain);
    s.connect(bp).connect(g).connect(o);
    s.start(t, 0);
    s.stop(t + 1.45);
    lfo.start(t);
    lfo.stop(t + 1.45);
  },
  pager: (c, o, t) => {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.15;
      tone(c, o, at, 'square', 1760, 1760, 0, 0.004, 0.075, 0.5);
      tone(c, o, at, 'sine', 880, 880, 0, 0.004, 0.075, 0.4);
    }
  },
};

/** Renders a cue into any context (an OfflineAudioContext in a test harness, the live one in the app). */
export function renderCue(
  c: Ctx,
  cue: Cue,
  destination: AudioNode,
  gain: number,
  when = c.currentTime,
): void {
  const master = c.createGain();
  master.gain.value = gain;
  master.connect(destination);
  VOICES[cue](c, master, when + 0.005);
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Creates (or resumes) the AudioContext. Call from a user gesture; DesignRuntime does it on the first one. */
export function unlockAudio(): void {
  if (!useSettings.getState().sound) return;
  audio();
}

/** Plays a cue. Returns false (and does nothing) while sound is off or WebAudio is unavailable. */
export function play(cue: Cue): boolean {
  const { sound, volume } = useSettings.getState();
  if (!sound || !(cue in CUES)) return false;
  const c = audio();
  if (!c) return false;
  renderCue(c, cue, c.destination, cueGain(cue, volume));
  return true;
}
