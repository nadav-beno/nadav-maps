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
