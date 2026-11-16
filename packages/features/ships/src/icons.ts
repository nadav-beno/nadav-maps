import type { Map as MapLibreMap } from 'maplibre-gl';
import { CATEGORY_COLOR, SHIP_CATEGORIES, type ShipCategory } from '@nm/core';

/**
 * Our own top-down ship silhouettes, bow up (north), one per kind of ship, so a container ship,
 * a tanker, a ferry, a fishing boat, a tug, a yacht and a warship each read at a glance, the way
 * the live flights map draws an airliner, a helicopter or a fighter. Drawn on a canvas at runtime
 * in the kind's colour with an outline and a soft shadow (no files to ship):
 * - `ship-<category>`: the silhouette, rotated on the map to the heading;
 * - `ship-<category>-stop`: a round badge for a ship at anchor or moored when zoomed out (and when
 *   it sends no heading), so harbours don't turn into a pile of arrows.
 */

export type Silhouette = 'container' | 'tanker' | 'passenger' | 'fast' | 'fishing' | 'tug' | 'sail' | 'warship' | 'generic';

export const SILHOUETTE: Record<ShipCategory, Silhouette> = {
  cargo: 'container',
  tanker: 'tanker',
  passenger: 'passenger',
  fast: 'fast',
  fishing: 'fishing',
  service: 'tug',
  pleasure: 'sail',
  gov: 'warship',
  other: 'generic',
  unknown: 'generic',
};

export const shipIcon = (cat: ShipCategory) => `ship-${cat}`;
export const stopIcon = (cat: ShipCategory) => `ship-${cat}-stop`;

const RATIO = 2;
/** Canvas size in CSS px at icon-size 1 (width, height): big ships long, small craft short. */
export const SIZE: Record<Silhouette, [number, number]> = {
  container: [17, 38],
  tanker: [17, 38],
  passenger: [17, 35],
  warship: [15, 35],
  generic: [15, 31],
  fishing: [20, 26],
  tug: [14, 23],
  fast: [12, 25],
  sail: [14, 26],
};
const STOP_PX = 14;

type Ctx = CanvasRenderingContext2D;

/** The hull outline in a W x H box (bow at the top): `bow` = how much of the length the bow takes. */
function hull(W: number, H: number, bow: number, opts: { stern?: number; inset?: number; top?: number } = {}): Path2D {
  const i = opts.inset ?? 0;
  const l = i, r = W - i, t = opts.top ?? 0, b = H;
  const mid = W / 2;
  const bl = (b - t) * bow;
  const sr = opts.stern ?? W * 0.18;
  const p = new Path2D();
  p.moveTo(mid, t);
  p.bezierCurveTo(mid + (r - mid) * 0.6, t + bl * 0.25, r, t + bl * 0.65, r, t + bl);
  p.lineTo(r, b - sr);
  p.quadraticCurveTo(r, b, r - sr, b);
  p.lineTo(l + sr, b);
  p.quadraticCurveTo(l, b, l, b - sr);
  p.lineTo(l, t + bl);
  p.bezierCurveTo(l, t + bl * 0.65, mid - (mid - l) * 0.6, t + bl * 0.25, mid, t);
  p.closePath();
  return p;
}

function rect(x: number, y: number, w: number, h: number, r = 0): Path2D {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
}

const WHITE = 'rgba(255,255,255,0.9)';
const PALE = 'rgba(255,255,255,0.42)';
const SHADE = 'rgba(0,0,0,0.28)';

/** Paints one silhouette in a W x H box (already scaled to the canvas). */
function paint(ctx: Ctx, kind: Silhouette, W: number, H: number, fill: string, edge: string) {
  const body = (p: Path2D, lw = 1.3) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetY = 0.6;
    ctx.strokeStyle = edge;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.stroke(p);
    ctx.restore();
    ctx.fillStyle = fill;
    ctx.fill(p);
  };
  const fillP = (p: Path2D, c: string) => {
    ctx.fillStyle = c;
    ctx.fill(p);
  };
  const pad = 1.4;
  const w = W - 2 * pad, h = H - 2 * pad;
  ctx.translate(pad, pad);
  switch (kind) {
    case 'container': {
      body(hull(w, h, 0.2));
      // Rows of containers, a little gap between the bays.
      const bays = 5;
      const top = h * 0.17, bottom = h * 0.78, gap = 0.9;
      const bh = (bottom - top - gap * (bays - 1)) / bays;
      for (let k = 0; k < bays; k++) {
        const y = top + k * (bh + gap);
        fillP(rect(w * 0.17, y, w * 0.31, bh, 0.4), k % 2 ? PALE : 'rgba(255,255,255,0.6)');
        fillP(rect(w * 0.52, y, w * 0.31, bh, 0.4), k % 2 ? 'rgba(255,255,255,0.6)' : PALE);
      }
      fillP(rect(w * 0.14, h * 0.82, w * 0.72, h * 0.08, 0.8), WHITE);
      break;
    }
    case 'tanker': {
      body(hull(w, h, 0.15, { stern: w * 0.24 }));
      // The pipeline down the deck and the manifold across it.
      fillP(rect(w * 0.46, h * 0.1, w * 0.08, h * 0.68), WHITE);
      fillP(rect(w * 0.2, h * 0.43, w * 0.6, h * 0.035), WHITE);
      for (const y of [0.2, 0.62]) {
        const c = new Path2D();
        c.arc(w * 0.5, h * y, w * 0.17, 0, Math.PI * 2);
        fillP(c, PALE);
      }
      fillP(rect(w * 0.14, h * 0.82, w * 0.72, h * 0.09, 0.8), WHITE);
      break;
    }
    case 'passenger': {
      body(hull(w, h, 0.22, { stern: w * 0.3 }));
      // Decks almost end to end, lifeboats along the sides and a funnel aft.
      fillP(rect(w * 0.18, h * 0.16, w * 0.64, h * 0.76, w * 0.22), WHITE);
      for (let k = 0; k < 5; k++) {
        fillP(rect(w * 0.06, h * (0.3 + k * 0.11), w * 0.1, h * 0.07, 0.6), fill);
        fillP(rect(w * 0.84, h * (0.3 + k * 0.11), w * 0.1, h * 0.07, 0.6), fill);
      }
      fillP(rect(w * 0.36, h * 0.7, w * 0.28, h * 0.1, w * 0.1), fill);
      fillP(rect(w * 0.3, h * 0.22, w * 0.4, h * 0.05, 0.6), SHADE);
      break;
    }
    case 'fast': {
      body(hull(w, h, 0.5, { stern: w * 0.12 }));
      // The windscreen and the cockpit.
      const ws = new Path2D();
      ws.moveTo(w * 0.2, h * 0.52);
      ws.quadraticCurveTo(w * 0.5, h * 0.38, w * 0.8, h * 0.52);
      ws.lineTo(w * 0.8, h * 0.58);
      ws.quadraticCurveTo(w * 0.5, h * 0.46, w * 0.2, h * 0.58);
      ws.closePath();
      fillP(ws, WHITE);
      fillP(rect(w * 0.25, h * 0.64, w * 0.5, h * 0.22, 1.2), PALE);
      break;
    }
    case 'fishing': {
      // The hull is narrower than the box: the outrigger booms reach out to the sides.
      const hw = w * 0.56, hx = (w - hw) / 2;
      ctx.save();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      const booms = () => {
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.48);
        ctx.lineTo(w * 0.04, h * 0.7);
        ctx.moveTo(w * 0.5, h * 0.48);
        ctx.lineTo(w * 0.96, h * 0.7);
      };
      booms();
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1.1;
      booms();
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(hx, 0);
      body(hull(hw, h, 0.3, { stern: hw * 0.2 }));
      fillP(rect(hw * 0.2, h * 0.24, hw * 0.6, h * 0.2, 1), WHITE);
      fillP(rect(hw * 0.3, h * 0.6, hw * 0.4, h * 0.26, 0.8), PALE);
      ctx.restore();
      break;
    }
    case 'tug': {
      // Short and wide, a thick fender all round, the wheelhouse forward and the tow hook aft.
      const p = hull(w, h, 0.34, { stern: w * 0.36 });
      body(p, 2.4);
      ctx.strokeStyle = SHADE;
      ctx.lineWidth = 1.3;
      ctx.stroke(p);
      fillP(rect(w * 0.26, h * 0.26, w * 0.48, h * 0.26, 1.2), WHITE);
      const hook = new Path2D();
      hook.arc(w * 0.5, h * 0.76, w * 0.11, 0, Math.PI * 2);
      fillP(hook, WHITE);
      break;
    }
    case 'sail': {
      body(hull(w, h, 0.42, { stern: w * 0.2, inset: w * 0.1 }));
      // The sail from the mast to the boom, filled by the wind to one side.
      const sail = new Path2D();
      sail.moveTo(w * 0.5, h * 0.3);
      sail.quadraticCurveTo(w * 0.98, h * 0.5, w * 0.62, h * 0.86);
      sail.lineTo(w * 0.5, h * 0.3);
      sail.closePath();
      ctx.save();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.9;
      ctx.stroke(sail);
      ctx.restore();
      fillP(sail, WHITE);
      const mast = new Path2D();
      mast.arc(w * 0.5, h * 0.3, w * 0.09, 0, Math.PI * 2);
      fillP(mast, edge);
      break;
    }
    case 'warship': {
      // Angular: a sharp bow, straight lines, a gun forward, a helicopter deck aft.
      const p = new Path2D();
      p.moveTo(w / 2, 0);
      p.lineTo(w, h * 0.3);
      p.lineTo(w, h * 0.96);
      p.lineTo(w * 0.86, h);
      p.lineTo(w * 0.14, h);
      p.lineTo(0, h * 0.96);
      p.lineTo(0, h * 0.3);
      p.closePath();
      body(p);
      const gun = new Path2D();
      gun.arc(w * 0.5, h * 0.24, w * 0.15, 0, Math.PI * 2);
      fillP(gun, PALE);
      fillP(rect(w * 0.47, h * 0.1, w * 0.06, h * 0.12), PALE);
      fillP(rect(w * 0.26, h * 0.36, w * 0.48, h * 0.32, 0.8), WHITE);
      fillP(rect(w * 0.38, h * 0.44, w * 0.24, h * 0.1, 0.6), SHADE);
      ctx.save();
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.84, w * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    default: {
      body(hull(w, h, 0.3));
      fillP(rect(w * 0.3, h * 0.2, w * 0.4, h * 0.5, 1), PALE);
      fillP(rect(w * 0.16, h * 0.76, w * 0.68, h * 0.1, 0.8), WHITE);
    }
  }
}

type Img = { width: number; height: number; data: Uint8ClampedArray };

function canvas(wPx: number, hPx: number): [HTMLCanvasElement, Ctx] | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = wPx;
  el.height = hPx;
  const ctx = el.getContext('2d');
  return ctx ? [el, ctx] : null;
}

function drawSilhouette(kind: Silhouette, fill: string, edge: string): Img | null {
  const [W, H] = SIZE[kind];
  const c = canvas(W * RATIO, H * RATIO);
  if (!c) return null;
  const [, ctx] = c;
  ctx.scale(RATIO, RATIO);
  paint(ctx, kind, W, H, fill, edge);
  return { width: W * RATIO, height: H * RATIO, data: ctx.getImageData(0, 0, W * RATIO, H * RATIO).data };
}

/** Stopped: a dot in the kind's colour with a pale centre, like a pin in the harbour. */
function drawStop(fill: string, edge: string): Img | null {
  const px = STOP_PX * RATIO;
  const c = canvas(px, px);
  if (!c) return null;
  const [, ctx] = c;
  ctx.scale(RATIO, RATIO);
  const r = STOP_PX / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 2, 0, Math.PI * 2);
  ctx.fillStyle = edge;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(r, r, r - 3.2, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r, r, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  return { width: px, height: px, data: ctx.getImageData(0, 0, px, px).data };
}

/** Adds (or replaces, after a theme change) every ship image on the map. */
export function addShipIcons(map: MapLibreMap, dark: boolean) {
  const edge = dark ? '#111418' : '#ffffff';
  for (const c of SHIP_CATEGORIES) {
    const color = CATEGORY_COLOR[c.id];
    for (const [id, img] of [
      [shipIcon(c.id), drawSilhouette(SILHOUETTE[c.id], color, edge)],
      [stopIcon(c.id), drawStop(color, edge)],
    ] as const) {
      if (!img) continue;
      if (map.hasImage(id)) map.updateImage(id, img);
      else map.addImage(id, img, { pixelRatio: RATIO });
    }
  }
}

const pictures = new Map<string, string>();
/**
 * A picture of the kind of ship as a data: URL (cached): `side` = big, lying on its side with the
 * bow to the left as Hebrew reads, for the ship card when there is no photo of the ship itself;
 * `thumb` = small and upright, for the kind chips.
 */
export function shipPicture(cat: ShipCategory, dark: boolean, mode: 'side' | 'thumb'): string {
  const key = `${cat}-${dark ? 1 : 0}-${mode}`;
  const had = pictures.get(key);
  if (had) return had;
  const kind = SILHOUETTE[cat];
  const [W, H] = SIZE[kind];
  const side = mode === 'side';
  const scale = side ? 4 : 18 / 38 * 2;
  const c = side ? canvas(Math.round(H * scale * 1.15), Math.round(W * scale * 1.5)) : canvas(Math.round(W * scale) + 2, Math.round(H * scale) + 2);
  if (!c) return '';
  const [el, ctx] = c;
  ctx.translate(el.width / 2, el.height / 2);
  if (side) ctx.rotate(-Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.translate(-W / 2, -H / 2);
  paint(ctx, kind, W, H, CATEGORY_COLOR[cat], dark ? '#111418' : '#ffffff');
  let url = '';
  try {
    url = el.toDataURL('image/png');
  } catch {
    /* no canvas (tests) */
  }
  if (url) pictures.set(key, url);
  return url;
}
