import type { Map as MapLibreMap } from 'maplibre-gl';
import { MAKI } from './maki-paths.ts';
import { poiImageList } from './poi.ts';

/**
 * Map icons are drawn at runtime from Maki path data (no sprite server needed):
 * a coloured disc with a white glyph for places, plus road shields, peaks and one-way arrows.
 */
const RATIO = 2;

type Img = { width: number; height: number; data: Uint8ClampedArray };

function canvas(w: number, h: number): [CanvasRenderingContext2D, () => Img] {
  const el = document.createElement('canvas');
  el.width = w * RATIO;
  el.height = h * RATIO;
  const ctx = el.getContext('2d')!;
  ctx.scale(RATIO, RATIO);
  return [ctx, () => ({ width: el.width, height: el.height, data: ctx.getImageData(0, 0, el.width, el.height).data })];
}

function glyph(ctx: CanvasRenderingContext2D, icon: string, cx: number, cy: number, size: number, color: string): void {
  const d = MAKI[icon];
  if (!d) return;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 15, size / 15);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(d));
  ctx.restore();
}

function poiDisc(color: string, icon: string | null, ring: string): Img {
  const s = 22;
  const [ctx, done] = canvas(s, s);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 1.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 0.5;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ring;
  ctx.stroke();
  if (icon) glyph(ctx, icon, s / 2, s / 2, 11, '#ffffff');
  else {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  return done();
}

/** Stretchable rounded label for road numbers (used with icon-text-fit). */
function shield(fill: string, stroke: string): { img: Img; stretch: { stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] } } {
  const w = 20, h = 16, r = 4;
  const [ctx, done] = canvas(w, h);
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  const p = (n: number) => n * RATIO;
  return {
    img: done(),
    stretch: { stretchX: [[p(r + 1), p(w - r - 1)]], stretchY: [[p(r + 1), p(h - r - 1)]], content: [p(3), p(3), p(w - 3), p(h - 3)] },
  };
}

function oneway(color: string): Img {
  const w = 14, h = 8;
  const [ctx, done] = canvas(w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(2, h / 2);
  ctx.lineTo(w - 3, h / 2);
  ctx.moveTo(w - 6, 1.5);
  ctx.lineTo(w - 3, h / 2);
  ctx.lineTo(w - 6, h - 1.5);
  ctx.stroke();
  return done();
}

function peak(color: string): Img {
  const s = 14;
  const [ctx, done] = canvas(s, s);
  glyph(ctx, 'mountain', s / 2, s / 2, 12, color);
  return done();
}

/** Builds every image once per theme; re-adding to a new style is then cheap. */
const cache = new Map<string, Map<string, { img: Img; opts?: object }>>();

function imagesFor(theme: 'light' | 'dark'): Map<string, { img: Img; opts?: object }> {
  let set = cache.get(theme);
  if (set) return set;
  set = new Map();
  const ring = theme === 'dark' ? '#1d2126' : '#ffffff';
  for (const p of poiImageList(theme)) set.set(p.id, { img: poiDisc(p.color, p.icon, ring) });
  const minor = shield(theme === 'dark' ? '#3b4149' : '#ffffff', theme === 'dark' ? '#5a616b' : '#b9b3a8');
  const major = shield(theme === 'dark' ? '#8a6d34' : '#f7cf6a', theme === 'dark' ? '#b08a42' : '#d29f3c');
  set.set('nm-shield', { img: minor.img, opts: minor.stretch });
  set.set('nm-shield-major', { img: major.img, opts: major.stretch });
  set.set('nm-oneway', { img: oneway(theme === 'dark' ? '#c9ced5' : '#6b7178') });
  set.set('nm-peak', { img: peak(theme === 'dark' ? '#c9b393' : '#8a6a42') });
  cache.set(theme, set);
  return set;
}

/** Add the base map's images to the current style (call on every style load). */
export function addBasemapImages(map: MapLibreMap, theme: 'light' | 'dark'): void {
  for (const [id, { img, opts }] of imagesFor(theme)) {
    if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: RATIO, ...opts });
  }
}

/** For `styleimagemissing`: add one of ours if that's what was asked for. */
export function addMissingImage(map: MapLibreMap, theme: 'light' | 'dark', id: string): void {
  const hit = imagesFor(theme).get(id);
  if (hit && !map.hasImage(id)) map.addImage(id, hit.img, { pixelRatio: RATIO, ...hit.opts });
}
