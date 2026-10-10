import { encodePolyline } from '../packages/core/src/polyline.ts';

/** MOTIS (Transitous) answers for public transport, with times relative to the request. */
const iso = (now: number, min: number) => new Date(now + min * 60000).toISOString();
const place = (name: string, lon: number, lat: number, stopId?: string) => ({ name, lon, lat, stopId });
const geom = (pts: [number, number][]) => ({ points: encodePolyline(pts, 6), precision: 6, length: pts.length });

const START: [number, number] = [34.7741, 32.0787];
const STOP_A: [number, number] = [34.7752, 32.0779];
const STOP_B: [number, number] = [34.7905, 32.0752];
const END: [number, number] = [34.7918, 32.0745];

function walk(now: number, a: [number, number], b: [number, number], from: string, to: string, t0: number, t1: number, m: number) {
  return { mode: 'WALK', from: place(from, ...a), to: place(to, ...b), duration: (t1 - t0) * 60, startTime: iso(now, t0), endTime: iso(now, t1), scheduledStartTime: iso(now, t0), scheduledEndTime: iso(now, t1), realTime: false, distance: m, legGeometry: geom([a, b]) };
}

export function motisPlan(now = Date.now()) {
  const ride = (line: string, color: string, t0: number, t1: number, realTime: boolean) => ({
    mode: 'BUS',
    from: place('דיזנגוף/ארלוזורוב', ...STOP_A, 'il:1'),
    to: place('עזריאלי', ...STOP_B, 'il:2'),
    duration: (t1 - t0) * 60,
    startTime: iso(now, t0 + (realTime ? 1 : 0)),
    endTime: iso(now, t1 + (realTime ? 1 : 0)),
    scheduledStartTime: iso(now, t0),
    scheduledEndTime: iso(now, t1),
    realTime,
    headsign: 'תחנה מרכזית',
    routeShortName: line,
    routeColor: color,
    agencyName: 'דן',
    intermediateStops: [place('אבן גבירול', 34.781, 32.0768), place('שאול המלך', 34.786, 32.0758)],
    legGeometry: geom([STOP_A, [34.781, 32.0768], [34.786, 32.0758], STOP_B]),
  });
  const it = (line: string, color: string, t0: number, realTime: boolean) => ({
    duration: (t0 + 14 - 0) * 60,
    startTime: iso(now, 0),
    endTime: iso(now, t0 + 14),
    transfers: 0,
    legs: [walk(now, START, STOP_A, 'מוצא', 'דיזנגוף/ארלוזורוב', 0, t0, 150), ride(line, color, t0, t0 + 11, realTime), walk(now, STOP_B, END, 'עזריאלי', 'יעד', t0 + 11, t0 + 14, 180)],
  });
  return { from: place('מוצא', ...START), to: place('יעד', ...END), direct: [], itineraries: [it('18', '0b8043', 4, true), it('61', 'f9a825', 9, false)], previousPageCursor: '', nextPageCursor: '' };
}

export function motisStoptimes(now = Date.now()) {
  const st = (line: string, headsign: string, min: number, realTime: boolean, color: string, mode = 'BUS') => ({
    place: { ...place('דיזנגוף/ארלוזורוב', ...STOP_A, 'il:1'), departure: iso(now, min + (realTime ? 2 : 0)), scheduledDeparture: iso(now, min) },
    mode,
    realTime,
    headsign,
    routeShortName: line,
    routeColor: color,
    agencyName: 'דן',
    cancelled: false,
    tripCancelled: false,
  });
  return {
    place: place('דיזנגוף/ארלוזורוב', ...STOP_A, 'il:1'),
    stopTimes: [st('18', 'בת ים', 3, true, '0b8043'), st('5', 'תחנה מרכזית', 7, false, 'e53935'), st('61', 'עזריאלי', 12, true, 'f9a825')],
    previousPageCursor: '',
    nextPageCursor: '',
  };
}
