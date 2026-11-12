import type { LngLat } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

/**
 * Live aircraft by callsign from an ADS-B aggregator speaking the readsb JSON format
 * (adsb.lol by default: free, no key, open data under ODbL). Only the flight number is sent.
 * GET {base}/v2/callsign/{CALLSIGN} -> { ac: [{ hex, flight, lat, lon, alt_baro, gs, track, ... }] }
 */

/**
 * What to draw: airliner (narrow body), wide body, turboprop, business jet, light aircraft,
 * helicopter, fighter, glider, balloon or airship, drone.
 */
export type AircraftKind = 'jet' | 'heavy' | 'prop' | 'bizjet' | 'light' | 'heli' | 'fighter' | 'glider' | 'balloon' | 'drone';

const HEAVY_TYPES = /^(A3[3-5]\d|A38\d|A30\d|A310|B74\w|B76\d|B77\w|B78\d|MD11|IL96|IL76|IL62|C17|A400|A124|A225|AN22|B52|KC10|K35R|K35E|E3TF|E3CF|DC10|L101|C5M|A332|A333|A339|A359|A35K|B744|B748)$/;
const HELI_TYPES = /^(EC\d\d|EC\w\w|AS32|AS3B|AS50|AS55|AS65|R22|R44|R66|B06|B06T|B212|B412|B429|B407|B505|H\d\d\d|H\d\d|S76|S92|S61|A109|A119|A139|A149|A169|A189|AW\d\d\d|UH\d+|H60|H47|H64|NH90|MI8|MI17|MI24|MI26|KA\d\d|EH10|AS50|AS55|AS65|BK17|EXPL|G2CA|CH47|V22|LYNX|PUMA|ALO3|GAZL)$/;
const FIGHTER_TYPES = /^(F14|F15|F16|F18|F117|F4|F5|FA18|F18S|F35|F22|EUFI|RFAL|TOR|HAWK|T38|T45|T6|M346|L159|L39|A10|AV8B|MIR2|M2KC|SU\d\d|MG\d\d|J10|J20|JF17|GRIF|ALPJ|K8|T50|HUNT|KFIR|F4)$/;
const BIZJET_TYPES = /^(C25\w|C500|C501|C510|C525|C526|C550|C551|C560|C56X|C650|C680|C68A|C700|C750|GLF\d|GL5T|GL6T|GL7T|GLEX|GA5C|GA6C|GA7C|GA8C|CL30|CL35|CL60|CL64|F2TH|F900|FA10|FA20|FA50|FA6X|FA7X|FA8X|LJ\d\d|E50P|E55P|E545|E550|E35L|H25\w|PRM1|HDJT|BE40|G150|G200|G280|ASTR|GALX|PC24|SF50|EA50|E35L)$/;
const PROP_TYPES = /^(AT4\d|AT5\d|AT7\d|ATP|DH8\w|DHC\d|SF34|JS3\d|JS41|B190|B350|BE20|BE30|BE9L|BE99|E110|E120|D228|D328|SW\d|F27|F50|AN2\d|AN3\d|L410|SB20|SH36|C212|CN35|C295|C130|C30J|C160|P3|DO28|BN2\w|TRIS|PC12|C208|KODI|TBM\d|PC6T|PA46|M600|AT8T|AT6T|AT5T|DHC2|Y12|MA60)$/;
const LIGHT_TYPES = /^(C1\d\d|C2\d\d|C3\d\d|P28\w|PA\d\d|PA\w\w|SR2\d|DA[24]\d|DA62|BE\d\d|M20\w|TB\d\d|DR40|C42|ULAC|AAT3|PIVI|EV97|CRUZ|WT9|TL20|SIRA|RV\d+|A210|BREZ|DV20|J3|CH60|ZLIN|Z42|Z43|SUBA|SAVG)$/;
const GLIDER_TYPES = /^(GLID|AS2\d|AS3[13]|ASK\d\d|ASW\d\d|ASG\d\d|ASH\d\d|DG\d+|LS\d|LAK\d+|DUOD|ARCP|JANU|DISC|VENT|NIMB|G102|G103|G109|PIK\d+)$/;
const BALLOON_TYPES = /^(BALL|ZEPP|SHIP|AIRSHIP|BLMP)$/;

/**
 * The kind from the ICAO type designator when it is known (most specific), else the ADS-B
 * emitter category ("A5" heavy, "A7" rotorcraft…) or OpenSky's numeric category. Null for things
 * that aren't aircraft (airport vehicles, obstacles, parachutists), which the live map leaves out.
 */
export function aircraftKind(category: string | number | null | undefined, type?: string): AircraftKind | null {
  let cat: string | null = null;
  if (typeof category === 'number') {
    if (category >= 16 || category === 11) return null; // surface vehicles, obstacles, parachutists
    cat = ({ 2: 'A1', 3: 'A2', 4: 'A3', 5: 'A4', 6: 'A5', 7: 'A6', 8: 'A7', 9: 'B1', 10: 'B2', 12: 'B4', 14: 'B6', 15: 'B7' } as Record<number, string>)[category] ?? null;
  } else if (typeof category === 'string' && category) {
    cat = category.toUpperCase();
    if (cat[0] === 'C' || cat === 'B3') return null;
  }
  // Categories that say more than any type could.
  if (cat === 'A7') return 'heli';
  if (cat === 'B1') return 'glider';
  if (cat === 'B2') return 'balloon';
  if (cat === 'B6') return 'drone';
  const t = type?.toUpperCase();
  if (t) {
    if (HELI_TYPES.test(t)) return 'heli';
    if (BALLOON_TYPES.test(t)) return 'balloon';
    if (GLIDER_TYPES.test(t)) return 'glider';
    if (FIGHTER_TYPES.test(t)) return 'fighter';
    if (HEAVY_TYPES.test(t)) return 'heavy';
    if (BIZJET_TYPES.test(t)) return 'bizjet';
    if (PROP_TYPES.test(t)) return 'prop';
    if (LIGHT_TYPES.test(t)) return 'light';
  }
  if (cat === 'A5') return 'heavy';
  if (cat === 'A6') return 'fighter';
  if (cat === 'A1' || cat === 'B4') return 'light';
  return 'jet';
}

export interface AircraftPosition {
  callsign: string;
  /** ICAO 24-bit address. */
  hex: string;
  registration?: string;
  /** ICAO type designator ("B789"). */
  type?: string;
  lngLat: LngLat;
  /** Meters above mean sea level (geometric when known, else barometric); null when unknown. */
  altitudeM: number | null;
  onGround: boolean;
  groundSpeedKmh: number | null;
  /** Degrees clockwise from true north. */
  track: number | null;
  /** How old the position is, seconds. */
  ageS: number | null;
  /** Climb (+) or descent (-), m/s; null or missing when unknown or on the ground. */
  verticalRateMs?: number | null;
  /** Aircraft model in words ("BOEING 787-9"), when the feed has it. */
  description?: string;
  /** Operator, when the feed has it. */
  operator?: string;
  /** Country the aircraft is registered in (OpenSky). */
  country?: string;
  /** What to draw; null for ground vehicles and obstacles. */
  kind?: AircraftKind | null;
  /** Transponder code ("7700" is an emergency). */
  squawk?: string;
  /** Flagged military in the feed's aircraft database. */
  military?: boolean;
}

export interface FlightLookup {
  /** The callsigns that were tried, in order. */
  tried: string[];
  aircraft: AircraftPosition[];
}

/**
 * Airline flight-number prefixes (IATA) to the ICAO prefixes that ADS-B callsigns use.
 * Unknown airlines are tried as typed, which works when people type the ICAO callsign.
 */
const IATA_TO_ICAO: Record<string, string> = {
  LY: 'ELY', IZ: 'AIZ', '6H': 'ISR', '5C': 'ICL', BA: 'BAW', VS: 'VIR', U2: 'EZY', FR: 'RYR', W6: 'WZZ', W4: 'WMT',
  LH: 'DLH', LX: 'SWR', OS: 'AUA', SN: 'BEL', EW: 'EWG', AF: 'AFR', KL: 'KLM', HV: 'TRA', TO: 'TVF', AZ: 'ITY',
  IB: 'IBE', VY: 'VLG', UX: 'AEA', TP: 'TAP', SK: 'SAS', AY: 'FIN', DY: 'NOZ', D8: 'NSZ', LO: 'LOT', OK: 'CSA',
  RO: 'ROT', A3: 'AEE', OA: 'OAL', FB: 'LZB', JU: 'ASL', TK: 'THY', PC: 'PGT', XQ: 'SXS', PS: 'AUI', BT: 'BTI',
  EK: 'UAE', FZ: 'FDB', EY: 'ETD', QR: 'QTR', GF: 'GFA', WY: 'OMA', SV: 'SVA', RJ: 'RJA', MS: 'MSR', ME: 'MEA',
  ET: 'ETH', KQ: 'KQA', SA: 'SAA', AT: 'RAM', AI: 'AIC', '6E': 'IGO', SQ: 'SIA', CX: 'CPA', TG: 'THA', MH: 'MAS',
  GA: 'GIA', PR: 'PAL', VN: 'HVN', CI: 'CAL', BR: 'EVA', NH: 'ANA', JL: 'JAL', KE: 'KAL', OZ: 'AAR', CA: 'CCA',
  MU: 'CES', CZ: 'CSN', HU: 'CHH', QF: 'QFA', VA: 'VOZ', NZ: 'ANZ', UA: 'UAL', AA: 'AAL', DL: 'DAL', WN: 'SWA',
  B6: 'JBU', AS: 'ASA', NK: 'NKS', F9: 'FFT', AC: 'ACA', WS: 'WJA', AM: 'AMX', LA: 'LAN', AV: 'AVA', CM: 'CMP',
  G3: 'GLO', AD: 'AZU', AR: 'ARG', SU: 'AFL', S7: 'SBI', HY: 'UZB', KC: 'KZR', J2: 'AHY', A9: 'TGZ', FI: 'ICE',
  EI: 'EIN', LS: 'EXS', BY: 'TOM', DE: 'CFG', X3: 'TUI', '4U': 'GWI', EN: 'DLA', V7: 'VOE', '3O': 'MAC', '8Q': 'OHY',
};

/** Callsigns worth trying for what the user typed ("LY 1", "ly001", "ELY001"). */
export function callsignCandidates(input: string): string[] {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  const out: string[] = [];
  const add = (c: string) => {
    if (/^[A-Z0-9]{2,8}$/.test(c) && !out.includes(c)) out.push(c);
  };
  const iata = /^([A-Z0-9]{2})(\d{1,4})([A-Z]?)$/.exec(s);
  const icao = /^([A-Z]{3})(\d{1,4})([A-Z]?)$/.exec(s);
  if (icao) {
    add(s);
    add(icao[1] + String(Number(icao[2])) + icao[3]);
  } else if (iata && IATA_TO_ICAO[iata[1]]) {
    const prefix = IATA_TO_ICAO[iata[1]];
    const n = String(Number(iata[2]));
    add(prefix + n + iata[3]);
    add(prefix + n.padStart(3, '0') + iata[3]);
  }
  add(s);
  return out.slice(0, 3);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Parses a readsb-style response; tolerant of missing fields and odd values. */
export function parseAdsb(json: unknown): AircraftPosition[] {
  const root = (json ?? {}) as { ac?: unknown; aircraft?: unknown };
  const list = Array.isArray(root.ac) ? root.ac : Array.isArray(root.aircraft) ? root.aircraft : [];
  const out: AircraftPosition[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    // Some feeds only have the last known position (lastPosition / rr_lat).
    const last = (a.lastPosition ?? {}) as Record<string, unknown>;
    const lat = num(a.lat) ?? num(last.lat) ?? num(a.rr_lat);
    const lon = num(a.lon) ?? num(last.lon) ?? num(a.rr_lon);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const onGround = a.alt_baro === 'ground' || a.ground === true;
    const altFt = num(a.alt_geom) ?? num(a.alt_baro);
    const gsKt = num(a.gs);
    const track = num(a.track) ?? num(a.true_heading) ?? num(a.mag_heading);
    const age = num(a.seen_pos) ?? num(last.seen_pos) ?? num(a.seen);
    const rateFpm = num(a.geom_rate) ?? num(a.baro_rate);
    out.push({
      callsign: str(a.flight) ?? str(a.callsign) ?? '',
      hex: str(a.hex)?.replace(/^~/, '') ?? '',
      registration: str(a.r),
      type: str(a.t),
      lngLat: [lon, lat],
      altitudeM: onGround ? 0 : altFt === null ? null : Math.round(altFt * 0.3048),
      onGround,
      groundSpeedKmh: gsKt === null ? null : Math.round(gsKt * 1.852),
      track: track === null ? null : ((track % 360) + 360) % 360,
      ageS: age,
      verticalRateMs: onGround || rateFpm === null ? null : Math.round(rateFpm * 0.00508 * 10) / 10,
      description: str(a.desc),
      operator: str(a.ownOp),
      kind: aircraftKind(str(a.category), str(a.t)),
      squawk: str(a.squawk),
      military: (num(a.dbFlags) ?? 0) & 1 ? true : undefined,
    });
  }
  // Freshest first.
  return out.sort((x, y) => (x.ageS ?? 1e9) - (y.ageS ?? 1e9));
}

export async function findFlight(ctx: ToolContext, callsign: string): Promise<FlightLookup> {
  const base = ctx.config.flightsUrl.replace(/\/$/, '');
  if (!base) throw new ProviderError('חיפוש טיסות לא מוגדר בשרת הזה.', undefined, 'flights');
  const tried: string[] = [];
  for (const cs of callsignCandidates(callsign)) {
    tried.push(cs);
    const json = await getJson<unknown>(ctx, `${base}/v2/callsign/${encodeURIComponent(cs)}`, {}, 'flights', 10000);
    const aircraft = parseAdsb(json);
    if (aircraft.length) return { tried, aircraft };
  }
  return { tried, aircraft: [] };
}
