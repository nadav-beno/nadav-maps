/** Times of the forecast, shown in the point's own time zone. */

const clocks = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = tz + JSON.stringify(opts);
  let f = clocks.get(k);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('he-IL', { ...opts, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat('he-IL', opts);
    }
    clocks.set(k, f);
  }
  return f;
}

/** "14:05". */
export function clock(t: number, tz: string): string {
  return fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t * 1000);
}

/** "14" for an hour column. */
export function hourLabel(t: number, tz: string): string {
  return fmt(tz, { hour: '2-digit', hourCycle: 'h23' }).format(t * 1000).replace(/^0/, '');
}

/** "היום", then short weekday names ("יום ה׳"). */
export function dayLabel(t: number, tz: string, index: number): string {
  if (index === 0) return 'היום';
  // Daily times are local midnight; noon avoids any DST edge.
  return fmt(tz, { weekday: 'short' }).format((t + 12 * 3600) * 1000);
}
