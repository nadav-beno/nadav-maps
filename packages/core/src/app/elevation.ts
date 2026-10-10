import { climb, sampleLine, terrariumHeight, tilePixel } from '../geo.ts';
import type { LngLat } from '../types.ts';
import { providers } from './state.ts';

/**
 * Elevation along a line, read in the browser from the same Terrarium tiles the map
 * uses for hill shading (no extra service). Null when the tiles can't be read.
 */
export interface ElevationProfile {
  points: { d: number; h: number }[];
  up: number;
  down: number;
  min: number;
  max: number;
}

const Z = 12;
const tiles = new Map<string, Promise<ImageData | null>>();

function tile(x: number, y: number): Promise<ImageData | null> {
  const key = `${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    const url = providers.value.terrain.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y));
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then(async (b) => {
        if (!b) return null;
        const bmp = await createImageBitmap(b);
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const g = canvas.getContext('2d', { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      })
      .catch(() => null);
    tiles.set(key, p);
  }
  return p;
}

export async function elevationProfile(line: LngLat[], samples = 80): Promise<ElevationProfile | null> {
  if (!providers.value.terrain || line.length < 2 || typeof OffscreenCanvas === 'undefined') return null;
  const pts = sampleLine(line, samples);
  const heights = await Promise.all(
    pts.map(async ({ p }) => {
      const t = tilePixel(p, Z);
      const img = await tile(t.x, t.y);
      if (!img) return null;
      const px = Math.min(img.width - 1, Math.floor((t.px / 256) * img.width));
      const py = Math.min(img.height - 1, Math.floor((t.py / 256) * img.height));
      const i = (py * img.width + px) * 4;
      return terrariumHeight(img.data[i], img.data[i + 1], img.data[i + 2]);
    }),
  );
  if (heights.some((h) => h === null || h < -500 || h > 9000)) return null;
  const hs = heights as number[];
  const min = Math.min(...hs), max = Math.max(...hs);
  return { points: pts.map((x, i) => ({ d: x.d, h: hs[i] })), ...climb(hs), min, max };
}
