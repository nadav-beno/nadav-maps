import type { Map as MapLibreMap } from 'maplibre-gl';
import type { AircraftKind, AircraftPosition } from '@nm/tools';

/**
 * Our own top-down aircraft silhouettes for the live flights map, nose up (north), one per kind,
 * each drawn in the colour of its altitude band with a thin outline and a soft shadow. Drawn on
 * a canvas at runtime: 4 kinds x 7 bands = 28 small images, no files to ship.
 */

type Pt = [number, number];

/** Right half of each outline in a 64 x 64 box (x >= 32), nose first; the left half is mirrored. */
const HALF: Record<Exclude<AircraftKind, 'heli'>, Pt[]> = {
  jet: [
    [32, 3], [33.6, 4.2], [34.6, 7], [35, 11], [35, 24], [58.5, 36.2], [59.5, 37.6], [59.5, 39.6], [35, 34.8],
    [34.6, 48], [43.5, 54.6], [43.8, 57.2], [33.6, 55.6], [32.8, 61], [32, 61.4],
  ],
  heavy: [
    [32, 1.5], [34, 2.8], [35.4, 6], [36, 10.5], [36, 22.5], [61.5, 37.4], [62.4, 39], [62.4, 41], [36, 34.8],
    [35.6, 47.5], [46, 55], [46.4, 58], [34.6, 56.4], [33.2, 62.2], [32, 62.6],
  ],
  light: [
    [32, 9], [33.5, 10.2], [34, 13], [34, 21], [60.5, 21.2], [61.5, 22.4], [61.5, 26.4], [60.5, 27.4], [34, 27.6],
    [33.4, 47], [42.5, 48.6], [43, 49.6], [43, 52.4], [42.5, 53.2], [33.2, 54], [32.6, 56], [32, 56.2],
  ],
};

/** Engines under the wings (center x on the right side, center y, half width, half length). */
const ENGINES: Partial<Record<AircraftKind, [number, number, number, number][]>> = {
  jet: [[45, 30.5, 2.1, 4.2]],
  heavy: [[44.5, 29, 2.6, 5], [53.5, 34, 2.1, 4]],
};

function outline(kind: Exclude<AircraftKind, 'heli'>): Path2D {
  const right = HALF[kind];
  const left = right.map(([x, y]) => [64 - x, y] as Pt).reverse();
  const pts = [...right, ...left];
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) p.lineTo(x, y);
  p.closePath();
  return p;
}

/** Altitude bands, low (warm) to high (cool); band 0 is on the ground. */
export const BANDS: { upToM: number; color: string; label: string }[] = [
  { upToM: 0, color: '#9aa0a6', label: 'קרקע' },
  { upToM: 1000, color: '#f4511e', label: '1' },
  { upToM: 3000, color: '#fb8c00', label: '3' },
  { upToM: 6000, color: '#fdd835', label: '6' },
  { upToM: 9000, color: '#7cb342', label: '9' },
  { upToM: 11000, color: '#039be5', label: '11' },
  { upToM: Infinity, color: '#7e57c2', label: '' },
];

export function altitudeBand(a: Pick<AircraftPosition, 'onGround' | 'altitudeM'>): number {
  if (a.onGround) return 0;
  const m = a.altitudeM;
  if (m === null) return 3;
  for (let i = 1; i < BANDS.length; i++) if (m < BANDS[i].upToM) return i;
  return BANDS.length - 1;
}

/** Drawn size in CSS px at icon-size 1. */
const SIZE: Record<AircraftKind, number> = { jet: 30, heavy: 38, light: 22, heli: 26 };
const RATIO = 2;
export const KINDS: AircraftKind[] = ['jet', 'heavy', 'light', 'heli'];

export const iconId = (kind: AircraftKind, band: number) => `live-${kind}-${band}`;

function draw(kind: AircraftKind, fill: string, edge: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  if (typeof document === 'undefined') return null;
  const px = SIZE[kind] * RATIO;
  const el = document.createElement('canvas');
  el.width = el.height = px;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  // 2 px of room for the outline and shadow.
  const pad = 2 * RATIO;
  ctx.translate(pad, pad);
  ctx.scale((px - 2 * pad) / 64, (px - 2 * pad) / 64);
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3 * RATIO;
  ctx.shadowOffsetY = 1 * RATIO;
  const shapes: Path2D[] = [];
  if (kind === 'heli') {
    const body = new Path2D();
    body.ellipse(32, 27, 6.5, 11, 0, 0, Math.PI * 2);
    const boom = new Path2D();
    boom.roundRect(30.6, 34, 2.8, 24, 1.4);
    const fin = new Path2D();
    fin.roundRect(26, 54, 12, 3, 1.5);
    shapes.push(body, boom, fin);
  } else {
    shapes.push(outline(kind));
    for (const [x, y, w, l] of ENGINES[kind] ?? []) {
      for (const cx of [x, 64 - x]) {
        const e = new Path2D();
        e.roundRect(cx - w, y - l, 2 * w, 2 * l, w);
        shapes.push(e);
      }
    }
  }
  // Outline first (with the shadow), then the fill on top without it.
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3.2;
  for (const s of shapes) ctx.stroke(s);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = fill;
  for (const s of shapes) ctx.fill(s);
  if (kind === 'heli') {
    // Rotor: a faint disc and two blades.
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(32, 26, 25, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    const blades = () => {
      ctx.beginPath();
      ctx.moveTo(13, 7);
      ctx.lineTo(51, 45);
      ctx.moveTo(51, 7);
      ctx.lineTo(13, 45);
    };
    blades();
    ctx.stroke();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    blades();
    ctx.stroke();
  } else {
    // A light line down the fuselage gives it a little volume.
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(32, kind === 'light' ? 13 : 8);
    ctx.lineTo(32, kind === 'light' ? 46 : 50);
    ctx.stroke();
  }
  return { width: px, height: px, data: ctx.getImageData(0, 0, px, px).data };
}

/** Adds every kind in every altitude colour (skips ones the style already has). */
export function addLiveIcons(map: MapLibreMap, dark: boolean): void {
  const edge = dark ? '#202124' : '#ffffff';
  for (const kind of KINDS)
    BANDS.forEach((b, i) => {
      const id = iconId(kind, i);
      if (map.hasImage(id)) return;
      const img = draw(kind, b.color, edge);
      if (img) map.addImage(id, img, { pixelRatio: RATIO });
    });
}
