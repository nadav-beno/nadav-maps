import type { Map as MapLibreMap } from 'maplibre-gl';
import { CATEGORY_COLOR, SHIP_CATEGORIES, type ShipCategory } from '@nm/core';

/**
 * Our own ship symbols, drawn on a canvas at runtime (no files to ship):
 * - under way: a hull seen from above, bow up (north), rotated to its course on the map;
 *   fast craft get a slimmer, sharper hull, big ships a longer one;
 * - stopped (anchored, moored, or barely moving): a round dot.
 * Each in its category's colour with a thin outline: 10 categories x 4 shapes = 40 small images.
 */

export type Shape = 'hull' | 'big' | 'fast' | 'dot';
export const SHAPES: Shape[] = ['hull', 'big', 'fast', 'dot'];
export const shipIcon = (cat: ShipCategory, shape: Shape) => `ship-${shape}-${cat}`;

const RATIO = 2;
/** Canvas size in CSS px (width, height). */
const SIZE: Record<Shape, [number, number]> = { hull: [14, 26], big: [16, 32], fast: [12, 26], dot: [13, 13] };

function hullPath(shape: Shape, w: number, h: number): Path2D {
  const p = new Path2D();
  if (shape === 'dot') {
    p.arc(w / 2, h / 2, w / 2 - 2.2 * RATIO, 0, Math.PI * 2);
    return p;
  }
  const pad = 2 * RATIO;
  const l = pad, r = w - pad, t = pad, b = h - pad;
  const mid = w / 2;
  // Bow length: sharper for fast craft.
  const bow = (b - t) * (shape === 'fast' ? 0.5 : shape === 'big' ? 0.3 : 0.36);
  p.moveTo(mid, t);
  p.bezierCurveTo(mid + (r - mid) * 0.55, t + bow * 0.35, r, t + bow * 0.75, r, t + bow);
  p.lineTo(r, b - 2 * RATIO);
  p.quadraticCurveTo(r, b, r - 2 * RATIO, b);
  p.lineTo(l + 2 * RATIO, b);
  p.quadraticCurveTo(l, b, l, b - 2 * RATIO);
  p.lineTo(l, t + bow);
  p.bezierCurveTo(l, t + bow * 0.75, mid - (mid - l) * 0.55, t + bow * 0.35, mid, t);
  p.closePath();
  return p;
}

function draw(shape: Shape, fill: string, edge: string) {
  if (typeof document === 'undefined') return null;
  const [cw, ch] = SIZE[shape];
  const w = cw * RATIO, h = ch * RATIO;
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 2 * RATIO;
  ctx.shadowOffsetY = 0.5 * RATIO;
  const path = hullPath(shape, w, h);
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.1 * RATIO;
  ctx.stroke(path);
  if (shape !== 'dot') {
    // A pale bridge near the stern, so the bow reads at a glance.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const bw = w * 0.36;
    ctx.fillRect((w - bw) / 2, h * 0.7, bw, h * 0.08);
  }
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/** Adds (or replaces, after a theme change) every ship image on the map. */
export function addShipIcons(map: MapLibreMap, dark: boolean) {
  const edge = dark ? 'rgba(10,10,10,0.85)' : 'rgba(255,255,255,0.95)';
  for (const c of SHIP_CATEGORIES) {
    for (const s of SHAPES) {
      const id = shipIcon(c.id, s);
      const img = draw(s, CATEGORY_COLOR[c.id], edge);
      if (!img) continue;
      if (map.hasImage(id)) map.updateImage(id, img);
      else map.addImage(id, img, { pixelRatio: RATIO });
    }
  }
}
