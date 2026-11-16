import { describe, expect, it } from 'vitest';
import { agoText, alertFires, alertSummary, alertText, endOfDay, freshness, initialsOf, insideFence, movingText, normalizeCode, personColor, prettyCode, shareLeft, shareSeconds, shareUntil, tzOffsetMinutes } from './people.ts';
import { parseUrl } from './url-state.ts';
import { providersFromEnv, withDevOverrides } from './config.ts';

const TZ = 'Asia/Jerusalem';

describe('people: identity', () => {
  it('initials, colours and codes', () => {
    expect(initialsOf('נדב בן')).toBe('נ');
    expect(initialsOf('amit sason')).toBe('AS');
    expect(initialsOf('  ')).toBe('?');
    expect(personColor(3)).toBe(personColor(15));
    expect(personColor(-1)).toBe(personColor(11));
    expect(normalizeCode(' k7m-2qx ')).toBe('K7M2QX');
    expect(prettyCode('K7M2QX')).toBe('K7M 2QX');
  });
});

describe('people: how long a share lasts', () => {
  it('ends at local midnight, also across daylight saving', () => {
    // 20:00 in Israel on a winter day = 18:00 UTC.
    expect(tzOffsetMinutes(new Date('2026-11-16T18:00:00Z'), TZ)).toBe(120);
    expect(endOfDay(new Date('2026-11-16T18:00:00Z'), TZ).toISOString()).toBe('2026-11-16T22:00:00.000Z');
    // Summer (UTC+3).
    expect(endOfDay(new Date('2026-07-01T10:00:00Z'), TZ).toISOString()).toBe('2026-07-01T21:00:00.000Z');
    // Around the clocks going back (Israel, 25 Oct 2026 at 02:00).
    expect(endOfDay(new Date('2026-10-24T20:00:00Z'), TZ).toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(endOfDay(new Date('2026-10-25T12:00:00Z'), TZ).toISOString()).toBe('2026-10-25T22:00:00.000Z');
  });
  it('turns choices into end times', () => {
    const now = new Date('2026-11-16T18:00:00Z');
    expect(shareUntil('forever', now, TZ)).toBeNull();
    expect(shareUntil('1h', now, TZ)!.toISOString()).toBe('2026-11-16T19:00:00.000Z');
    expect(shareUntil('day', now, TZ)!.toISOString()).toBe('2026-11-16T22:00:00.000Z');
    // At 23:30 "the end of the day" still gives an hour.
    expect(shareUntil('day', new Date('2026-11-16T21:30:00Z'), TZ)!.toISOString()).toBe('2026-11-16T22:30:00.000Z');
    expect(shareSeconds('1h', now, TZ)).toBe(3600);
    expect(shareSeconds('forever', now, TZ)).toBeNull();
  });
  it('says what is left', () => {
    const now = Date.parse('2026-11-16T18:00:00Z');
    expect(shareLeft(null, now, TZ)).toBe('ללא הגבלה');
    expect(shareLeft('2026-11-16T18:42:00Z', now, TZ)).toBe('עוד 42 דק׳');
    expect(shareLeft('2026-11-16T22:00:00Z', now, TZ)).toBe('עד סוף היום');
    expect(shareLeft('2026-11-16T20:30:00Z', now, TZ)).toBe('עד 22:30');
    expect(shareLeft('2026-11-16T17:00:00Z', now, TZ)).toBe('הסתיים');
    expect(shareLeft('2026-11-18T10:00:00Z', now, TZ)).toMatch(/^עד יום רביעי 12:00$/);
  });
});

describe('people: time and motion', () => {
  it('reads ages in Hebrew', () => {
    const now = Date.parse('2026-11-16T18:00:00Z');
    const ago = (s: number) => agoText(now - s * 1000, now);
    expect(ago(10)).toBe('עכשיו');
    expect(ago(70)).toBe('לפני דקה');
    expect(ago(5 * 60)).toBe('לפני 5 דק׳');
    expect(ago(3600)).toBe('לפני שעה');
    expect(ago(7200)).toBe('לפני שעתיים');
    expect(ago(5 * 3600)).toBe('לפני 5 שעות');
    expect(ago(30 * 3600)).toBe('אתמול');
    expect(ago(5 * 86400)).toBe('לפני 5 ימים');
    expect(agoText(null, now)).toBe('');
    expect(freshness(now - 30_000, now)).toBe('live');
    expect(freshness(now - 600_000, now)).toBe('recent');
    expect(freshness(now - 3_600_000, now)).toBe('stale');
  });
  it('describes movement', () => {
    expect(movingText(0)).toBe('');
    expect(movingText(1.4)).toBe('בהליכה');
    expect(movingText(4)).toBe('בתנועה · 14 קמ״ש');
    expect(movingText(20)).toBe('בנסיעה · 72 קמ״ש');
  });
});

describe('people: arrive and leave alerts', () => {
  it('uses hysteresis at the edge', () => {
    expect(insideFence(undefined, 100, 150)).toBe(true);
    expect(insideFence(true, 170, 150)).toBe(true); // jitter just outside keeps "inside"
    expect(insideFence(false, 170, 150)).toBe(false);
    expect(insideFence(true, 200, 150)).toBe(false);
    expect(insideFence(true, 220, 150, 50)).toBe(true); // a poor fix widens the margin
  });
  it('fires only on a real change', () => {
    expect(alertFires('arrive', undefined, true)).toBe(false);
    expect(alertFires('arrive', false, true)).toBe(true);
    expect(alertFires('arrive', true, true)).toBe(false);
    expect(alertFires('leave', true, false)).toBe(true);
    expect(alertFires('leave', false, false)).toBe(false);
  });
  it('words alerts', () => {
    expect(alertText('arrive', 'עמית', 'בית')).toBe('עמית: הגעה לבית');
    expect(alertText('leave', 'עמית', 'Office')).toBe('עמית: יציאה מ-Office');
    expect(alertText('arrive', 'עמית')).toBe('עמית: הגעה ליעד');
    expect(alertSummary('leave', null)).toBe('ביציאה מהמקום');
    expect(alertText('arrive', 'עמית', 'המיקום שלך')).toBe('עמית: הגעה למיקום שלך');
    expect(alertSummary('leave', 'המקום הנוכחי')).toBe('ביציאה מהמקום הנוכחי');
  });
});

describe('people: config and links', () => {
  it('reads the service from env, and from ?people= on localhost only', () => {
    expect(providersFromEnv({}).peopleUrl).toBe('');
    const cfg = providersFromEnv({ VITE_PEOPLE_URL: 'https://x.supabase.co', VITE_PEOPLE_KEY: ' k ' }, 'VITE_');
    expect(cfg).toMatchObject({ peopleUrl: 'https://x.supabase.co', peopleKey: 'k' });
    expect(withDevOverrides(providersFromEnv({}), 'http://localhost:5173/?people=https://people.test').peopleUrl).toBe('https://people.test');
    expect(withDevOverrides(providersFromEnv({}), 'https://nadav-beno.github.io/nadav-maps/?people=https://evil.test').peopleUrl).toBe('');
  });
  it('parses invite links', () => {
    expect(parseUrl('https://a.test/?invite=ABCDEFGH2345').invite).toBe('ABCDEFGH2345');
    expect(parseUrl('https://a.test/?invite=<script>').invite).toBeUndefined();
  });
});
