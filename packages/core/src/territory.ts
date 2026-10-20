import type { WorldFile } from './world.ts';

/**
 * Territories the map shows as part of another country (the owner's editorial choice). For each
 * one the map draws no border between the two, gives the territory no country label of its own,
 * and names the other country wherever a place's country is shown. Codes are ISO 3166-1 alpha-2,
 * lower case.
 */
export interface MergedTerritory {
  code: string;
  /** The country it is shown as part of. */
  into: string;
  /** Names data sources use for the territory (country labels, border sides, Photon results). */
  names: string[];
  /** Boxes [w, s, e, n] around the territory: disputed-boundary lines inside them are hidden too. */
  area: [number, number, number, number][];
}

export const MERGED_TERRITORIES: MergedTerritory[] = [
  {
    // The West Bank and Gaza are shown as part of Israel.
    code: 'ps',
    into: 'il',
    names: [
      'Palestine',
      'State of Palestine',
      'Palestinian Territories',
      'Palestinian Territory',
      'Palestinian territories',
      'Occupied Palestinian Territory',
      'West Bank',
      'Gaza Strip',
      'فلسطين',
      'دولة فلسطين',
      'الأراضي الفلسطينية',
      'السلطة الفلسطينية',
      'الضفة الغربية',
      'قطاع غزة',
      'פלסטין',
      'מדינת פלסטין',
      'השטחים הפלסטיניים',
      'הרשות הפלסטינית',
      'הגדה המערבית',
      'רצועת עזה',
      'Palästina',
      'Palästinensische Autonomiegebiete',
      'Westjordanland',
      'Gazastreifen',
      'Territoires palestiniens',
      'Cisjordanie',
      'Bande de Gaza',
      'Territori palestinesi',
      'Cisgiordania',
      'Striscia di Gaza',
    ],
    area: [
      [34.85, 31.3, 35.6, 32.6], // West Bank and East Jerusalem
      [34.18, 31.2, 34.6, 31.62], // Gaza
    ],
  },
];

/** Country names in the languages our sources use, for countries territories are merged into. */
export const COUNTRY_NAMES: Record<string, Record<string, string>> = {
  il: { he: 'ישראל', en: 'Israel', ar: 'إسرائيل', de: 'Israel', fr: 'Israël', it: 'Israele' },
};

const byCode = new Map(MERGED_TERRITORIES.map((t) => [t.code, t]));
const mergedNames = new Set(MERGED_TERRITORIES.flatMap((t) => t.names.map((n) => n.toLowerCase())));

/** The country a code is shown as (its own code unless it is a merged territory). */
export function displayCountry(code: string): string;
export function displayCountry(code: string | undefined): string | undefined;
export function displayCountry(code: string | undefined): string | undefined {
  if (!code) return code;
  const lower = code.toLowerCase();
  const into = byCode.get(lower)?.into;
  if (!into) return code;
  return code === lower ? into : into.toUpperCase();
}

export const isMergedTerritoryName = (name: string | undefined): boolean => !!name && mergedNames.has(name.trim().toLowerCase());

/** A country's name in a language, falling back to Hebrew, then English. */
export function countryName(code: string, lang: string): string | undefined {
  const n = COUNTRY_NAMES[code.toLowerCase()];
  return n && (n[lang] ?? n.he ?? n.en);
}

/**
 * The bundled world map with every merged territory dissolved into its country: one outline
 * (the shared border arcs are gone, the territory's other arcs join the country's ring), one
 * label, and the territory's cities counted as the country's.
 */
export function mergeWorldFile(f: WorldFile): WorldFile {
  let countries = f.countries;
  let borders = f.borders;
  let cities = f.cities;
  let airports = f.airports;
  for (const t of MERGED_TERRITORIES) {
    const from = countries.find((c) => c.c.toLowerCase() === t.code);
    const to = countries.find((c) => c.c.toLowerCase() === t.into);
    if (!from || !to) continue;
    const shared = new Set<number>();
    const polys = to.p.map((poly) => poly.map((r) => [...r]));
    const extra: number[][][] = [];
    for (const poly of from.p) {
      // Where the country's ring walks the one arc it shares with the territory's outer ring,
      // walk the rest of the territory's ring instead (TopoJSON: ~i is arc i reversed).
      const outer = poly[0];
      const target = polys.find((p) => outer.filter((a) => p[0].includes(~a)).length === 1);
      if (!target) {
        extra.push(poly);
        continue;
      }
      const ring = target[0];
      const k = outer.findIndex((a) => ring.includes(~a));
      const arc = ~outer[k];
      ring.splice(ring.indexOf(arc), 1, ...outer.slice(k + 1), ...outer.slice(0, k));
      shared.add(arc < 0 ? ~arc : arc);
      target.push(...poly.slice(1));
    }
    const merged = { ...to, a: to.a + from.a, p: [...polys, ...extra] };
    countries = countries.filter((c) => c !== from).map((c) => (c === to ? merged : c));
    borders = borders.filter((i) => !shared.has(i));
    cities = cities.map((c) => (c[6].toLowerCase() === t.code ? [c[0], c[1], c[2], c[3], c[4], c[5], to.c] : c));
    airports = airports.map((a) => (a[3].toLowerCase() === t.code ? [a[0], a[1], a[2], to.c, a[4], a[5]] : a));
  }
  return { ...f, countries, borders, cities, airports };
}
