/**
 * Pure helpers for AIS (ship) data: what the codes a ship broadcasts mean, in Hebrew, and the
 * flag state hidden in its MMSI. Shared by the ships tools, the ships relay's tests and the UI.
 */

/** Our own grouping of the AIS ship type codes, used for colours, filters and names. */
export type ShipCategory = 'cargo' | 'tanker' | 'passenger' | 'fast' | 'fishing' | 'service' | 'pleasure' | 'gov' | 'other' | 'unknown';

export const SHIP_CATEGORIES: { id: ShipCategory; label: string; color: string }[] = [
  { id: 'cargo', label: 'משא', color: '#3f9b4b' },
  { id: 'tanker', label: 'מכליות', color: '#d0473b' },
  { id: 'passenger', label: 'נוסעים ומעבורות', color: '#2f6fdc' },
  { id: 'fast', label: 'כלי שיט מהירים', color: '#e8b417' },
  { id: 'fishing', label: 'דיג', color: '#ef7d22' },
  { id: 'service', label: 'גוררות ושירות', color: '#169c9c' },
  { id: 'pleasure', label: 'יאכטות ומפרשיות', color: '#a352c9' },
  { id: 'gov', label: 'צבא, משטרה וחילוץ', color: '#6f7a3a' },
  { id: 'other', label: 'אחר', color: '#8a6d55' },
  { id: 'unknown', label: 'לא ידוע', color: '#8f969c' },
];

export const CATEGORY_COLOR = Object.fromEntries(SHIP_CATEGORIES.map((c) => [c.id, c.color])) as Record<ShipCategory, string>;

/** The category of an AIS "type of ship and cargo" code (0..99). */
export function shipCategory(type: number | null | undefined): ShipCategory {
  const t = type ?? 0;
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 60 && t <= 69) return 'passenger';
  if ((t >= 40 && t <= 49) || (t >= 20 && t <= 29)) return 'fast';
  if (t === 30) return 'fishing';
  if (t === 36 || t === 37) return 'pleasure';
  if (t === 35 || t === 51 || t === 55) return 'gov';
  if ([31, 32, 33, 34, 50, 52, 53, 54, 56, 57, 58, 59].includes(t)) return 'service';
  if (t >= 90 && t <= 99) return 'other';
  return 'unknown';
}

const TYPE_NAMES: Record<number, string> = {
  30: 'ספינת דיג',
  31: 'גוררת',
  32: 'גוררת (גרירה גדולה)',
  33: 'ספינת חפירה',
  34: 'ספינת צלילה',
  35: 'ספינה צבאית',
  36: 'מפרשית',
  37: 'יאכטה / שיט פנאי',
  50: 'ספינת נתב',
  51: 'חיפוש והצלה',
  52: 'גוררת',
  53: 'ספינת שירות לנמל',
  54: 'מניעת זיהום ים',
  55: 'אכיפת חוק',
  58: 'ספינה רפואית',
  59: 'ספינה לפי תקנות RR',
};

/** A Hebrew name for an AIS ship type code. */
export function shipTypeName(type: number | null | undefined): string {
  const t = type ?? 0;
  if (TYPE_NAMES[t]) return TYPE_NAMES[t];
  const cat = shipCategory(t);
  if (cat === 'cargo') return 'ספינת משא';
  if (cat === 'tanker') return 'מכלית';
  if (cat === 'passenger') return 'ספינת נוסעים';
  if (t >= 40 && t <= 49) return 'כלי שיט מהיר';
  if (t >= 20 && t <= 29) return 'רחפת כנף (WIG)';
  if (cat === 'other') return 'כלי שיט אחר';
  return 'סוג לא ידוע';
}

/** Hazard class carried, from the type code's second digit for cargo/tankers/passenger (1..4 = X, Y, Z, OS). */
export function hazardOf(type: number | null | undefined): string | null {
  const t = type ?? 0;
  if (t < 20 || t > 89 || (t >= 30 && t < 40) || (t >= 50 && t < 60)) return null;
  const d = t % 10;
  return d >= 1 && d <= 4 ? ['', 'מטען מסוכן (קטגוריה X)', 'מטען מסוכן (קטגוריה Y)', 'מטען מסוכן (קטגוריה Z)', 'מזהם ימי (OS)'][d] : null;
}

const NAV_STATUS: Record<number, string> = {
  0: 'בדרך, מונעת',
  1: 'בעוגן',
  2: 'לא בשליטה',
  3: 'מוגבלת בתמרון',
  4: 'מוגבלת בגלל שוקע',
  5: 'קשורה לרציף',
  6: 'עלתה על שרטון',
  7: 'עסוקה בדיג',
  8: 'בדרך, בהפלגה במפרש',
  11: 'גוררת אחורה',
  12: 'דוחפת או גוררת',
  14: 'משדר חירום (SART)',
};

/** The navigational status a ship reports, in Hebrew ('' when not given). */
export function navStatusName(nav: number | null | undefined): string {
  return nav === null || nav === undefined ? '' : (NAV_STATUS[nav] ?? '');
}

/** Stopped: at anchor, moored, aground, or barely moving. Drawn as a dot, not an arrow. */
export function isStopped(s: { sog?: number | null; nav?: number | null }): boolean {
  if (s.nav === 1 || s.nav === 5 || s.nav === 6) return true;
  return s.sog === null || s.sog === undefined || s.sog < 0.5;
}

// ---------- flag state from the MMSI ----------

/**
 * ITU Maritime Identification Digits (the first three digits of a ship's MMSI) to ISO country.
 * 443 is shown as Israel, as the map does with the territories (core/src/territory.ts).
 */
const MID: Record<number, string> = {};
const add = (iso: string, ...mids: number[]) => mids.forEach((m) => (MID[m] = iso));
add('AL', 201); add('AD', 202); add('AT', 203); add('PT', 204, 255, 263); add('BE', 205); add('BY', 206); add('BG', 207);
add('VA', 208); add('CY', 209, 210, 212); add('DE', 211, 218); add('GE', 213); add('MD', 214); add('MT', 215, 229, 248, 249, 256);
add('AM', 216); add('DK', 219, 220); add('ES', 224, 225); add('FR', 226, 227, 228); add('FI', 230); add('FO', 231);
add('GB', 232, 233, 234, 235); add('GI', 236); add('GR', 237, 239, 240, 241); add('HR', 238); add('MA', 242); add('HU', 243);
add('NL', 244, 245, 246); add('IT', 247); add('IE', 250); add('IS', 251); add('LI', 252); add('LU', 253); add('MC', 254);
add('NO', 257, 258, 259); add('PL', 261); add('ME', 262); add('RO', 264); add('SE', 265, 266); add('SK', 267); add('SM', 268);
add('CH', 269); add('CZ', 270); add('TR', 271); add('UA', 272); add('RU', 273); add('MK', 274); add('LV', 275); add('EE', 276);
add('LT', 277); add('SI', 278); add('RS', 279);
add('AI', 301); add('US', 303, 338, 366, 367, 368, 369); add('AG', 304, 305); add('CW', 306); add('AW', 307); add('BS', 308, 309, 311);
add('BM', 310); add('BZ', 312); add('BB', 314); add('CA', 316); add('KY', 319); add('CR', 321); add('CU', 323); add('DM', 325);
add('DO', 327); add('GP', 329); add('GD', 330); add('GL', 331); add('GT', 332); add('HN', 334); add('HT', 336); add('JM', 339);
add('KN', 341); add('LC', 343); add('MX', 345); add('MQ', 347); add('MS', 348); add('NI', 350);
add('PA', 351, 352, 353, 354, 355, 356, 357, 370, 371, 372, 373, 374); add('PR', 358); add('SV', 359); add('PM', 361); add('TT', 362);
add('TC', 364); add('VC', 375, 376, 377); add('VG', 378); add('VI', 379);
add('AF', 401); add('SA', 403); add('BD', 405); add('BH', 408); add('BT', 410); add('CN', 412, 413, 414); add('TW', 416); add('LK', 417);
add('IN', 419); add('IR', 422); add('AZ', 423); add('IQ', 425); add('IL', 428, 443); add('JP', 431, 432); add('TM', 434); add('KZ', 436);
add('UZ', 437); add('JO', 438); add('KR', 440, 441); add('KP', 445); add('KW', 447); add('LB', 450); add('KG', 451); add('MO', 453);
add('MV', 455); add('MN', 457); add('NP', 459); add('OM', 461); add('PK', 463); add('QA', 466); add('SY', 468); add('AE', 470, 471);
add('TJ', 472); add('YE', 473, 475); add('HK', 477); add('BA', 478);
add('AU', 503); add('MM', 506); add('BN', 508); add('FM', 510); add('PW', 511); add('NZ', 512); add('KH', 514, 515); add('CX', 516);
add('CK', 518); add('FJ', 520); add('CC', 523); add('ID', 525); add('KI', 529); add('LA', 531); add('MY', 533); add('MP', 536);
add('MH', 538); add('NC', 540); add('NU', 542); add('NR', 544); add('PF', 546); add('PH', 548); add('PG', 553); add('PN', 555);
add('SB', 557); add('AS', 559); add('WS', 561); add('SG', 563, 564, 565, 566); add('TH', 567); add('TO', 570); add('TV', 572);
add('VN', 574); add('VU', 576, 577); add('WF', 578);
add('ZA', 601); add('AO', 603); add('DZ', 605); add('BI', 609); add('BJ', 610); add('BW', 611); add('CF', 612); add('CM', 613);
add('CG', 615); add('KM', 616, 620); add('CV', 617); add('CI', 619); add('DJ', 621); add('EG', 622); add('ET', 624); add('ER', 625);
add('GA', 626); add('GH', 627); add('GM', 629); add('GW', 630); add('GQ', 631); add('GN', 632); add('BF', 633); add('KE', 634);
add('LR', 636, 637); add('SS', 638); add('LY', 642); add('LS', 644); add('MU', 645); add('MG', 647); add('ML', 649); add('MZ', 650);
add('MR', 654); add('MW', 655); add('NE', 656); add('NG', 657); add('NA', 659); add('RE', 660); add('RW', 661); add('SD', 662);
add('SN', 663); add('SC', 664); add('SH', 665); add('SO', 666); add('SL', 667); add('ST', 668); add('SZ', 669); add('TD', 670);
add('TG', 671); add('TN', 672); add('TZ', 674, 677); add('UG', 675); add('CD', 676); add('ZM', 678); add('ZW', 679);
add('AR', 701); add('BR', 710); add('BO', 720); add('CL', 725); add('CO', 730); add('EC', 735); add('FK', 740); add('GF', 745);
add('GY', 750); add('PY', 755); add('PE', 760); add('SR', 765); add('UY', 770); add('VE', 775);

/** The flag state of a ship (ISO 3166 alpha-2) from its MMSI, or null (base stations, aids to navigation, unknown). */
export function flagOf(mmsi: number): string | null {
  const s = String(mmsi);
  if (s.length !== 9) return null;
  // Ships are MID xxxxxx; craft associated with a parent ship 98MIDxxxx; handhelds 8MIDxxxxx.
  const mid = /^[2-7]/.test(s) ? Number(s.slice(0, 3)) : /^8[2-7]/.test(s) ? Number(s.slice(1, 4)) : /^98/.test(s) ? Number(s.slice(2, 5)) : 0;
  return MID[mid] ?? null;
}

/** The flag emoji for an ISO country code. */
export function flagEmoji(iso: string | null | undefined): string {
  if (!iso || !/^[A-Z]{2}$/.test(iso)) return '';
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

let regionNames: Intl.DisplayNames | null | undefined;
/** The country's name in Hebrew. */
export function countryNameHe(iso: string | null | undefined): string {
  if (!iso) return '';
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['he'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(iso) ?? iso;
  } catch {
    return iso;
  }
}

// ---------- voyage data typed in by the crew ----------

/**
 * The ETA a ship broadcasts has no year: month, day, hour, minute in UTC. Returns the ISO time
 * of the next such moment (allowing a month in the past for late ships), or null when not given.
 */
export function etaFromParts(month: number, day: number, hour: number, minute: number, now = Date.now()): string | null {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const h = hour >= 0 && hour < 24 ? hour : 0;
  const m = minute >= 0 && minute < 60 ? minute : 0;
  const year = new Date(now).getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    const t = Date.UTC(y, month - 1, day, h, m);
    if (new Date(t).getUTCMonth() !== month - 1) continue;
    if (t >= now - 31 * 86400_000 && t <= now + 335 * 86400_000) return new Date(t).toISOString();
  }
  return null;
}

/** The packed ETA integer (month << 16 | day << 11 | hour << 6 | minute), as Digitraffic sends it. */
export function etaFromPacked(v: number | null | undefined, now = Date.now()): string | null {
  if (!v) return null;
  return etaFromParts((v >> 16) & 15, (v >> 11) & 31, (v >> 6) & 31, v & 63, now);
}

/** Length and beam in metres from the antenna offsets A (to bow), B (stern), C (port), D (starboard). */
export function dimensions(a?: number | null, b?: number | null, c?: number | null, d?: number | null): { length: number | null; beam: number | null } {
  const length = (a ?? 0) + (b ?? 0);
  const beam = (c ?? 0) + (d ?? 0);
  // 511 / 63 are "511 m or more" placeholders some transponders send when not configured.
  return { length: length > 0 && length < 500 ? length : null, beam: beam > 0 && beam < 80 ? beam : null };
}

/** AIS text fields are upper case, padded with spaces or '@'. */
export function cleanAisText(s: string | null | undefined): string {
  return (s ?? '').replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A few well-known port codes (UN/LOCODE) seen in the "destination" field, in Hebrew. */
const PORTS: Record<string, string> = {
  ILHFA: 'חיפה', ILASH: 'אשדוד', ILETH: 'אילת', ILHAD: 'חדרה', ILTLV: 'תל אביב', ILMIK: 'מכמורת',
  CYLMS: 'לימסול', CYLCA: 'לרנקה', CYVAS: 'וסיליקו', EGPSD: 'פורט סעיד', EGALY: 'אלכסנדריה', EGDAM: 'דמייטה', EGSUZ: 'סואץ',
  EGSCN: 'תעלת סואץ', EGSOK: 'סוחנה', TRMER: 'מרסין', TRIST: 'איסטנבול', TRISK: 'איסקנדרון', TRAMB: 'אמברלי', GRPIR: 'פיראוס',
  GRSKG: 'סלוניקי', LBBEY: 'ביירות', ITGOA: 'גנואה', ITTRS: 'טריאסטה', ITGIT: 'ג׳ויה טאורו', ESVLC: 'ולנסיה', ESALG: 'אלחסירס',
  ESBCN: 'ברצלונה', MTMAR: 'מרסשלוק', NLRTM: 'רוטרדם', BEANR: 'אנטוורפן', DEHAM: 'המבורג', GBFXT: 'פליקסטו', SGSIN: 'סינגפור',
  CNSHA: 'שנגחאי', AEJEA: 'ג׳בל עלי', SAJED: 'ג׳דה', JOAQJ: 'עקבה', FIHEL: 'הלסינקי', FITKU: 'טורקו', FIKTK: 'קוטקה',
  EETLL: 'טאלין', SESTO: 'סטוקהולם', RULED: 'סנקט פטרבורג', DKCPH: 'קופנהגן', PLGDN: 'גדנסק', USNYC: 'ניו יורק',
};

/** The destination as typed by the crew, with a Hebrew port name when it is a code we know. */
export function destinationName(dest: string | null | undefined): { raw: string; port: string | null } {
  const raw = cleanAisText(dest);
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const port = PORTS[code] ?? (code.length > 5 ? (PORTS[code.slice(-5)] ?? PORTS[code.slice(0, 5)] ?? null) : null);
  return { raw, port: port ?? null };
}

/** Knots to the user's units. */
export function knots(kn: number | null | undefined): string {
  return kn === null || kn === undefined ? '—' : `${kn.toFixed(kn < 10 ? 1 : 0)} קשר`;
}
