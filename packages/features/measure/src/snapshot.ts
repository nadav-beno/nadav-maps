import type { Map as MapLibreMap } from 'maplibre-gl';
import { toast } from '@nm/core/app';

/** Plain-text credits of every source in the style ("© OpenStreetMap contributors"...). */
export function attributionText(map: MapLibreMap): string {
  const seen = new Set<string>();
  for (const src of Object.values(map.getStyle()?.sources ?? {})) {
    const html = (src as { attribution?: string }).attribution;
    if (!html) continue;
    const text = html.replace(/<[^>]*>/g, '').replace(/&copy;/g, '©').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text) seen.add(text);
  }
  return [...seen].join(' · ');
}

/**
 * Copies the map into a new canvas and draws the credits along the bottom (the data
 * licences require them on every copy). The WebGL canvas keeps no drawing buffer
 * (preserveDrawingBuffer would slow every frame), so the copy is taken inside a
 * 'render' event, while the frame just drawn is still there.
 */
export function captureMap(map: MapLibreMap): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    map.once('render', () => {
      try {
        const src = map.getCanvas();
        const out = document.createElement('canvas');
        out.width = src.width;
        out.height = src.height;
        const g = out.getContext('2d');
        if (!g) throw new Error('no 2d context');
        g.drawImage(src, 0, 0);
        drawCredits(g, out.width, out.height, src.width / (src.clientWidth || src.width), attributionText(map));
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });
    map.triggerRepaint();
  });
}

function drawCredits(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, text: string) {
  const pad = Math.round(6 * dpr);
  let size = 11 * dpr;
  const font = (s: number) => `${s}px 'Rubik Variable', system-ui, sans-serif`;
  g.font = font(size);
  // Shrink to fit narrow (phone) images rather than cutting the credits off.
  while (size > 7 * dpr && g.measureText(text).width > w - pad * 2) g.font = font((size -= dpr / 2));
  const band = Math.round(size + pad * 1.6);
  g.fillStyle = 'rgba(255, 255, 255, 0.82)';
  g.fillRect(0, h - band, w, band);
  g.fillStyle = '#3c4043';
  g.textBaseline = 'middle';
  g.direction = 'rtl';
  g.textAlign = 'right';
  g.fillText(text, w - pad, h - band / 2, w - pad * 2);
}

function fileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `nadav-maps-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

/** Saves the current map as a PNG: the share sheet on phones, a download elsewhere. */
export async function saveMapImage(map: MapLibreMap): Promise<void> {
  let blob: Blob | null;
  try {
    const canvas = await captureMap(map);
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('empty image');
  } catch {
    toast('לא הצלחנו לשמור את תמונת המפה');
    return;
  }
  const name = fileName();
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'מפה' });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // Not allowed (e.g. the tap is too long ago): fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  toast('תמונת המפה נשמרה');
}
