/**
 * Typo-tolerant name matching for Hebrew and English, the way a map search box should be:
 * "דיזנגוב", "דיזינגוף", "dizengof" and "shzbdu;" (Hebrew typed on an English layout) all
 * mean דיזנגוף.
 *
 * Every name is reduced to three comparison keys:
 *  - light: lower case, no niqqud / punctuation / final letters ("תל-אביב" -> "תל אביב").
 *  - phon: light plus the spellings people mix up: ktiv male vs haser (optional ו/י),
 *    sound-alike letters (ט/ת, כ/ק, ס/ש, א/ע, ח/כ, final ה/א), doubled letters.
 *    For Latin: ph/f, c/k/q, w/v, y/i, doubled letters.
 *  - skel: a cross-script consonant skeleton ("dizengoff" and "דיזנגוף" -> "DZNGP"), so an
 *    English query can find a Hebrew name and back.
 * Scores combine Damerau-Levenshtein (optimal string alignment) similarity on whole keys,
 * token-order independent matching, and a prefix score for text still being typed.
 * An index keeps the keys precomputed with a trigram inverted list, so a query only scores
 * the few hundred names that share trigrams with it (200k names in a few milliseconds).
 */
import { normalizeQuery } from './hebrew.ts';

// ---------------------------------------------------------------------------
// Normalization

const NIQQUD = /[֑-ׇ]/g;
const FINALS: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
const HEB = /[א-ת]/;
const LATIN = /[a-z]/;

export type Script = 'he' | 'latin' | 'other';

export function scriptOf(s: string): Script {
  let he = 0;
  let la = 0;
  for (const ch of s) {
    if (HEB.test(ch)) he++;
    else if (LATIN.test(ch)) la++;
  }
  if (!he && !la) return 'other';
  return he >= la ? 'he' : 'latin';
}

/**
 * Light key: what is left once spelling noise is removed. Keeps a geresh as ' after ג ז צ
 * (ג׳ = j) for the skeleton; everything else that is not a letter or digit becomes a space.
 */
function lightRaw(input: string): string {
  // Abbreviations ("ת\"א", "רח'") need quotes; most names have none, and this runs per name.
  let s = /['"`׳״‘’“”]/.test(input) ? normalizeQuery(input) : input;
  s = s.toLowerCase();
  if (/[^\x00-\x7fא-ת]/.test(s)) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(NIQQUD, '');
  let out = '';
  let space = true;
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    const c = s.charCodeAt(i);
    if ((c >= 0x5d0 && c <= 0x5ea) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      ch = FINALS[ch] ?? ch;
      out += ch;
      space = false;
      // ג׳ ז׳ צ׳ keep their geresh as a marker for the skeleton.
      if ((ch === 'ג' || ch === 'ז' || ch === 'צ') && /['׳`’]/.test(s[i + 1] ?? '')) {
        out += '\u0001';
        i++;
      }
    } else if (ch === "'" || ch === '"' || ch === '`' || ch === '׳' || ch === '״' || ch === '’' || ch === '‘' || ch === '“' || ch === '”') {
      continue;
    } else if (!space) {
      out += ' ';
      space = true;
    }
  }
  return out.trimEnd();
}

/** Lower case, no niqqud, punctuation, hyphens or final letters. "תל-אביב-יפו" -> "תל אביב יפו". */
export function lightKey(input: string): string {
  return lightRaw(input).replace(/\u0001/g, '');
}

const HE_SOUND: Record<string, string> = { ט: 'ת', ק: 'כ', ש: 'ס', ע: 'א', ח: 'כ' };

function phonWordHe(w: string): string {
  let out = '';
  for (let i = 0; i < w.length; i++) {
    let c = w[i];
    if (c === '\u0001') continue;
    // Vavs and yods inside a word, single or doubled, are what ktiv male adds and people
    // add or leave out at will ("קריית"/"קרית", "תקווה"/"תקוה", "שלום"/"שלם").
    if ((c === 'ו' || c === 'י') && i > 0) continue;
    if (c === 'ה' && i === w.length - 1 && i > 0) c = 'א';
    c = HE_SOUND[c] ?? c;
    if (c === 'א' && i > 0 && i === w.length - 1) continue; // final ה/א is a vowel
    if (out[out.length - 1] !== c) out += c;
  }
  return out;
}

function phonWordLatin(w: string): string {
  let out = '';
  const push = (c: string) => {
    if (out[out.length - 1] !== c) out += c;
  };
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const n = w[i + 1];
    if (c === 'p' && n === 'h') {
      push('f');
      i++;
    } else if (c === 'c' && n === 'k') {
      push('k');
      i++;
    } else if (c === 'c') push(n === 'e' || n === 'i' || n === 'y' ? 's' : 'k');
    else if (c === 'q') push('k');
    else if (c === 'w') push('v');
    else if (c === 'x') {
      push('k');
      push('s');
    } else if (c === 'y') push('i');
    else if (c !== '\u0001') push(c);
  }
  return out;
}

/** Sound-alike key, words kept apart by single spaces. */
export function phonKey(input: string): string {
  return phonFromLight(lightRaw(input));
}

function phonFromLight(light: string): string {
  return light
    .split(' ')
    .map((w) => (HEB.test(w) ? phonWordHe(w) : phonWordLatin(w.replace(/\u0001/g, ''))))
    .filter(Boolean)
    .join(' ');
}

const HE_SKEL: Record<string, string> = {
  ב: 'B', ג: 'G', ד: 'D', ז: 'Z', ט: 'T', כ: 'K', ל: 'L', מ: 'M', נ: 'N', ס: 'S', פ: 'P', צ: 'C', ק: 'K', ר: 'R', ש: 'S', ת: 'T',
  א: '', ה: '', ע: '', ח: '',
};
const LATIN_SKEL: Record<string, string> = {
  b: 'B', v: 'B', w: 'B', c: 'K', d: 'D', f: 'P', p: 'P', g: 'G', h: '', j: 'Y', k: 'K', q: 'K', l: 'L', m: 'M', n: 'N', r: 'R',
  s: 'S', t: 'T', x: 'KS', z: 'Z', a: '', e: '', i: '', o: '', u: '',
};

function skelWord(w: string): string {
  let raw = '';
  if (HEB.test(w)) {
    for (let i = 0; i < w.length; i++) {
      const c = w[i];
      if (c === '\u0001') continue;
      if (w[i + 1] === '\u0001') {
        raw += c === 'ג' ? 'Y' : c === 'צ' ? 'C' : 'Z';
        continue;
      }
      if (c === 'ו') {
        if (i === 0 || w[i + 1] === 'ו') raw += 'B';
        if (w[i + 1] === 'ו') i++;
        continue;
      }
      if (c === 'י') {
        if (i === 0) raw += 'Y';
        continue;
      }
      raw += HE_SKEL[c] ?? (/[0-9]/.test(c) ? c : '');
    }
  } else {
    for (let i = 0; i < w.length; i++) {
      const c = w[i];
      const n = w[i + 1];
      if (n === 'h' && (c === 's' || c === 'c' || c === 'k' || c === 'p' || c === 't')) {
        raw += c === 's' ? 'S' : c === 'p' ? 'P' : c === 't' ? 'T' : '';
        i++;
      } else if (c === 't' && (n === 's' || n === 'z')) {
        raw += 'C';
        i++;
      } else if (c === 'y') raw += i === 0 ? 'Y' : '';
      else if (c >= '0' && c <= '9') raw += c;
      else raw += LATIN_SKEL[c] ?? '';
    }
  }
  let out = '';
  for (const c of raw) if (out[out.length - 1] !== c) out += c;
  return out;
}

/** Cross-script consonant skeleton, words kept apart by single spaces. */
export function skeletonKey(input: string): string {
  return skelFromLight(lightRaw(input));
}

function skelFromLight(light: string): string {
  return light.split(' ').map(skelWord).filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Keyboard layout (SI-1452, the standard Israeli layout) and transliteration

const EN_TO_HE: Record<string, string> = {
  q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ',
  a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך', ';': 'ף', "'": ',',
  z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ', ',': 'ת', '.': 'ץ', '/': '.',
};
const HE_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_HE).filter(([, h]) => HEB.test(h)).map(([e, h]) => [h, e]),
);

/**
 * The text as it would read had the keyboard been in the other language: "shzbdu;" -> "דיזנגוף",
 * "אקך שהןה" -> "tel aviv". Null when the text is not a plausible layout slip.
 */
export function swapKeyboardLayout(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-zA-Z;,.'/ ]+$/.test(s)) {
    const letters = s.replace(/[^a-zA-Z]/g, '');
    if (letters.length < 2) return null;
    const out = [...s.toLowerCase()].map((c) => EN_TO_HE[c] ?? c).join('');
    // Only letters: the punctuation keys we turned into letters, plus the rest left as is.
    return /[א-ת]/.test(out) ? out.replace(/[/'.]/g, '').replace(/\s+/g, ' ').trim() : null;
  }
  if (/^[א-ת ]+$/.test(s)) {
    const out = [...s].map((c) => HE_TO_EN[c] ?? c).join('');
    return /^[a-z ;,.]+$/.test(out) && /[a-z]{2}/.test(out) ? out.replace(/[;,.]/g, '').trim() : null;
  }
  return null;
}

const HE_FINAL_OF: Record<string, string> = { כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ' };

/** Rule-based Latin -> Hebrew spelling, good enough to produce search candidates ("dizengoff" -> "דיזנגוף"). */
export function latinToHebrew(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => {
      let out = '';
      const s = w.replace(/(.)\1/g, '$1');
      for (let i = 0; i < s.length; i++) {
        const two = s.slice(i, i + 2);
        const map2: Record<string, string> = { sh: 'ש', ch: 'ח', kh: 'ח', tz: 'צ', ts: 'צ', ph: 'פ', th: 'ת', ou: 'ו', ei: 'י', ai: 'יי' };
        if (map2[two]) {
          out += map2[two];
          i++;
          continue;
        }
        const c = s[i];
        const first = i === 0;
        if ('aeiou'.includes(c)) {
          if (first) out += c === 'i' ? 'אי' : c === 'o' || c === 'u' ? 'או' : 'א';
          else if (c === 'i') out += 'י';
          else if (c === 'o' || c === 'u') out += 'ו';
          else if (i === s.length - 1 && c === 'a') out += 'ה';
          continue;
        }
        const map1: Record<string, string> = {
          b: 'ב', v: 'ב', w: 'ו', g: 'ג', d: 'ד', h: 'ה', z: 'ז', t: 'ט', y: 'י', j: 'ג׳', k: 'ק', c: 'ק', q: 'ק', l: 'ל',
          m: 'מ', n: 'נ', s: 'ס', f: 'פ', p: 'פ', r: 'ר', x: 'קס',
        };
        out += map1[c] ?? '';
      }
      const last = out[out.length - 1];
      return HE_FINAL_OF[last] ? out.slice(0, -1) + HE_FINAL_OF[last] : out;
    })
    .join(' ');
}

const HE_LATIN: Record<string, string> = {
  א: 'a', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'o', ז: 'z', ח: 'h', ט: 't', י: 'i', כ: 'k', ך: 'kh', ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n',
  ס: 's', ע: 'a', פ: 'p', ף: 'f', צ: 'tz', ץ: 'tz', ק: 'k', ר: 'r', ש: 'sh', ת: 't',
};

/** Rule-based Hebrew -> Latin spelling ("תל אביב" -> "tel aviv"-ish), for candidates and display fallbacks. */
export function hebrewToLatin(input: string): string {
  return normalizeQuery(input)
    .replace(NIQQUD, '')
    .split(/\s+/)
    .map((w) => {
      let out = '';
      for (let i = 0; i < w.length; i++) {
        const c = w[i];
        if (c === 'ו' && w[i + 1] === 'ו') {
          out += 'v';
          i++;
        } else if (c === 'ו' && i === 0) out += 'v';
        else if (c === 'י' && i === 0) out += 'y';
        else if (c === 'ב' && i > 0) out += 'v';
        else if (c === 'פ' && i > 0) out += 'f';
        else if (/[׳']/.test(w[i + 1] ?? '') && 'גזצ'.includes(c)) {
          out += c === 'ג' ? 'j' : c === 'ז' ? 'zh' : 'ch';
          i++;
        } else out += HE_LATIN[c] ?? (/[a-z0-9]/i.test(c) ? c : '');
      }
      return out;
    })
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Distances

let rowA = new Int32Array(64);
let rowB = new Int32Array(64);
let rowC = new Int32Array(64);

/** Damerau-Levenshtein distance (optimal string alignment: insert, delete, substitute, swap neighbours). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  if (m + 1 > rowA.length) {
    rowA = new Int32Array(m + 1);
    rowB = new Int32Array(m + 1);
    rowC = new Int32Array(m + 1);
  }
  let prev2 = rowA;
  let prev = rowB;
  let cur = rowC;
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      const cost = ai === bj ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
    }
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[m];
}

/** 0..1, 1 = same. */
export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** How well `q` matches the start of `s` (for text still being typed): best of prefixes len(q)-1..len(q)+1. */
function prefixSimilarity(q: string, s: string): number {
  if (q.length < 2 || s.length <= q.length) return 0;
  let best = 0;
  for (let l = Math.max(1, q.length - 1); l <= Math.min(s.length, q.length + 1); l++) {
    best = Math.max(best, 1 - editDistance(q, s.slice(0, l)) / q.length);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Scoring a prepared query against prepared keys

interface Keys {
  script: Script;
  light: string;
  phon: string;
  skel: string;
}

function keysOf(text: string): Keys {
  const raw = lightRaw(text);
  return { script: scriptOf(raw), light: raw.replace(/\u0001/g, ''), phon: phonFromLight(raw), skel: skelFromLight(raw) };
}

export interface PreparedQuery {
  text: string;
  /** The query and its alternative readings (layout slip, transliteration), each with a weight. */
  variants: { keys: Keys; weight: number; kind: 'typed' | 'layout' | 'translit' }[];
}

export function prepareQuery(text: string): PreparedQuery {
  const variants: PreparedQuery['variants'] = [{ keys: keysOf(normalizeQuery(text)), weight: 1, kind: 'typed' }];
  const swapped = swapKeyboardLayout(text);
  if (swapped) variants.push({ keys: keysOf(swapped), weight: 0.97, kind: 'layout' });
  const typed = variants[0].keys;
  if (typed.script === 'latin') variants.push({ keys: keysOf(latinToHebrew(text)), weight: 0.85, kind: 'translit' });
  return { text, variants };
}

const compact = (s: string) => s.replace(/ /g, '');
const HE_PREFIX = 'הובלמשכ';

/** Token-order independent match: each query word against its best name word. */
function tokenScore(q: string, c: string, prefix: boolean): number {
  const qt = q.split(' ');
  const ct = c.split(' ');
  if (qt.length === 1 && ct.length === 1) return 0;
  let total = 0;
  let len = 0;
  const used = new Set<number>();
  qt.forEach((t, qi) => {
    let best = 0;
    let bestJ = -1;
    const last = qi === qt.length - 1;
    ct.forEach((w, j) => {
      if (used.has(j)) return;
      let s = stringSimilarity(t, w);
      // A glued Hebrew prefix ("בדיזנגוף") on the query word.
      if (t.length > 3 && HE_PREFIX.includes(t[0])) s = Math.max(s, stringSimilarity(t.slice(1), w) * 0.97);
      if (prefix && last) s = Math.max(s, prefixSimilarity(t, w) * 0.92);
      if (s > best) {
        best = s;
        bestJ = j;
      }
    });
    if (bestJ >= 0 && best >= 0.5) used.add(bestJ);
    else best = Math.min(best, 0.3);
    total += best * Math.max(2, t.length);
    len += Math.max(2, t.length);
  });
  const coverage = qt.length / Math.max(qt.length, ct.length);
  return (total / len) * (0.9 + 0.1 * coverage) * 0.97;
}

function keyScore(q: string, c: string, prefix: boolean): number {
  if (!q || !c) return 0;
  const qc = compact(q);
  const cc = compact(c);
  if (qc === cc) return 1;
  let s = stringSimilarity(qc, cc);
  if (prefix && qc.length >= 2) s = Math.max(s, prefixSimilarity(qc, cc) * 0.92);
  if (q.includes(' ') || c.includes(' ')) s = Math.max(s, tokenScore(q, c, prefix));
  return s;
}

function scoreKeys(pq: PreparedQuery, c: Keys, prefix: boolean): number {
  let best = 0;
  for (const v of pq.variants) {
    const q = v.keys;
    let s = 0;
    if (q.script === c.script) {
      if (q.light === c.light) s = 1;
      else {
        const light = keyScore(q.light, c.light, prefix);
        // Sound-alike keys collapse a lot ("חיפא" and "קפה" are both "כפ"): the closer the
        // actual spelling, the more a sound-alike match is worth.
        s = Math.max(light, keyScore(q.phon, c.phon, prefix) * (0.86 + 0.1 * light));
      }
    }
    // Across scripts compare consonant skeletons (only for what was actually typed).
    const qs = compact(q.skel).length;
    if (s < 0.9 && v.kind === 'typed' && qs >= 3 && compact(c.skel).length >= 3) {
      // Short skeletons say little ("BRSB" is both באר שבע and Warsaw).
      const trust = q.script === c.script ? 0.8 : qs >= 5 ? 0.86 : qs === 4 ? 0.8 : 0.72;
      s = Math.max(s, keyScore(q.skel, c.skel, prefix) * trust);
    }
    best = Math.max(best, s * v.weight);
  }
  return best;
}

/**
 * How well a name matches a query, 0..1. `prefix` (default true) treats the query as text
 * still being typed, so "דיזנ" matches "דיזנגוף".
 */
export function fuzzyScore(query: string | PreparedQuery, name: string, opts: { prefix?: boolean } = {}): number {
  const pq = typeof query === 'string' ? prepareQuery(query) : query;
  return scoreKeys(pq, cachedKeys(name), opts.prefix ?? true);
}

/** Keys of names scored over and over while typing (the businesses on the map). */
const keyCache = new Map<string, Keys>();
function cachedKeys(name: string): Keys {
  let k = keyCache.get(name);
  if (!k) {
    if (keyCache.size > 20000) keyCache.clear();
    keyCache.set(name, (k = keysOf(name)));
  }
  return k;
}

// ---------------------------------------------------------------------------
// Index

export interface NameEntry {
  /** The name as shown. */
  n: string;
  /** Kind: city, town, hood, street, poi, word (a category word such as "קפה"), ... */
  k?: string;
  /** Importance, any non-negative scale (normalized per index). */
  w?: number;
  /** City, for streets and neighbourhoods. */
  c?: string;
  /** The same place's name in the other language. */
  alt?: string;
}

export interface NameIndex {
  entries: NameEntry[];
  keys: Keys[];
  /** log-normalized weights 0..1 */
  weights: Float32Array;
  /** Trigram inverted lists in one flat array: gram -> [start, end) in `postings`. */
  gramSlot: Map<number, number>;
  offsets: Int32Array;
  postings: Int32Array;
  /** Number of distinct grams of each entry. */
  gramCount: Uint8Array;
  /** Light keys of every whole name, and every word of every name (for "is this a known word"). */
  known: Set<string>;
  /** Lazily built index of single words, for per-word corrections. */
  words?: NameIndex;
}

/** 7-bit code of a key character: markers, digits, a-z, Hebrew letters, skeleton capitals. */
function charCode(c: number): number {
  if (c >= 0x5d0 && c <= 0x5ea) return 40 + (c - 0x5d0); // 40..66
  if (c >= 97 && c <= 122) return 10 + (c - 97); // 10..35
  if (c >= 65 && c <= 90) return 70 + (c - 65); // 70..95
  if (c >= 48 && c <= 57) return 100 + (c - 48);
  return 3;
}

/** Distinct trigrams (as integers) of the phon and skeleton keys, padded with start/end markers. */
function keyGrams(k: Keys, out: number[] = []): number[] {
  out.length = 0;
  // Whole keys, plus each word of a multi-word name so word order does not matter.
  const parts = [compact(k.phon), compact(k.skel)];
  if (k.phon.includes(' ')) for (const w of k.phon.split(' ')) if (w.length >= 2) parts.push(w);
  for (const key of parts) {
    if (!key) continue;
    let a = 1;
    let b = charCode(key.charCodeAt(0));
    for (let i = 1; i <= key.length; i++) {
      const c = i < key.length ? charCode(key.charCodeAt(i)) : 2;
      const g = (a << 14) | (b << 7) | c;
      if (!out.includes(g)) out.push(g);
      a = b;
      b = c;
    }
    // Single-character keys still get a gram.
    if (key.length === 1) out.push((1 << 14) | (charCode(key.charCodeAt(0)) << 7) | 2);
  }
  return out;
}

/** Build a search index over names (strings or entries). */
export function makeIndex(names: (string | NameEntry)[]): NameIndex {
  const steps = buildIndex(names);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * The same, yielding to the browser every few thousand names so a big list (an OSM names
 * file) does not freeze typing while it is indexed.
 */
export async function makeIndexAsync(names: (string | NameEntry)[], pause: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0))): Promise<NameIndex> {
  const steps = buildIndex(names);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    await pause();
  }
}

const CHUNK = 4000;

function* buildIndex(names: (string | NameEntry)[]): Generator<void, NameIndex> {
  const entries = names.map((n) => (typeof n === 'string' ? { n } : n)).filter((e) => e.n && e.n.trim());
  const N = entries.length;
  const keys: Keys[] = new Array(N);
  for (let i = 0; i < N; i++) {
    keys[i] = keysOf(entries[i].n);
    if (i % CHUNK === CHUNK - 1) yield;
  }
  let maxW = 0;
  for (const e of entries) maxW = Math.max(maxW, e.w ?? 0);
  const weights = new Float32Array(N);
  entries.forEach((e, i) => (weights[i] = maxW > 0 ? Math.log1p(e.w ?? 0) / Math.log1p(maxW) : 0));
  const known = new Set<string>();
  // Pass 1: grams of every entry into one flat list, and how many entries hold each gram.
  const gramCount = new Uint8Array(N);
  let flat = new Int32Array(Math.max(16, N * 24));
  let used = 0;
  // gram -> slot + 1 while building (grams are 21-bit integers).
  const slotOf = new Int32Array(1 << 21);
  const sizes: number[] = [];
  const tmp: number[] = [];
  for (let i = 0; i < N; i++) {
    const k = keys[i];
    known.add(compact(k.light));
    for (const w of k.light.split(' ')) known.add(w);
    const gs = keyGrams(k, tmp);
    gramCount[i] = Math.min(255, gs.length);
    if (used + gs.length + 1 > flat.length) {
      const bigger = new Int32Array(flat.length * 2 + gs.length);
      bigger.set(flat);
      flat = bigger;
    }
    flat[used++] = gs.length;
    for (const g of gs) {
      let slot = slotOf[g] - 1;
      if (slot < 0) {
        slot = sizes.length;
        slotOf[g] = slot + 1;
        sizes.push(0);
      }
      sizes[slot]++;
      flat[used++] = slot;
    }
    if (i % CHUNK === CHUNK - 1) yield;
  }
  // Pass 2: lay the inverted lists out back to back.
  const offsets = new Int32Array(sizes.length + 1);
  for (let s = 0; s < sizes.length; s++) offsets[s + 1] = offsets[s] + sizes[s];
  const fill = offsets.slice(0, sizes.length);
  const postings = new Int32Array(offsets[sizes.length]);
  for (let i = 0, p = 0; i < N; i++) {
    const n = flat[p++];
    for (let j = 0; j < n; j++) postings[fill[flat[p++]]++] = i;
  }
  const gramSlot = new Map<number, number>();
  for (let g = 0; g < slotOf.length; g++) if (slotOf[g]) gramSlot.set(g, slotOf[g] - 1);
  return { entries, keys, weights, gramSlot, offsets, postings, gramCount, known };
}

export interface FuzzyMatch {
  entry: NameEntry;
  index: number;
  /** 0..1 match quality, before the importance bonus. */
  score: number;
  /** Score with the importance bonus, used for ranking. */
  rank: number;
}

let counts = new Uint16Array(0);

/**
 * Best matches for a query. `prefix` (default true) for text being typed; `minScore`
 * (default 0.6) drops weak matches; `candidates` (default 250) is how many names that share
 * the most trigrams with the query get a full score.
 */
export function searchIndex(
  index: NameIndex,
  query: string | PreparedQuery,
  opts: { limit?: number; prefix?: boolean; minScore?: number; candidates?: number } = {},
): FuzzyMatch[] {
  const pq = typeof query === 'string' ? prepareQuery(query) : query;
  const limit = opts.limit ?? 10;
  const minScore = opts.minScore ?? 0.6;
  const prefix = opts.prefix ?? true;
  const N = index.entries.length;
  if (!N || !compact(pq.variants[0].keys.light)) return [];
  if (counts.length < N) counts = new Uint16Array(N);
  const qGrams = new Set<number>();
  for (const v of pq.variants) for (const g of keyGrams(v.keys)) qGrams.add(g);
  const touched: number[] = [];
  for (const g of qGrams) {
    const slot = index.gramSlot.get(g);
    if (slot === undefined) continue;
    const { postings } = index;
    for (let i = index.offsets[slot], end = index.offsets[slot + 1]; i < end; i++) {
      const id = postings[i];
      if (counts[id] === 0) touched.push(id);
      if (counts[id] < 65535) counts[id]++;
    }
  }
  // Keep the names most alike in trigrams (Dice coefficient), so long names do not win by size.
  const maxC = opts.candidates ?? 250;
  let cands = touched;
  if (touched.length > maxC) {
    const qn = qGrams.size;
    const dice = (id: number) => counts[id] / (qn + index.gramCount[id]) + 0.001 * index.weights[id];
    // Cheap pre-cut: names sharing very few grams cannot make the list.
    let minCount = 1;
    while (minCount < 6) {
      let n = 0;
      for (const id of touched) if (counts[id] > minCount) n++;
      if (n < maxC * 4) break;
      minCount++;
    }
    cands = touched.filter((id) => counts[id] >= minCount);
    const sc = new Map<number, number>();
    for (const id of cands) sc.set(id, dice(id));
    cands.sort((a, b) => sc.get(b)! - sc.get(a)!);
    cands = cands.slice(0, maxC);
  }
  for (const id of touched) counts[id] = 0;
  const out: FuzzyMatch[] = [];
  for (const id of cands) {
    const score = scoreKeys(pq, index.keys[id], prefix);
    if (score < minScore) continue;
    out.push({ entry: index.entries[id], index: id, score, rank: score + 0.04 * index.weights[id] });
  }
  out.sort((a, b) => b.rank - a.rank);
  // One row per name.
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.entry.n) ? false : (seen.add(m.entry.n), true))).slice(0, limit);
}

/** Merge several indexes' worth of names into one (e.g. the built-in dictionary plus a downloaded list). */
export function mergeNames(...lists: (NameEntry[] | undefined)[]): NameEntry[] {
  const seen = new Map<string, NameEntry>();
  for (const l of lists) {
    for (const e of l ?? []) {
      const k = `${lightKey(e.n)}|${e.c ?? ''}`;
      const prev = seen.get(k);
      if (!prev || (e.w ?? 0) > (prev.w ?? 0)) seen.set(k, { ...prev, ...e, alt: e.alt ?? prev?.alt });
    }
  }
  return [...seen.values()];
}

function wordsIndex(index: NameIndex): NameIndex {
  if (index.words) return index.words;
  const best = new Map<string, NameEntry>();
  index.entries.forEach((e, i) => {
    const w = index.weights[i];
    for (const word of e.n.split(/[\s\-־–,()]+/)) {
      if (lightKey(word).length < 2) continue;
      const k = lightKey(word);
      const prev = best.get(k);
      best.set(k, { n: word, k: 'word', w: (prev?.w ?? 0) + 1 + w });
    }
  });
  index.words = makeIndex([...best.values()]);
  return index.words;
}

/** Is this word (or the whole text) a known name or name word? Glued Hebrew prefixes are allowed. */
export function isKnownWord(index: NameIndex, word: string): boolean {
  const k = keysOf(word);
  const l = compact(k.light);
  if (index.known.has(l)) return true;
  if (k.script === 'he' && l.length > 2 && HE_PREFIX.includes(l[0])) {
    const rest = l.slice(1);
    if (index.known.has(rest)) return true;
    if (rest.length > 2 && HE_PREFIX.includes(rest[0]) && index.known.has(rest.slice(1))) return true;
  }
  return false;
}

export interface Correction {
  /** The corrected query to search for. */
  text: string;
  /** Its other-language form, when the dictionary knows one. */
  alt?: string;
  score: number;
  /** whole = the query is a misspelled known name; words = some words were fixed; layout = typed in the wrong keyboard language. */
  kind: 'whole' | 'words' | 'layout';
}

/**
 * Likely intended queries for a misspelled one, best first. Empty when the query is already
 * made of known names and words (nothing to correct) or nothing is close enough.
 */
export function suggestCorrections(query: string, index: NameIndex, opts: { limit?: number; minScore?: number } = {}): Correction[] {
  const limit = opts.limit ?? 2;
  const norm0 = lightKey(query).replace(/ /g, '');
  // Short words are easy to "correct" into something else entirely ("build" -> Blida).
  const minScore = opts.minScore ?? (norm0.length <= 5 ? 0.82 : 0.76);
  const norm = normalizeQuery(query);
  const typed = keysOf(norm);
  const qLight = compact(typed.light);
  if (qLight.length < 3) return [];
  const words = typed.light.split(' ');
  const allKnown = words.every((w) => w.length < 2 || isKnownWord(index, w)) || index.known.has(qLight);
  const out: Correction[] = [];
  const add = (c: Correction) => {
    if (lightKey(c.text) === typed.light) return;
    const prev = out.find((o) => lightKey(o.text) === lightKey(c.text));
    if (prev) prev.score = Math.max(prev.score, c.score);
    else out.push(c);
  };

  const pq = prepareQuery(norm);
  // A layout slip that reads as known words is almost certainly what was meant.
  const swapped = swapKeyboardLayout(norm);
  if (swapped && !allKnown) {
    const sw = keysOf(swapped).light.split(' ');
    const known = sw.filter((w) => w.length >= 2 && isKnownWord(index, w)).length;
    if (known && known >= Math.ceil(sw.length / 2)) add({ text: swapped, score: 0.95, kind: 'layout' });
  }
  // The whole query as one misspelled name ("ירושליים", "tel avive").
  for (const m of searchIndex(index, pq, { limit: 6, prefix: false, minScore })) {
    if (m.entry.k === 'word' && words.length > 1) continue;
    // Correct into the script that was typed; the other script's form rides along as alt.
    if (index.keys[m.index].script !== typed.script) continue;
    if (compact(index.keys[m.index].light) === qLight) return []; // exactly a known name
    if (allKnown && m.score < 0.97) continue; // known words in another order: not a typo
    add({ text: m.entry.n, alt: m.entry.alt, score: m.score, kind: 'whole' });
  }
  // Word by word ("פיצא בתל אביב" -> "פיצה בתל אביב").
  if (!allKnown && words.length > 1) {
    const wi = wordsIndex(index);
    let changed = 0;
    let total = 0;
    const fixed = norm.split(/\s+/).map((w) => {
      const l = lightKey(w);
      if (l.length < 3 || isKnownWord(index, w)) {
        total += 1;
        return w;
      }
      // Keep a glued Hebrew prefix glued: "בדיזנגוב" -> "בדיזנגוף".
      const glued = scriptOf(l) === 'he' && l.length > 3 && HE_PREFIX.includes(l[0]);
      const sameScript = (m?: FuzzyMatch) => (m && wi.keys[m.index].script === typed.script ? m : undefined);
      const find = (t: string) => sameScript(searchIndex(wi, t, { limit: 4, prefix: false, minScore: 0.7 }).find((m) => wi.keys[m.index].script === typed.script));
      let best = find(w);
      let pre = '';
      if (glued) {
        const b2 = find(w.slice(1));
        if (b2 && (!best || b2.score > best.score)) {
          best = b2;
          pre = w[0];
        }
      }
      if (!best) {
        total += 0.5;
        return w;
      }
      changed++;
      total += best.score;
      return pre + best.entry.n;
    });
    if (changed) add({ text: fixed.join(' '), score: (total / fixed.length) * 0.98, kind: 'words' });
  }
  out.sort((a, b) => b.score - a.score);
  // A runner-up only when it is nearly as likely as the best guess.
  return out.filter((c, i) => i === 0 || c.score >= out[0].score - 0.06).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Highlighting

export interface Segment {
  text: string;
  bold: boolean;
}

/**
 * The parts of `name` that match what was typed, for bold text in a suggestion list.
 * Each query word marks the start of its best-matching name word.
 */
export function highlightMatch(name: string, query: string): Segment[] {
  const qWords = lightKey(query).split(' ').filter(Boolean);
  if (!qWords.length) return [{ text: name, bold: false }];
  const parts = name.split(/(\s+|[-־–,()]+)/);
  const marks: { start: number; end: number }[] = [];
  let pos = 0;
  const words: { text: string; start: number }[] = [];
  for (const p of parts) {
    if (p && !/^(\s+|[-־–,()]+)$/.test(p)) words.push({ text: p, start: pos });
    pos += p.length;
  }
  const used = new Set<number>();
  qWords.forEach((q, qi) => {
    const last = qi === qWords.length - 1;
    const pq = prepareQuery(q);
    let best = 0;
    let bestI = -1;
    words.forEach((w, i) => {
      if (used.has(i)) return;
      const s = scoreKeys(pq, keysOf(w.text), last);
      if (s > best) {
        best = s;
        bestI = i;
      }
    });
    if (bestI < 0 || best < 0.6) return;
    used.add(bestI);
    const w = words[bestI];
    const wl = lightKey(w.text).length;
    // Whole word when it is (nearly) all typed, else the typed share of it.
    const len = q.length >= wl - 1 || !last ? w.text.length : Math.min(w.text.length, Math.max(1, Math.round((q.length / wl) * w.text.length)));
    marks.push({ start: w.start, end: w.start + len });
  });
  if (!marks.length) return [{ text: name, bold: false }];
  marks.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start > at) out.push({ text: name.slice(at, m.start), bold: false });
    out.push({ text: name.slice(m.start, m.end), bold: true });
    at = m.end;
  }
  if (at < name.length) out.push({ text: name.slice(at), bold: false });
  return out;
}
