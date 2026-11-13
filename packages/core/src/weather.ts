import type { Units } from './format.ts';

/**
 * Pure weather helpers shared by the weather tools and the weather feature: WMO weather codes
 * in Hebrew, UV bands (WHO), wind, visibility, the moon, unit conversion, colour ramps and the
 * point lattice + interpolation that draw the weather map layers.
 */

// ---------- conditions (WMO weather codes, as Open-Meteo returns them) ----------

export type WeatherScene = 'clear-day' | 'clear-night' | 'cloudy-day' | 'cloudy-night' | 'rain' | 'storm' | 'snow' | 'fog';

const CODES: Record<number, string> = {
  0: 'בהיר',
  1: 'בהיר ברובו',
  2: 'מעונן חלקית',
  3: 'מעונן',
  45: 'ערפל',
  48: 'ערפל קפוא',
  51: 'טפטוף קל',
  53: 'טפטוף',
  55: 'טפטוף כבד',
  56: 'טפטוף קפוא',
  57: 'טפטוף קפוא',
  61: 'גשם קל',
  63: 'גשם',
  65: 'גשם כבד',
  66: 'גשם קפוא',
  67: 'גשם קפוא',
  71: 'שלג קל',
  73: 'שלג',
  75: 'שלג כבד',
  77: 'גרגרי שלג',
  80: 'ממטרים קלים',
  81: 'ממטרים',
  82: 'ממטרים עזים',
  85: 'ממטרי שלג',
  86: 'ממטרי שלג כבדים',
  95: 'סופת רעמים',
  96: 'סופת רעמים וברד',
  99: 'סופת רעמים וברד כבד',
};

/** Hebrew description of a WMO weather code ("מעונן חלקית"). */
export function weatherText(code: number | null | undefined, isDay = true): string {
  if (code === null || code === undefined) return 'אין נתון';
  if (!isDay && code === 0) return 'לילה בהיר';
  return CODES[code] ?? 'אין נתון';
}

/** Material Symbols name for a WMO weather code. */
export function weatherIcon(code: number | null | undefined, isDay = true): string {
  if (code === null || code === undefined) return 'cloud';
  if (code <= 1) return isDay ? 'sunny' : 'moon_stars';
  if (code === 2) return isDay ? 'partly_cloudy_day' : 'partly_cloudy_night';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'rainy_light';
  if (code === 65 || code === 82) return 'rainy_heavy';
  if (code === 66 || code === 67) return 'weather_mix';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'weather_snowy';
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rainy';
  if (code >= 95) return 'thunderstorm';
  return 'cloud';
}

/** The background mood for a condition (gradients are ours, see styles.css `.wx-scene-*`). */
export function weatherScene(code: number | null | undefined, isDay = true): WeatherScene {
  const c = code ?? 0;
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if (c >= 51) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 2) return isDay ? 'cloudy-day' : 'cloudy-night';
  return isDay ? 'clear-day' : 'clear-night';
}

// ---------- UV (WHO bands) ----------

export interface UvBand {
  label: string;
  color: string;
  advice: string;
}

export function uvBand(uv: number | null | undefined): UvBand {
  const v = uv ?? 0;
  if (v < 3) return { label: 'נמוך', color: '#4eb400', advice: 'אין צורך בהגנה מיוחדת.' };
  if (v < 6) return { label: 'בינוני', color: '#f7e400', advice: 'כדאי כובע ומשקפי שמש, וקרם הגנה בשעות הצהריים.' };
  if (v < 8) return { label: 'גבוה', color: '#f85900', advice: 'קרם הגנה, כובע ומשקפי שמש. בצהריים עדיף בצל.' };
  if (v < 11) return { label: 'גבוה מאוד', color: '#d8001d', advice: 'הימנעו משמש ישירה בין 11:00 ל-15:00. קרם הגנה כל שעתיים.' };
  return { label: 'קיצוני', color: '#6b49c8', advice: 'הישארו בצל ככל האפשר. עור לא מוגן נכווה תוך דקות.' };
}

// ---------- wind, visibility, feels like ----------

const DIRS = ['צפונית', 'צפון-מזרחית', 'מזרחית', 'דרום-מזרחית', 'דרומית', 'דרום-מערבית', 'מערבית', 'צפון-מערבית'];

/** "רוח מערבית": the direction the wind blows FROM (meteorological degrees). */
export function windFrom(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return '';
  return DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Beaufort force from km/h. */
export function beaufort(kmh: number): number {
  const limits = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const i = limits.findIndex((l) => kmh < l);
  return i === -1 ? 12 : i;
}

export function windLabel(kmh: number | null | undefined): string {
  const v = kmh ?? 0;
  if (v < 6) return 'שקט';
  if (v < 20) return 'רוח קלה';
  if (v < 39) return 'רוח מתונה';
  if (v < 62) return 'רוח חזקה';
  if (v < 89) return 'סערה';
  return 'סערה עזה';
}

/** Visibility in metres → words. */
export function visibilityLabel(m: number | null | undefined): string {
  if (m === null || m === undefined) return 'אין נתון';
  if (m < 1000) return 'ערפל';
  if (m < 4000) return 'ראות לקויה';
  if (m < 10000) return 'ראות בינונית';
  if (m < 20000) return 'ראות טובה';
  return 'ראות מצוינת';
}

/** Why it feels warmer or colder than the thermometer says. */
export function feelsLikeNote(temp: number, feels: number, humidity: number, wind: number): string {
  const d = feels - temp;
  if (Math.abs(d) < 1.5) return 'מרגיש בערך כמו הטמפרטורה בפועל.';
  if (d > 0) return humidity >= 50 ? 'הלחות גורמת להרגיש חם יותר.' : 'השמש והאוויר היבש גורמים להרגיש חם יותר.';
  return wind >= 15 ? 'הרוח גורמת להרגיש קר יותר.' : 'מרגיש קר יותר מהטמפרטורה בפועל.';
}

// ---------- the moon ----------

export interface MoonPhase {
  /** 0 = new, 0.5 = full, back to 1. */
  phase: number;
  /** Lit fraction, 0..1. */
  illumination: number;
  name: string;
}

const SYNODIC = 29.530588853;
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14) / 86400000;

export function moonPhase(at: Date | number = Date.now()): MoonPhase {
  const days = (typeof at === 'number' ? at : at.getTime()) / 86400000;
  const phase = ((((days - NEW_MOON_REF) / SYNODIC) % 1) + 1) % 1;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const name =
    phase < 0.03 || phase > 0.97
      ? 'מולד'
      : phase < 0.22
        ? 'סהר מתמלא'
        : phase < 0.28
          ? 'רבע ראשון'
          : phase < 0.47
            ? 'ירח מתמלא'
            : phase < 0.53
              ? 'ירח מלא'
              : phase < 0.72
                ? 'ירח מתמעט'
                : phase < 0.78
                  ? 'רבע אחרון'
                  : 'סהר מתמעט';
  return { phase, illumination, name };
}

// ---------- units (the API answers in metric; convert for display) ----------

export function fmtTemp(c: number | null | undefined, units: Units = 'metric'): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return '–';
  return `${Math.round(units === 'imperial' ? (c * 9) / 5 + 32 : c)}°`;
}

export function fmtWind(kmh: number | null | undefined, units: Units = 'metric'): string {
  if (kmh === null || kmh === undefined) return '–';
  return units === 'imperial' ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} קמ״ש`;
}

export function fmtPrecip(mm: number | null | undefined, units: Units = 'metric'): string {
  if (mm === null || mm === undefined) return '–';
  if (units === 'imperial') return `${(mm / 25.4).toFixed(mm > 0 && mm < 2.54 ? 2 : 1)} אינץ׳`;
  return `${mm < 10 && mm % 1 ? mm.toFixed(1) : Math.round(mm)} מ״מ`;
}

export function fmtVisibility(m: number | null | undefined, units: Units = 'metric'): string {
  if (m === null || m === undefined) return '–';
  if (units === 'imperial') {
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} מייל`;
  }
  const km = m / 1000;
  return `${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)} ק״מ`;
}

export function fmtPressure(hpa: number | null | undefined, units: Units = 'metric'): string {
  if (hpa === null || hpa === undefined) return '–';
  return units === 'imperial' ? `${(hpa * 0.02953).toFixed(2)} inHg` : `${Math.round(hpa)} hPa`;
}

// ---------- colour ramps for the map layers ----------

export type Rgba = [number, number, number, number];
/** Value stops, ascending. */
export type Ramp = [number, Rgba][];

export type WeatherLayerId = 'temp' | 'precip' | 'wind' | 'uv' | 'cloud' | 'vis';

export const WEATHER_RAMPS: Record<WeatherLayerId, Ramp> = {
  temp: [
    [-20, [110, 64, 170, 1]],
    [-10, [76, 110, 219, 1]],
    [0, [35, 171, 216, 1]],
    [10, [29, 223, 163, 1]],
    [18, [166, 227, 75, 1]],
    [25, [242, 201, 49, 1]],
    [32, [246, 116, 58, 1]],
    [40, [214, 58, 46, 1]],
    [48, [122, 4, 3, 1]],
  ],
  precip: [
    [0, [77, 171, 247, 0]],
    [0.09, [77, 171, 247, 0]],
    [0.1, [116, 192, 252, 0.55]],
    [1, [51, 154, 240, 0.8]],
    [3, [28, 126, 214, 0.9]],
    [6, [252, 196, 25, 0.95]],
    [12, [247, 103, 7, 1]],
    [25, [224, 49, 49, 1]],
    [50, [174, 62, 201, 1]],
  ],
  wind: [
    [0, [208, 235, 255, 1]],
    [10, [116, 192, 252, 1]],
    [20, [99, 230, 190, 1]],
    [30, [255, 224, 102, 1]],
    [45, [255, 169, 77, 1]],
    [60, [255, 107, 107, 1]],
    [80, [204, 93, 232, 1]],
    [110, [95, 61, 196, 1]],
  ],
  uv: [
    [0, [78, 180, 0, 1]],
    [2.5, [160, 206, 0, 1]],
    [3, [247, 228, 0, 1]],
    [5.5, [248, 182, 0, 1]],
    [6, [248, 135, 0, 1]],
    [7.5, [248, 89, 0, 1]],
    [8, [232, 44, 14, 1]],
    [10.5, [216, 0, 29, 1]],
    [11, [181, 76, 255, 1]],
    [14, [107, 73, 200, 1]],
  ],
  cloud: [
    [0, [120, 130, 145, 0]],
    [15, [120, 130, 145, 0]],
    [50, [125, 135, 150, 0.45]],
    [100, [110, 118, 130, 0.85]],
  ],
  vis: [
    [0, [120, 120, 135, 0.9]],
    [1000, [140, 140, 155, 0.75]],
    [5000, [165, 165, 180, 0.4]],
    [10000, [190, 190, 200, 0.12]],
    [20000, [200, 200, 210, 0]],
  ],
};

export function rampColor(ramp: Ramp, v: number): Rgba {
  if (v <= ramp[0][0]) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) {
    const [b, cb] = ramp[i];
    if (v <= b) {
      const [a, ca] = ramp[i - 1];
      const t = (v - a) / (b - a || 1);
      return [0, 1, 2, 3].map((k) => ca[k] + (cb[k] - ca[k]) * t) as Rgba;
    }
  }
  return ramp[ramp.length - 1][1];
}

export function rgbaCss([r, g, b, a]: Rgba): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Number(a.toFixed(3))})`;
}

// ---------- the point lattice behind the map layers ----------

/** Lattice steps in degrees; each is a subset of the finer ones, so zooming reuses points. */
const STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16];

export interface Lattice {
  step: number;
  /** Ascending. */
  lngs: number[];
  /** Ascending (south to north). */
  lats: number[];
}

/**
 * Regular points over a [west, south, east, north] box, one step beyond each edge, with the
 * finest step that keeps the count at or under `maxPoints`. Points sit on multiples of the step,
 * so panning and zooming hit the same coordinates again (and the cache).
 */
export function latticeFor([w, s, e, n]: [number, number, number, number], maxPoints = 160): Lattice {
  const west = Math.max(-180, w), east = Math.min(180, e);
  const south = Math.max(-80, s), north = Math.min(80, n);
  for (const step of STEPS) {
    const l = build(step);
    if (l.lngs.length * l.lats.length <= maxPoints || step === STEPS[STEPS.length - 1]) return l;
  }
  return build(STEPS[STEPS.length - 1]);
  function build(step: number): Lattice {
    const axis = (a: number, b: number, lo: number, hi: number) => {
      const out: number[] = [];
      for (let k = Math.floor(a / step) - 1; k <= Math.ceil(b / step) + 1; k++) {
        const v = Number((k * step).toFixed(4));
        if (v >= lo && v <= hi) out.push(v);
      }
      return out;
    };
    return { step, lngs: axis(west, east, -180, 180), lats: axis(south, north, -85, 85) };
  }
}

/** Key for a lattice point (also the cache key). */
export const pointKey = (lng: number, lat: number) => `${lng.toFixed(3)},${lat.toFixed(3)}`;

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOfMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/**
 * Bilinear value at a point inside the lattice. `values[row][col]` with rows = lats.
 * Missing corners are skipped (weights renormalised); null when all four are missing.
 */
export function sampleLattice(l: Lattice, values: (number | null)[][], lng: number, lat: number): number | null {
  const fx = clampIdx((lng - l.lngs[0]) / l.step, l.lngs.length);
  const fy = clampIdx((lat - l.lats[0]) / l.step, l.lats.length);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, l.lngs.length - 1), y1 = Math.min(y0 + 1, l.lats.length - 1);
  const tx = fx - x0, ty = fy - y0;
  let sum = 0, wsum = 0;
  for (const [x, y, wt] of [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty],
    [x1, y1, tx * ty],
  ] as const) {
    const v = values[y]?.[x];
    if (v === null || v === undefined || !Number.isFinite(v) || wt <= 0) continue;
    sum += v * wt;
    wsum += wt;
  }
  if (wsum > 0) return sum / wsum;
  // Exactly on a missing point: try the nearest corner with data.
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const v = values[y]?.[x];
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

function clampIdx(f: number, n: number): number {
  return Math.max(0, Math.min(n - 1, f));
}

/**
 * RGBA pixels of a smooth colour field over the lattice, rows evenly spaced in Web Mercator so
 * the image lines up with the map. Covers [lngs[0], lats[0], lngs.at(-1), lats.at(-1)].
 */
export function renderField(l: Lattice, values: (number | null)[][], ramp: Ramp, width: number, height: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  const w = l.lngs[0], e = l.lngs[l.lngs.length - 1];
  const yn = mercY(l.lats[l.lats.length - 1]), ys = mercY(l.lats[0]);
  for (let y = 0; y < height; y++) {
    const lat = latOfMercY(yn - ((y + 0.5) / height) * (yn - ys));
    for (let x = 0; x < width; x++) {
      const lng = w + ((x + 0.5) / width) * (e - w);
      const v = sampleLattice(l, values, lng, lat);
      if (v === null) continue;
      const c = rampColor(ramp, v);
      const i = (y * width + x) * 4;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = Math.round(c[3] * 255);
    }
  }
  return px;
}

// ---------- "מזג אוויר בחיפה" in the search box ----------

/** Place names that really start with ב, so "מזג אוויר באר שבע" keeps it. */
const STARTS_WITH_BET = /^(באר|בית|בני|בת ים|בנימינה|בקה|בועיינה|ביר|ברקן|בארות|בוסתן|בצרה|בר |ברור|בורגתה|בן |בסמת|בענה|ברעם)/;

/**
 * Recognises a weather question typed in the search box. Returns null when it isn't one,
 * `{ place: '' }` for weather here, or candidate place names to look up, best first.
 */
export function parseWeatherQuery(text: string): { place: string; candidates: string[] } | null {
  const m = /^\s*(?:(?:תחזית\s+)?מזג[\s-]*(?:ה)?\s*אוויר|weather|forecast)(?=\s|$)\s*/i.exec(text);
  if (!m) return null;
  const rest = text.slice(m[0].length).trim().replace(/^(?:in|at|for)\s+/i, '').replace(/^[בל]-/, '').trim();
  if (!rest) return { place: '', candidates: [] };
  const stripped = /^[בל][^\s]/.test(rest) ? rest.slice(1) : rest;
  const candidates = STARTS_WITH_BET.test(rest) ? [rest, stripped] : [stripped, rest];
  return { place: candidates[0], candidates: [...new Set(candidates)] };
}
