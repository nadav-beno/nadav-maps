/**
 * Hebrew-aware search text normalization.
 * Search engines tokenize Hebrew poorly: niqqud, the many geresh look-alikes, common
 * abbreviations and one-letter prefixes ("בתל אביב") all hurt recall. We normalize the
 * query and, when results are thin, retry with variants.
 */

const NIQQUD = /[֑-ׇ]/g;
const GERESH = /[׳'`´‘’]/g; // ׳ and look-alikes -> '
const GERSHAYIM = /[״"“”״]/g; // ״ and look-alikes -> "

/** Whole-token abbreviations. Keys are already normalized (ASCII ' and "). */
const ABBREVIATIONS: Record<string, string> = {
  "רח'": 'רחוב',
  "שד'": 'שדרות',
  "ש'": 'שכונת',
  "כ'": 'כיכר',
  "דר'": 'דרך',
  "סמ'": 'סמטת',
  'ת"א': 'תל אביב',
  'תל-אביב': 'תל אביב',
  'ת"א-יפו': 'תל אביב-יפו',
  'י-ם': 'ירושלים',
  'ב"ש': 'באר שבע',
  'פ"ת': 'פתח תקווה',
  'ר"ג': 'רמת גן',
  'ראשל"צ': 'ראשון לציון',
  'ק"ש': 'קריית שמונה',
  'ק"ג': 'קריית גת',
  'נס"צ': 'נס ציונה',
  'בי"ח': 'בית חולים',
  'ביה"ח': 'בית החולים',
  'ביה"ס': 'בית הספר',
  'בי"ס': 'בית ספר',
  'אונ\'': 'אוניברסיטת',
  'ת.א': 'תל אביב',
  'קנ"ט': 'קניון',
  'רמה"ש': 'רמת השרון',
  'הוד"ש': 'הוד השרון',
};

/** Spelling variants that should match each other ("קריית"/"קרית", "תקווה"/"תקוה"). */
const SPELLING: [RegExp, string][] = [
  [/(^|\s)קרית(?=\s|$)/g, '$1קריית'],
  [/תקוה(?=\s|$)/g, 'תקווה'],
];

export function isHebrew(s: string): boolean {
  return /[֐-׿]/.test(s);
}

/** Canonical form: no niqqud, unified quotes, collapsed whitespace, expanded abbreviations. */
export function normalizeQuery(input: string): string {
  let s = input.normalize('NFC').replace(NIQQUD, '').replace(GERESH, "'").replace(GERSHAYIM, '"');
  s = s.replace(/\s+/g, ' ').trim();
  if (!isHebrew(s)) return s;
  const tokens = s.split(' ').map((t) => {
    const trailingComma = t.endsWith(',') ? ',' : '';
    const core = trailingComma ? t.slice(0, -1) : t;
    const exp = ABBREVIATIONS[core];
    return exp ? exp + trailingComma : t;
  });
  s = tokens.join(' ');
  for (const [re, rep] of SPELLING) s = s.replace(re, rep);
  return s;
}

/** One-letter prepositions/articles that get glued to the next word in Hebrew. */
const PREFIXES = ['ב', 'ל', 'מ', 'ה', 'ו', 'ש', 'כ'];

/**
 * Alternative queries to try when the normalized query returns few results.
 * E.g. "פיצה בתל אביב" -> ["פיצה תל אביב"], "לירושלים" -> ["ירושלים"].
 */
export function queryVariants(input: string): string[] {
  const base = normalizeQuery(input);
  if (!isHebrew(base)) return [];
  const words = base.split(' ');
  const out = new Set<string>();
  // Strip a glued prefix from each word that is long enough to still be a word. Three-letter
  // words only when another word follows ("בתל אביב"), so lone words like "בית" survive.
  const stripped = words.map((w, i) =>
    PREFIXES.includes(w[0]) && (w.length > 3 || (w.length === 3 && i < words.length - 1)) ? w.slice(1) : w,
  );
  out.add(stripped.join(' '));
  // Drop standalone connector words ("ליד", "באזור", "קרוב ל").
  out.add(
    words
      .filter((w) => !['ליד', 'באזור', 'קרוב', 'ב', 'של', 'על', 'יד'].includes(w))
      .join(' '),
  );
  out.delete(base);
  out.delete('');
  return [...out];
}
