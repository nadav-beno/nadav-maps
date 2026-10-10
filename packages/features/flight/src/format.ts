import { countryAt, formatDistance, isHebrew, nearestCity, worldName, type LngLat, type Units, type World } from '@nm/core';

/** A big number with its unit, for the flight readouts. */
export interface Readout {
  value: string;
  unit: string;
  /** Second line, e.g. the same value in other units. */
  sub?: string;
}

const n = (x: number) => Math.round(x).toLocaleString('en-US');

export function speedReadout(ms: number | null, units: Units): Readout {
  if (ms === null) return { value: '—', unit: units === 'imperial' ? 'מייל/שעה' : 'קמ״ש' };
  const knots = `${n(ms * 1.943844)} קשר`;
  return units === 'imperial' ? { value: n(ms * 2.236936), unit: 'מייל/שעה', sub: knots } : { value: n(ms * 3.6), unit: 'קמ״ש', sub: knots };
}

export function altitudeReadout(m: number | null, units: Units): Readout {
  if (m === null) return { value: '—', unit: units === 'imperial' ? 'רגל' : 'מ׳', sub: 'הגובה לא זמין' };
  const ft = `${n(m * 3.28084)} רגל`;
  return units === 'imperial' ? { value: n(m * 3.28084), unit: 'רגל', sub: `${n(m)} מ׳` } : { value: n(m), unit: 'מ׳', sub: ft };
}

const POINTS = ['צפון', 'צפון-מזרח', 'מזרח', 'דרום-מזרח', 'דרום', 'דרום-מערב', 'מערב', 'צפון-מערב'];

/** Eight-point compass name in Hebrew. */
export function compassName(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function headingReadout(deg: number | null): Readout {
  if (deg === null) return { value: '—', unit: '' };
  const d = Math.round((((deg % 360) + 360) % 360)) % 360;
  return { value: `${d}°`, unit: '', sub: compassName(d) };
}

/** "32.0800° N, 34.7800° E": hemisphere letters, read left to right. */
export function formatLatLng([lng, lat]: LngLat): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
}

/** "מאתונה" / "מ-Ouagadougou": the Hebrew "from" prefix joins Hebrew names only. */
const from = (name: string) => (isHebrew(name) ? `מ${name}` : `מ-${name}`);

/** What you are flying over, worked out from the bundled world map. */
export function aboveText(world: World, p: LngLat, units: Units): { title: string; near: string | null } {
  const country = countryAt(world, p);
  const near = nearestCity(world, p, 300);
  let nearText: string | null = null;
  if (near) {
    const name = worldName(near.city);
    nearText = near.distanceM < 15000 ? `מעל ${name}` : `${formatDistance(near.distanceM, units)} ${from(name)}`;
  }
  return { title: country ? worldName(country) : 'מעל הים', near: nearText };
}

/** Long distances (flown, remaining) in km or miles, with thousands separators. */
export function distanceReadout(m: number, units: Units): Readout {
  if (units === 'imperial') {
    const mi = m / 1609.344;
    return { value: mi < 10 ? mi.toFixed(1) : n(mi), unit: 'מייל' };
  }
  const km = m / 1000;
  return { value: km < 10 ? km.toFixed(1) : n(km), unit: 'ק״מ' };
}

/** "3:05" hours and minutes for elapsed flight time. */
export function formatElapsed(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}
