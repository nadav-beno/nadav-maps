/**
 * curlbus answers around Dizengoff Center (Tel Aviv), shaped like curlbus's JSON (siri.py
 * `SIRIStopVisit.to_dict`, gtfs/utils.py): two stops, live ETAs relative to `now`, one bus that
 * already passed, one visit with the bus's position. Times are Python's str(datetime).
 */
const py = (t: number) => {
  // "2026-11-13 07:52:00+02:00" in Israel time (fixed +02:00 is fine for parsing).
  const d = new Date(t + 2 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  return `${d}+02:00`;
};

export function curlbusNearby() {
  return [
    { code: 'TA70105', name: { HE: 'דיזנגוף/קינג ג׳ורג׳', EN: 'Dizengoff/King George' }, distance: 140.2, location: { lat: 32.0762, lon: 34.7748 } },
    { code: '21330', name: { HE: 'דיזנגוף סנטר', EN: 'Dizengoff Center' }, distance: 31.5, location: { lat: 32.0754, lon: 34.7746 } },
    { code: '21331', name: { HE: 'דיזנגוף סנטר/המלך ג׳ורג׳', EN: 'Dizengoff Center/King George' }, distance: 88.9, location: { lat: 32.0759, lon: 34.7752 } },
  ];
}

const visit = (stop: string, line: string, inS: number, now: number, extra: Record<string, unknown> = {}) => ({
  producer: 'SIRI',
  timestamp: py(now - 20_000),
  stop_code: stop,
  line_id: '1234',
  route_id: '1234',
  direction_id: '1',
  line_name: line,
  operator_id: '5',
  destination_id: '20832',
  vehicle_ref: null,
  eta: py(now + inS * 1000),
  trip_id: null,
  status: null,
  departed: null,
  location: null,
  static_info: {
    route: {
      // As curlbus sends it: an English city string, the names per language beside it.
      destination: { code: '20832', name: { HE: 'ת. מרכזית בת ים/הורדה', EN: 'Bat Yam Central/Alight' }, address: { city: 'Bat Yam', city_multilingual: { HE: 'בת ים', EN: 'Bat Yam' } } },
      agency: { name: { HE: 'דן', EN: 'Dan' }, url: 'http://www.dan.co.il' },
      headsign: null,
    },
  },
  ...extra,
});

export function curlbusVisits(now = Date.now()) {
  return {
    errors: null,
    timestamp: py(now),
    visits: {
      '21330': [
        visit('21330', '18', 150, now, { vehicle_ref: '7701355', location: { lat: 32.0775, lon: 34.779 } }),
        // A position recorded long ago is not shown.
        visit('21330', '61', 540, now, { vehicle_ref: '1234567', timestamp: py(now - 3600_000), location: { lat: '32.07', lon: '34.77' } }),
        visit('21330', '5', -180, now),
      ],
      '21331': [visit('21331', '25', 300, now, { static_info: { route: { destination: { name: { HE: 'מסוף רדינג/הורדה' }, address: { city: 'Tel Aviv Yafo', city_multilingual: { HE: 'תל אביב יפו' } } }, agency: { name: { HE: 'אגד' } }, headsign: { HE: 'תל אביב יפו_מסוף רדינג' } } } })],
    },
  };
}
