/**
 * Pure helpers for "אנשים" (sharing your location with friends): avatar colours, how long a
 * share lasts, "updated 3 minutes ago", and the arrive / leave alert rules. No I/O here; the
 * feature (packages/features/people) does the fetching and drawing.
 */

/** Avatar colours, picked by index (the server stores 0..11). Readable with white text in both themes. */
export const PERSON_COLORS = [
  '#1a73e8', '#d93025', '#188038', '#e8710a', '#9334e6', '#d01884',
  '#12838f', '#b06000', '#5b6ac0', '#c5221f', '#1e8e3e', '#5f6368',
] as const;

export function personColor(i: number | null | undefined): string {
  const n = Math.trunc(Number(i) || 0);
  return PERSON_COLORS[((n % PERSON_COLORS.length) + PERSON_COLORS.length) % PERSON_COLORS.length];
}

/** Emojis offered when choosing how you look to friends. */
export const PERSON_EMOJIS = ['😎', '🦊', '🐼', '🦁', '🐙', '🦄', '🐶', '🐱', '🌻', '🚀', '⚡', '🎧', '🏄', '🚴', '⚽', '🍕'];

/** The first letter (or two for two-word names, Latin only) of a name, for an avatar without an emoji. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0] ?? '?';
  // Hebrew initials read oddly in pairs; Latin ones look like a monogram.
  if (words.length > 1 && /^[A-Za-z]/.test(first)) return (first + ([...words[1]][0] ?? '')).toUpperCase();
  return first.toUpperCase();
}

/** A code a friend reads out: letters and digits only, upper case, as the server stores it. */
export function normalizeCode(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
}

/** Groups a 6-character code as "K7M 2QX" for reading aloud. */
export function prettyCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export type ShareFor = '1h' | 'day' | 'forever';

export const SHARE_CHOICES: { id: ShareFor; label: string; sub: string }[] = [
  { id: '1h', label: 'לשעה', sub: 'ייפסק לבד בעוד שעה' },
  { id: 'day', label: 'עד סוף היום', sub: 'ייפסק בחצות' },
  { id: 'forever', label: 'ללא הגבלה', sub: 'עד שתפסיקו' },
];

/** Minutes east of UTC in `timeZone` at `at`. */
export function tzOffsetMinutes(at: Date, timeZone?: string): number {
  if (!timeZone) return -at.getTimezoneOffset();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The next local midnight in `timeZone` after `now`. */
export function endOfDay(now: Date, timeZone?: string): Date {
  const off = tzOffsetMinutes(now, timeZone);
  const local = new Date(now.getTime() + off * 60000);
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  // Daylight saving may change the offset before midnight: correct with the offset there.
  let t = midnightLocal - off * 60000;
  const off2 = tzOffsetMinutes(new Date(t), timeZone);
  if (off2 !== off) t = midnightLocal - off2 * 60000;
  return new Date(t);
}

/** When a share chosen now ends (null = for ever). "Until the end of the day" late at night lasts at least an hour. */
export function shareUntil(choice: ShareFor, now: Date, timeZone?: string): Date | null {
  if (choice === 'forever') return null;
  const hour = new Date(now.getTime() + 3600_000);
  if (choice === '1h') return hour;
  const eod = endOfDay(now, timeZone);
  return eod.getTime() < hour.getTime() ? hour : eod;
}

/** Seconds a share chosen now lasts (null = for ever), for invite links that start when opened. */
export function shareSeconds(choice: ShareFor, now: Date, timeZone?: string): number | null {
  const u = shareUntil(choice, now, timeZone);
  return u ? Math.max(60, Math.round((u.getTime() - now.getTime()) / 1000)) : null;
}

function clock(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(d);
}

/** "ללא הגבלה", "עוד 42 דק׳", "עד 23:59", "עד מחר 18:00". */
export function shareLeft(until: string | null | undefined, now: number, timeZone?: string): string {
  if (!until) return 'ללא הגבלה';
  const t = Date.parse(until);
  if (!Number.isFinite(t)) return 'ללא הגבלה';
  const left = t - now;
  if (left <= 0) return 'הסתיים';
  if (left < 60 * 60_000) return `עוד ${Math.max(1, Math.round(left / 60_000))} דק׳`;
  const end = new Date(t);
  const sameDay = endOfDay(new Date(now), timeZone).getTime() >= t;
  // Shares that end at midnight read better as "until the end of the day".
  const off = tzOffsetMinutes(end, timeZone);
  const localMinutes = (((t / 60000 + off) % 1440) + 1440) % 1440;
  if (sameDay && localMinutes === 0) return 'עד סוף היום';
  return sameDay ? `עד ${clock(end, timeZone)}` : `עד ${new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone }).format(end)} ${clock(end, timeZone)}`;
}

/** "עכשיו", "לפני דקה", "לפני 5 דק׳", "לפני שעה", "לפני 3 שעות", "אתמול", "לפני 4 ימים". */
export function agoText(at: string | number | null | undefined, now: number): string {
  const t = typeof at === 'number' ? at : at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'עכשיו';
  const m = Math.floor(s / 60);
  if (m === 1) return 'לפני דקה';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h === 1) return 'לפני שעה';
  if (h === 2) return 'לפני שעתיים';
  if (h < 24) return `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'אתמול';
  if (d === 2) return 'לפני יומיים';
  return `לפני ${d} ימים`;
}

export type Freshness = 'live' | 'recent' | 'stale';

/** live: under 2 minutes old; recent: under 20 minutes; stale: older (drawn faded). */
export function freshness(at: string | number | null | undefined, now: number): Freshness {
  const t = typeof at === 'number' ? at : at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return 'stale';
  const s = (now - t) / 1000;
  return s < 120 ? 'live' : s < 1200 ? 'recent' : 'stale';
}

/** Battery as a Material Symbols name. */
export function batteryIcon(level: number | null | undefined, charging?: boolean | null): string {
  if (charging) return 'battery_charging_full';
  if (level === null || level === undefined) return 'battery_full';
  if (level <= 0.15) return 'battery_alert';
  return level < 0.5 ? 'battery_2_bar' : 'battery_full';
}

/** Speed in m/s to a short Hebrew line, or '' when standing still. */
export function movingText(speed: number | null | undefined): string {
  if (!speed || speed < 0.8) return '';
  const kmh = speed * 3.6;
  if (kmh < 7) return 'בהליכה';
  if (kmh < 25) return `בתנועה · ${Math.round(kmh)} קמ״ש`;
  return `בנסיעה · ${Math.round(kmh)} קמ״ש`;
}

// ---------- arrive / leave alerts ----------

export type AlertKind = 'arrive' | 'leave';

/**
 * Is the person inside the alert circle? With hysteresis so GPS jitter at the edge doesn't
 * fire alerts: they count as inside within the radius, outside only past 1.25 radius plus the
 * fix's accuracy, and keep their previous state in between (or "outside" when there is none).
 */
export function insideFence(prev: boolean | undefined, distance: number, radius: number, accuracy = 0): boolean {
  if (distance <= radius) return true;
  if (distance > radius * 1.25 + Math.min(accuracy, 500)) return false;
  return prev ?? false;
}

/** Whether moving from `prev` to `next` fires an alert of this kind. The first fix never fires. */
export function alertFires(kind: AlertKind, prev: boolean | undefined, next: boolean): boolean {
  if (prev === undefined) return false;
  return kind === 'arrive' ? !prev && next : prev && !next;
}

/** A Hebrew one-letter preposition before a name: "לבית", "למיקום שלך" (ל swallows ה), "מהמקום", but "ל-Home". */
function pre(letter: string, word: string): string {
  if (!/^[\u0590-\u05FF]/.test(word)) return `${letter}-${word}`;
  return letter === 'ל' && word.startsWith('ה') && word.length > 2 ? letter + word.slice(1) : letter + word;
}

/** The notification text, e.g. "עמית: הגעה לבית". Gender neutral by using the noun form. */
export function alertText(kind: AlertKind, name: string, label?: string | null): string {
  const l = label?.trim();
  return kind === 'arrive' ? `${name}: הגעה ${pre('ל', l || 'יעד')}` : `${name}: יציאה ${pre('מ', l || 'המקום')}`;
}

/** How an alert reads in lists ("בהגעה לבית"). */
export function alertSummary(kind: AlertKind, label?: string | null): string {
  const l = label?.trim();
  return kind === 'arrive' ? `בהגעה ${pre('ל', l || 'מקום')}` : `ביציאה ${pre('מ', l || 'המקום')}`;
}
