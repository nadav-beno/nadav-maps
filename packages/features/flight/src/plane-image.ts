import type { Map as MapLibreMap } from 'maplibre-gl';
import { ICONS } from '@nm/core/app';

const RATIO = 2;
const SIZE = 34;

/** The Material "flight" glyph (nose up = north), with a halo so it reads on land and sea. */
function plane(fill: string, halo: string): { width: number; height: number; data: Uint8ClampedArray } | null {
  const d = ICONS.flight;
  if (!d || typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = el.height = SIZE * RATIO;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  ctx.scale(RATIO, RATIO);
  const path = new Path2D(d);
  const draw = (stroke: boolean) => {
    ctx.save();
    // The icon's viewBox is "0 -960 960 960".
    ctx.translate(1, 1);
    ctx.scale((SIZE - 2) / 960, (SIZE - 2) / 960);
    ctx.translate(0, 960);
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 110;
      ctx.strokeStyle = halo;
      ctx.stroke(path);
    } else {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    ctx.restore();
  };
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 3;
  draw(true);
  ctx.shadowColor = 'transparent';
  draw(false);
  return { width: el.width, height: el.height, data: ctx.getImageData(0, 0, el.width, el.height).data };
}

/** Our plane (accent blue) and the one found by flight number (amber). */
export function addPlaneImages(map: MapLibreMap, dark: boolean): void {
  const halo = dark ? '#1f1f1f' : '#ffffff';
  const images: [string, string][] = [
    ['flight-plane', dark ? '#a8c7fa' : '#0b57d0'],
    ['flight-plane-adsb', dark ? '#fdd663' : '#e37400'],
  ];
  for (const [id, color] of images) {
    if (map.hasImage(id)) continue;
    const img = plane(color, halo);
    if (img) map.addImage(id, img, { pixelRatio: RATIO });
  }
}
