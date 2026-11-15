/**
 * Every sound in the game is made here with Web Audio (no audio files, nothing to license).
 * Browsers (iPhone first) allow sound only after a tap, so `unlock()` runs from "התחל משמרת".
 */

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let sfxVolume = 0.8;
let musicVolume = 0.5;
let muted = false;

export function unlock() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    sfxGain = ctx.createGain();
    musicGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    sfxGain.connect(comp);
    musicGain.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setVolumes(sfx: number, music: number, mute: boolean) {
  sfxVolume = sfx;
  musicVolume = music;
  muted = mute;
  applyVolumes();
}

function applyVolumes() {
  if (!ctx || !sfxGain || !musicGain) return;
  sfxGain.gain.value = muted ? 0 : sfxVolume * 0.6;
  musicGain.gain.value = muted ? 0 : musicVolume * 0.22;
}

export function suspend() {
  if (ctx && ctx.state === 'running') void ctx.suspend();
}

export function resume() {
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; to?: number; vol?: number; delay?: number; out?: GainNode | null } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + (opts.delay ?? 0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.type ?? 'square';
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.vol ?? 0.3, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(opts.out ?? sfxGain!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, opts: { freq?: number; to?: number; vol?: number; type?: BiquadFilterType; delay?: number } = {}) {
  if (!ctx || !noiseBuf) return;
  const t = ctx.currentTime + (opts.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = opts.type ?? 'lowpass';
  f.frequency.setValueAtTime(opts.freq ?? 1200, t);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.vol ?? 0.5, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxGain!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  launch: () => {
    noise(0.25, { freq: 800, to: 3000, vol: 0.18, type: 'bandpass' });
    tone(300, 0.2, { type: 'sawtooth', to: 900, vol: 0.06 });
  },
  dry: () => tone(140, 0.08, { type: 'square', vol: 0.12 }),
  blast: () => {
    noise(0.5, { freq: 1800, to: 120, vol: 0.45 });
    tone(110, 0.35, { type: 'sine', to: 40, vol: 0.35 });
  },
  kill: (mult: number) => tone(520 * Math.pow(1.12, Math.min(8, (mult - 1) * 2)), 0.12, { type: 'triangle', to: 1200, vol: 0.18 }),
  hurt: () => tone(220, 0.12, { type: 'square', to: 160, vol: 0.12 }),
  combo: (mult: number) => [0, 4, 7].forEach((s, i) => tone(660 * Math.pow(2, (s + mult * 2) / 12), 0.12, { type: 'triangle', vol: 0.12, delay: i * 0.06 })),
  supply: () => [0, 5, 9].forEach((s, i) => tone(880 * Math.pow(2, s / 12), 0.14, { type: 'sine', vol: 0.14, delay: i * 0.09 })),
  drop: () => tone(700, 0.25, { type: 'sine', to: 350, vol: 0.14 }),
  power: () => [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.16, { type: 'square', vol: 0.1, delay: i * 0.07 })),
  saved: () => [12, 7].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.22, { type: 'sine', vol: 0.2, delay: i * 0.12 })),
  warn: () => [0, 0.18].forEach((d) => tone(980, 0.1, { type: 'square', vol: 0.08, delay: d })),
  boss: () => {
    tone(55, 1.4, { type: 'sawtooth', to: 70, vol: 0.3 });
    tone(82, 1.4, { type: 'sawtooth', to: 104, vol: 0.2 });
  },
  shock: () => {
    noise(1.2, { freq: 3000, to: 60, vol: 0.6 });
    tone(80, 1, { type: 'sine', to: 30, vol: 0.5 });
  },
  wave: () => [0, 4, 7, 12].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.2, { type: 'triangle', vol: 0.14, delay: i * 0.1 })),
  clear: () => [0, 4, 7, 12, 16].forEach((s, i) => tone(523 * Math.pow(2, s / 12), 0.22, { type: 'triangle', vol: 0.14, delay: i * 0.08 })),
  over: () => [7, 3, 0, -5].forEach((s, i) => tone(392 * Math.pow(2, s / 12), 0.4, { type: 'sawtooth', vol: 0.12, delay: i * 0.22 })),
  click: () => tone(1200, 0.04, { type: 'sine', vol: 0.08 }),
};

// ---------- music: a small looping synth track that speeds up as the wave goes on ----------

let musicTimer: ReturnType<typeof setInterval> | undefined;
let stepN = 0;
let nextAt = 0;
let tempo = 112;
let intense = false;
const BASS = [0, 0, 7, 0, 5, 5, 3, 5];
const ARP = [0, 7, 12, 7, 3, 7, 10, 7];

export function music(on: boolean) {
  clearInterval(musicTimer);
  musicTimer = undefined;
  if (!on || !ctx) return;
  nextAt = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    while (nextAt < ctx.currentTime + 0.25) {
      const beat = 60 / tempo / 2;
      const delay = Math.max(0, nextAt - ctx.currentTime);
      const root = 110 * (stepN % 64 < 32 ? 1 : Math.pow(2, -2 / 12));
      if (stepN % 2 === 0) tone(root * Math.pow(2, BASS[(stepN / 2) % 8] / 12), beat * 1.6, { type: 'sawtooth', vol: 0.18, delay, out: musicGain });
      tone(root * 4 * Math.pow(2, ARP[stepN % 8] / 12), beat * 0.6, { type: intense ? 'square' : 'triangle', vol: 0.06, delay, out: musicGain });
      if (intense && stepN % 4 === 2) tone(60, 0.08, { type: 'sine', vol: 0.25, delay, out: musicGain });
      nextAt += beat;
      stepN++;
    }
  }, 100);
}

/** 0 at the start of a wave, 1 near its end; bosses play it hard. */
export function musicIntensity(x: number, boss: boolean) {
  tempo = 112 + Math.round(x * 28);
  intense = boss || x > 0.7;
}

// ---------- vibration (Android; iPhone browsers have none) ----------

let buzzOn = true;
export function setVibration(on: boolean) {
  buzzOn = on;
}
export function buzz(pattern: number | number[]) {
  if (!buzzOn || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when the page has no user gesture yet.
  }
}
