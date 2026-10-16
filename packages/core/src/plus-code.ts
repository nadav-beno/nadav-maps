/**
 * Open Location Code ("Plus Codes"), the open (Apache-2.0) grid that Google Maps shows as
 * "8G4P3QHF+2R" or, next to a town, "3QHF+2R תל אביב-יפו". Written from the public spec:
 * https://github.com/google/open-location-code/blob/main/docs/specification.md
 * Integer arithmetic like the reference implementations, so codes match them exactly.
 */

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const PADDING = '0';
const BASE = 20;
const PAIR_CODE_LENGTH = 10;
const GRID_CODE_LENGTH = 5;
const GRID_COLUMNS = 4;
const GRID_ROWS = 5;
const MAX_DIGITS = 15;
const MIN_TRIMMABLE = 6;
const LAT_MAX = 90;
const LNG_MAX = 180;
/** Units of 1/8000 degree for the pair digits. */
const PAIR_PRECISION = 8000;
const PAIR_FIRST_PLACE = BASE ** 4;
const GRID_LAT_FIRST_PLACE = GRID_ROWS ** (GRID_CODE_LENGTH - 1);
const GRID_LNG_FIRST_PLACE = GRID_COLUMNS ** (GRID_CODE_LENGTH - 1);
const FINAL_LAT_PRECISION = PAIR_PRECISION * GRID_ROWS ** GRID_CODE_LENGTH;
const FINAL_LNG_PRECISION = PAIR_PRECISION * GRID_COLUMNS ** GRID_CODE_LENGTH;
/** Degrees covered by one digit of each pair, used to shorten and recover codes. */
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];

export interface CodeArea {
  south: number;
  west: number;
  north: number;
  east: number;
  codeLength: number;
  lat: number;
  lng: number;
}

const clipLat = (lat: number) => Math.min(LAT_MAX, Math.max(-LAT_MAX, lat));
function normalizeLng(lng: number): number {
  while (lng < -LNG_MAX) lng += 360;
  while (lng >= LNG_MAX) lng -= 360;
  return lng;
}

export function isValidPlusCode(code: string): boolean {
  if (!code) return false;
  code = code.toUpperCase();
  const sep = code.indexOf(SEPARATOR);
  if (sep === -1 || sep !== code.lastIndexOf(SEPARATOR)) return false;
  if (code.length === 1) return false;
  if (sep > SEPARATOR_POSITION || sep % 2 === 1) return false;
  const pad = code.indexOf(PADDING);
  if (pad > -1) {
    if (sep < SEPARATOR_POSITION) return false;
    if (pad === 0) return false;
    const run = /0+/.exec(code)!;
    if (run.index !== pad || run[0].length % 2 === 1 || run[0].length > SEPARATOR_POSITION - 2) return false;
    if (code[code.length - 1] !== SEPARATOR) return false;
    if (code.slice(pad).replace(/0/g, '') !== SEPARATOR) return false;
  }
  if (code.length - sep - 1 === 1) return false;
  for (const ch of code.replace(SEPARATOR, '').replace(/0/g, '')) if (!ALPHABET.includes(ch)) return false;
  return true;
}

export function isShortPlusCode(code: string): boolean {
  if (!isValidPlusCode(code)) return false;
  const sep = code.indexOf(SEPARATOR);
  return sep >= 0 && sep < SEPARATOR_POSITION;
}

export function isFullPlusCode(code: string): boolean {
  if (!isValidPlusCode(code) || isShortPlusCode(code)) return false;
  code = code.toUpperCase();
  // The first digits must keep latitude below 90 and longitude below 180.
  if (ALPHABET.indexOf(code[0]) * BASE >= LAT_MAX * 2) return false;
  if (code.length > 1 && ALPHABET.indexOf(code[1]) * BASE >= LNG_MAX * 2) return false;
  return true;
}

/** Encode a coordinate. Lengths: 2, 4, 6, 8, or 10 and more (10 ≈ 14 m, 11 ≈ 3 m). */
export function encodePlusCode(lat: number, lng: number, length = PAIR_CODE_LENGTH): string {
  if (length < 2 || (length < PAIR_CODE_LENGTH && length % 2 === 1)) throw new Error('Invalid Plus Code length');
  length = Math.min(length, MAX_DIGITS);
  let latVal = Math.floor(Math.round((clipLat(lat) + LAT_MAX) * FINAL_LAT_PRECISION * 1e6) / 1e6);
  let lngVal = Math.floor(Math.round((lng + LNG_MAX) * FINAL_LNG_PRECISION * 1e6) / 1e6);
  const latSpan = 2 * LAT_MAX * FINAL_LAT_PRECISION;
  const lngSpan = 2 * LNG_MAX * FINAL_LNG_PRECISION;
  if (latVal >= latSpan) latVal = latSpan - 1;
  if (latVal < 0) latVal = 0;
  lngVal = ((lngVal % lngSpan) + lngSpan) % lngSpan;

  let code = '';
  if (length > PAIR_CODE_LENGTH) {
    for (let i = 0; i < GRID_CODE_LENGTH; i++) {
      const latDigit = latVal % GRID_ROWS;
      const lngDigit = lngVal % GRID_COLUMNS;
      code = ALPHABET[latDigit * GRID_COLUMNS + lngDigit] + code;
      latVal = Math.floor(latVal / GRID_ROWS);
      lngVal = Math.floor(lngVal / GRID_COLUMNS);
    }
  } else {
    latVal = Math.floor(latVal / GRID_ROWS ** GRID_CODE_LENGTH);
    lngVal = Math.floor(lngVal / GRID_COLUMNS ** GRID_CODE_LENGTH);
  }
  for (let i = 0; i < PAIR_CODE_LENGTH / 2; i++) {
    code = ALPHABET[lngVal % BASE] + code;
    code = ALPHABET[latVal % BASE] + code;
    latVal = Math.floor(latVal / BASE);
    lngVal = Math.floor(lngVal / BASE);
  }
  code = code.slice(0, SEPARATOR_POSITION) + SEPARATOR + code.slice(SEPARATOR_POSITION);
  if (length >= SEPARATOR_POSITION) return code.slice(0, length + 1);
  return code.slice(0, length) + PADDING.repeat(SEPARATOR_POSITION - length) + SEPARATOR;
}

const round14 = (n: number) => Math.round(n * 1e14) / 1e14;

/** The area a full code stands for. */
export function decodePlusCode(code: string): CodeArea {
  if (!isFullPlusCode(code)) throw new Error(`Not a full Plus Code: ${code}`);
  const digits = code.replace(SEPARATOR, '').replace(/0+/, '').toUpperCase().slice(0, MAX_DIGITS);
  let normalLat = -LAT_MAX * PAIR_PRECISION;
  let normalLng = -LNG_MAX * PAIR_PRECISION;
  let gridLat = 0;
  let gridLng = 0;
  const pairs = Math.min(digits.length, PAIR_CODE_LENGTH);
  let pv = PAIR_FIRST_PLACE;
  for (let i = 0; i < pairs; i += 2) {
    normalLat += ALPHABET.indexOf(digits[i]) * pv;
    normalLng += ALPHABET.indexOf(digits[i + 1]) * pv;
    if (i < pairs - 2) pv /= BASE;
  }
  let latPrecision = pv / PAIR_PRECISION;
  let lngPrecision = pv / PAIR_PRECISION;
  if (digits.length > PAIR_CODE_LENGTH) {
    let rowPv = GRID_LAT_FIRST_PLACE;
    let colPv = GRID_LNG_FIRST_PLACE;
    for (let i = PAIR_CODE_LENGTH; i < digits.length; i++) {
      const v = ALPHABET.indexOf(digits[i]);
      gridLat += Math.floor(v / GRID_COLUMNS) * rowPv;
      gridLng += (v % GRID_COLUMNS) * colPv;
      if (i < digits.length - 1) {
        rowPv /= GRID_ROWS;
        colPv /= GRID_COLUMNS;
      }
    }
    latPrecision = rowPv / FINAL_LAT_PRECISION;
    lngPrecision = colPv / FINAL_LNG_PRECISION;
  }
  const south = normalLat / PAIR_PRECISION + gridLat / FINAL_LAT_PRECISION;
  const west = normalLng / PAIR_PRECISION + gridLng / FINAL_LNG_PRECISION;
  const north = south + latPrecision;
  const east = west + lngPrecision;
  return {
    south: round14(south),
    west: round14(west),
    north: round14(north),
    east: round14(east),
    codeLength: digits.length,
    lat: round14(Math.min(south + latPrecision / 2, LAT_MAX)),
    lng: round14(Math.min(west + lngPrecision / 2, LNG_MAX)),
  };
}

/** Drop leading digits that a nearby reference point makes redundant ("8G4P3QHF+2R" -> "3QHF+2R"). */
export function shortenPlusCode(code: string, refLat: number, refLng: number): string {
  if (!isFullPlusCode(code)) throw new Error(`Not a full Plus Code: ${code}`);
  if (code.includes(PADDING)) throw new Error('Cannot shorten a padded Plus Code');
  code = code.toUpperCase();
  const area = decodePlusCode(code);
  if (area.codeLength < MIN_TRIMMABLE) throw new Error('Plus Code too short to shorten');
  const range = Math.max(Math.abs(area.lat - clipLat(refLat)), Math.abs(area.lng - normalizeLng(refLng)));
  for (let i = PAIR_RESOLUTIONS.length - 2; i >= 1; i--) {
    if (range < PAIR_RESOLUTIONS[i] * 0.3) return code.slice((i + 1) * 2);
  }
  return code;
}

/** The full code of the cell nearest to the reference point that ends with this short code. */
export function recoverPlusCode(short: string, refLat: number, refLng: number): string {
  if (!isShortPlusCode(short)) {
    if (isFullPlusCode(short)) return short.toUpperCase();
    throw new Error(`Not a valid Plus Code: ${short}`);
  }
  refLat = clipLat(refLat);
  refLng = normalizeLng(refLng);
  const padLength = SEPARATOR_POSITION - short.indexOf(SEPARATOR);
  const resolution = BASE ** (2 - padLength / 2);
  const half = resolution / 2;
  const area = decodePlusCode(encodePlusCode(refLat, refLng).slice(0, padLength) + short.toUpperCase());
  let { lat, lng } = area;
  if (refLat + half < lat && lat - resolution >= -LAT_MAX) lat -= resolution;
  else if (refLat - half > lat && lat + resolution <= LAT_MAX) lat += resolution;
  if (refLng + half < lng) lng -= resolution;
  else if (refLng - half > lng) lng += resolution;
  return encodePlusCode(lat, lng, area.codeLength);
}

export interface ParsedPlusCode {
  /** Upper-cased code as typed, full or short. */
  code: string;
  full: boolean;
  /** Text after a short code ("תל אביב-יפו"), to geocode as the reference point. */
  locality?: string;
}

const CODE_RE = /(?:^|\s)([23456789CFGHJMPQRVWX]{2,8}0*\+[23456789CFGHJMPQRVWX]{0,7})(?=$|[\s,])\s*,?\s*(.*)$/i;

/**
 * Find a Plus Code in typed text: "8G4P3QHF+2R", "3QHF+2R תל אביב-יפו", "3QHF+2R, Tel Aviv".
 * A short code needs a reference: geocode `locality`, or use the map centre, then
 * `recoverPlusCode(code, lat, lng)` and `decodePlusCode` for the point.
 */
export function parsePlusCode(text: string): ParsedPlusCode | null {
  const m = CODE_RE.exec(text.trim());
  if (!m) return null;
  const code = m[1].toUpperCase();
  if (!isValidPlusCode(code)) return null;
  const full = isFullPlusCode(code);
  if (!full && !isShortPlusCode(code)) return null;
  const locality = m[2]?.trim() || undefined;
  return { code, full, locality: full ? undefined : locality };
}

/**
 * How Google shows a place's code: the last 6+ digits and the town ("3QHF+2R תל אביב-יפו")
 * when we know one, otherwise the whole code. Towns are always well within the 30 km the
 * four dropped digits allow.
 */
export function displayPlusCode(lat: number, lng: number, locality?: string): { code: string; text: string } {
  const code = encodePlusCode(lat, lng);
  return locality ? { code, text: `${code.slice(4)} ${locality}` } : { code, text: code };
}
