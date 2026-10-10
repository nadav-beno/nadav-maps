/** Calendar days in a time zone, without a date library. Days are "YYYY-MM-DD" strings. */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(t: number, timeZone?: string): Record<string, number> {
  const key = timeZone ?? '';
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(key, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(t))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** Offset of the zone from UTC at instant `t`, in ms (Jerusalem in summer: +3 h). */
export function tzOffsetMs(t: number, timeZone?: string): number {
  const p = parts(t, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(t: number, timeZone?: string): string {
  const p = parts(t, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** [start, end) of a day in the zone, in epoch ms. Handles DST days (23 or 25 hours). */
export function dayRange(day: string, timeZone?: string): [number, number] {
  const midnight = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, dd);
    let t = guess - tzOffsetMs(guess, timeZone);
    const off2 = tzOffsetMs(t, timeZone);
    if (guess - off2 !== t) t = guess - off2;
    return t;
  };
  return [midnight(day), midnight(addDays(day, 1))];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
