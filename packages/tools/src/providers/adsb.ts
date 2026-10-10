import type { LngLat } from '@nm/core';
import { getJson, ProviderError, type ToolContext } from '../define.ts';

/**
 * Live aircraft by callsign from an ADS-B aggregator speaking the readsb JSON format
 * (adsb.lol by default: free, no key, open data under ODbL). Only the flight number is sent.
 * GET {base}/v2/callsign/{CALLSIGN} -> { ac: [{ hex, flight, lat, lon, alt_baro, gs, track, ... }] }
 */

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
