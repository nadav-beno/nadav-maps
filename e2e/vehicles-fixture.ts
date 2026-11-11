import { encodePolyline } from '../packages/core/src/polyline.ts';

/**
 * Live vehicles around central Tel Aviv: MOTIS `map/trips` segments (a light rail tram with live
 * times, a bus by timetable) and Open Bus Stride GPS rows (two buses, one fix too old to show).
 * Times are relative to `now` so the vehicles are on the move whenever the test runs.
 */
const iso = (now: number, s: number) => new Date(now + s * 1000).toISOString();
const place = (name: string, lon: number, lat: number) => ({ name, lon, lat, level: 0 });

const TRAM_A: [number, number] = [34.7815, 32.0705];
const TRAM_B: [number, number] = [34.7880, 32.0755];
const TRAM_C: [number, number] = [34.7930, 32.0800];

export function motisTrips(now = Date.now()) {
  return [
    {
      trips: [{ tripId: 'il_tram_r1', displayName: 'R' }],
      routeColor: 'e2001a',
      mode: 'TRAM',
      distance: 800,
      from: place('קרליבך', ...TRAM_A),
      to: place('יהודית', ...TRAM_B),
      departure: iso(now, -60),
      arrival: iso(now, 60),
      scheduledDeparture: iso(now, -120),
      scheduledArrival: iso(now, 0),
      realTime: true,
      polyline: encodePolyline([TRAM_A, TRAM_B], 5),
    },
    {
      trips: [{ tripId: 'il_tram_r1', displayName: 'R' }],
      routeColor: 'e2001a',
      mode: 'TRAM',
      distance: 700,
      from: place('יהודית', ...TRAM_B),
      to: place('ארלוזורוב', ...TRAM_C),
      departure: iso(now, 90),
      arrival: iso(now, 200),
      scheduledDeparture: iso(now, 30),
      scheduledArrival: iso(now, 140),
      realTime: true,
      polyline: encodePolyline([TRAM_B, TRAM_C], 5),
    },
    {
      trips: [{ tripId: 'il_bus_5', displayName: '5' }],
      mode: 'BUS',
      distance: 600,
      from: place('דיזנגוף סנטר', 34.7745, 32.0755),
      to: place('כיכר רבין', 34.7810, 32.0805),
      departure: iso(now, -30),
      arrival: iso(now, 90),
      scheduledDeparture: iso(now, -30),
      scheduledArrival: iso(now, 90),
      realTime: false,
      polyline: encodePolyline([[34.7745, 32.0755], [34.7810, 32.0805]], 5),
    },
  ];
}

export function strideLocations(now = Date.now()) {
  const row = (id: number, vehicle: string, lineRef: number, lon: number, lat: number, ageS: number, bearing: number) => ({
    id,
    siri_snapshot_id: 1,
    siri_ride_stop_id: 1,
    // Stride writes UTC times with an explicit offset.
    recorded_at_time: new Date(now - ageS * 1000).toISOString().replace('Z', '+00:00'),
    lon,
    lat,
    bearing,
    velocity: 24,
    distance_from_journey_start: 1000,
    siri_route__line_ref: lineRef,
    siri_route__operator_ref: 5,
    siri_ride__id: id * 10,
    siri_ride__vehicle_ref: vehicle,
    siri_ride__scheduled_start_time: new Date(now - 1800_000).toISOString(),
  });
  return [
    row(3, '7701355', 2148, 34.7790, 32.0775, 40, 90),
    row(2, '7701355', 2148, 34.7785, 32.0772, 100, 90),
    row(1, '3829401', 10755, 34.7850, 32.0720, 70, 200),
    row(0, '1111111', 10755, 34.7900, 32.0700, 900, 0),
  ];
}

export function strideRoutes() {
  return [
    { id: 1, date: '2026-11-11', line_ref: 2148, operator_ref: 5, route_short_name: '18', route_long_name: 'ת. רכבת אוניברסיטה/תל אביב יפו<->ת. מרכזית בת ים/בת ים-1#', agency_name: 'דן', route_type: '3' },
    { id: 2, date: '2026-11-11', line_ref: 10755, operator_ref: 3, route_short_name: '25', route_long_name: 'מסוף רידינג/תל אביב יפו<->ת. רכבת בת ים יוספטל/בת ים-2#', agency_name: 'אגד', route_type: '3' },
  ];
}
