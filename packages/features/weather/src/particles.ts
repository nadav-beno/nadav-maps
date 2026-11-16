import { sampleLattice, type Lattice } from '@nm/core';
import type { FeatureContext } from '@nm/core/app';

type MapLibreMap = FeatureContext['map'];

/**
 * Moving wind streaks over the wind layer, like the animated wind maps: particles drift with
 * the interpolated wind (u east, v north, km/h) and leave fading trails. Drawn on a canvas over
 * the map, paused while the map moves and re-seeded after; off with "reduce motion".
 */

interface Field {
  l: Lattice;
  u: (number | null)[][];
  v: (number | null)[][];
}

const MAX_AGE = 90;
/** Screen pixels per frame for 1 km/h. */
const SPEED = 0.035;

let map: MapLibreMap | undefined;
let canvas: HTMLCanvasElement | null = null;
let field: Field | null = null;
let raf = 0;
let moving = false;
let particles: { x: number; y: number; age: number }[] = [];

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initWindParticles(m: MapLibreMap) {
  map = m;
  m.on('movestart', () => {
    moving = true;
    clear();
  });
  m.on('moveend', () => {
    moving = false;
    seed();
  });
  m.on('resize', () => size() && seed());
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
}

/** Shows streaks for this wind field, or removes them (null). */
export function setWindField(f: Field | null) {
  field = f;
  if (!f || !map || reducedMotion()) {
    stop();
    canvas?.remove();
    canvas = null;
    return;
  }
  // A new hour (or a new area) keeps the particles flowing; only a new canvas seeds them.
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'wx-particles';
    canvas.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().appendChild(canvas);
    size();
    seed();
  }
  start();
}

function size(): boolean {
  if (!canvas || !map) return false;
  const c = map.getCanvas();
  const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) return false;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  return true;
}

function seed() {
  if (!canvas || !field) return;
  const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  const n = Math.min(1400, Math.round((w * h) / 900));
  particles = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, age: Math.floor(Math.random() * MAX_AGE) }));
  clear();
}

function clear() {
  const g = canvas?.getContext('2d');
  if (g && canvas) g.clearRect(0, 0, canvas.width, canvas.height);
}

function start() {
  if (!raf && canvas && field && !document.hidden) raf = requestAnimationFrame(frame);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

function frame() {
  raf = 0;
  if (!canvas || !field || !map) return;
  raf = requestAnimationFrame(frame);
  if (moving) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  const dpr = canvas.width / (canvas.clientWidth || canvas.width);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  // Fade the old trails.
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = 'rgba(0,0,0,0.93)';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalCompositeOperation = 'source-over';
  g.lineWidth = 1.3 * dpr;
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  const { l, u, v } = field;
  for (const p of particles) {
    if (p.age++ > MAX_AGE || p.x < 0 || p.y < 0 || p.x > w || p.y > h) {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.age = 0;
      continue;
    }
    const ll = map.unproject([p.x, p.y]);
    const uu = sampleLattice(l, u, ll.lng, ll.lat);
    const vv = sampleLattice(l, v, ll.lng, ll.lat);
    if (uu === null || vv === null) {
      p.age = MAX_AGE + 1;
      continue;
    }
    const nx = p.x + uu * SPEED;
    const ny = p.y - vv * SPEED;
    g.moveTo(p.x * dpr, p.y * dpr);
    g.lineTo(nx * dpr, ny * dpr);
    p.x = nx;
    p.y = ny;
  }
  g.stroke();
}

/** For tests: is the animation running? */
export const windParticlesRunning = () => !!canvas && !!field;
