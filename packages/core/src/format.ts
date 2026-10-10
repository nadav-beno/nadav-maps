/** Display formatting. Hebrew UI, units from the region (metric/imperial). */

export type Units = 'metric' | 'imperial';

export function formatDistance(m: number, units: Units = 'metric'): string {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.round(ft / 10) * 10} רגל`;
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} מייל`;
  }
  if (m < 50) return `${Math.max(5, Math.round(m / 5) * 5)} מ׳`;
  if (m < 1000) return `${Math.round(m / 10) * 10} מ׳`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} ק״מ`;
}

const num = (n: number, digits = 0) => n.toLocaleString('he-IL', { maximumFractionDigits: digits });
const digitsFor = (n: number) => (n < 10 ? 2 : n < 100 ? 1 : 0);

/**
 * An area for display. Metric: m², then dunams where the region speaks Hebrew (the unit
 * Israelis use for plots), hectares elsewhere, then km². Imperial: ft², acres, mi².
 */
export function formatArea(m2: number, units: Units = 'metric', lang = 'he'): string {
  if (units === 'imperial') {
    const acres = m2 / 4046.8564224;
    if (acres < 0.25) return `${num(Math.round(m2 * 10.7639104))} רגל רבועה`;
    if (acres < 640) return `${num(acres, digitsFor(acres))} אייקר`;
    const mi2 = m2 / 2589988.110336;
    return `${num(mi2, digitsFor(mi2))} מייל רבוע`;
  }
  if (m2 < (lang === 'he' ? 1000 : 10000)) return `${num(Math.round(m2))} מ״ר`;
  if (m2 < 1_000_000) {
    const v = lang === 'he' ? m2 / 1000 : m2 / 10000;
    return `${num(v, digitsFor(v))} ${lang === 'he' ? 'דונם' : 'הקטאר'}`;
  }
  const km2 = m2 / 1_000_000;
  return `${num(km2, digitsFor(km2))} קמ״ר`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} דק׳`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} ימים ${h % 24} שע׳`;
  }
  return rest ? `${h} שע׳ ${rest} דק׳` : `${h} שע׳`;
}

/** Clock time of arrival, e.g. "14:35", in the given (or local) time zone. */
export function formatArrival(secondsFromNow: number, now = Date.now(), timeZone?: string): string {
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(
    new Date(now + secondsFromNow * 1000),
  );
}

export function formatCoords(lng: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** "08:12" for an ISO time, in the given (or local) time zone. */
export function formatClock(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(d);
}

/** "עכשיו" / "בעוד 4 דק׳" / "14:35" for a departure, like transit apps do. */
export function formatDeparture(iso: string, now = Date.now(), timeZone?: string): string {
  const min = Math.round((new Date(iso).getTime() - now) / 60000);
  if (min <= 0) return 'עכשיו';
  if (min < 60) return `בעוד ${min} דק׳`;
  return formatClock(iso, timeZone);
}

/** Minutes a live time is late (+) or early (−) against the timetable. */
export function delayMinutes(actual: string, scheduled: string): number {
  return Math.round((new Date(actual).getTime() - new Date(scheduled).getTime()) / 60000);
}
