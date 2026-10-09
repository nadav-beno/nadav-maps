/** Opening hours ("Mo-Fr 08:00-17:00") -> "open now / closes at 17:00" and a weekly table, in Hebrew. */

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export interface HoursInfo {
  open: boolean | null;
  /** e.g. "נסגר ב-17:00", "נפתח מחר ב-08:00". */
  status: string;
  week: { day: string; hours: string; today: boolean }[];
  /** True when the rule depends on things we can't evaluate (e.g. "by appointment"). */
  unsure: boolean;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function when(next: Date, now: Date): string {
  const days = Math.round((new Date(next).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `ב-${hhmm(next)}`;
  if (days === 1) return `מחר ב-${hhmm(next)}`;
  return `ביום ${DAYS[next.getDay()]} ב-${hhmm(next)}`;
}

export async function parseHours(value: string, lat: number, lng: number, countryCode = 'il', now = new Date()): Promise<HoursInfo | null> {
  let oh: import('opening_hours').default;
  try {
    const { default: OpeningHours } = await import('opening_hours');
    oh = new OpeningHours(value, { lat, lon: lng, address: { country_code: countryCode, state: '' } } as never, {
      mode: 0,
      tag_key: 'opening_hours',
      locale: 'en',
    } as never);
  } catch {
    return null;
  }
  const unsure = oh.getUnknown(now);
  const open = unsure ? null : oh.getState(now);
  const next = oh.getNextChange(now);
  let status: string;
  if (open === null) status = 'שעות לא ודאיות';
  else if (open) status = next ? `פתוח · נסגר ${when(next, now)}` : 'פתוח 24 שעות';
  else status = next ? `סגור · נפתח ${when(next, now)}` : 'סגור';

  const week: HoursInfo['week'] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // Show the week starting Sunday, as Israeli calendars do.
  start.setDate(start.getDate() - start.getDay());
  for (let i = 0; i < 7; i++) {
    const from = new Date(start);
    from.setDate(start.getDate() + i);
    const to = new Date(from);
    to.setDate(from.getDate() + 1);
    const intervals = oh.getOpenIntervals(from, to) as [Date, Date, boolean, string?][];
    const hours = intervals.length
      ? intervals
          .map(([a, b]) => {
            const full = a.getTime() === from.getTime() && b.getTime() === to.getTime();
            return full ? '24 שעות' : `${hhmm(a)}–${b.getTime() === to.getTime() ? '24:00' : hhmm(b)}`;
          })
          .join(', ')
      : 'סגור';
    week.push({ day: DAYS[from.getDay()], hours, today: from.getDay() === now.getDay() });
  }
  return { open, status, week, unsure };
}
