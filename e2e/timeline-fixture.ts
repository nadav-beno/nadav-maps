/**
 * A small Google Takeout "Semantic Location History" month file: one day (Monday
 * 4 March 2019, Israel time = UTC+2) in Tel Aviv and Jerusalem.
 */
const e7 = (lng: number, lat: number) => ({ latitudeE7: Math.round(lat * 1e7), longitudeE7: Math.round(lng * 1e7) });
const at = (h: number, m: number) => new Date(Date.UTC(2019, 2, 4, h, m)).toISOString();

const HOME: [number, number] = [34.7741, 32.0787];
const CAFE: [number, number] = [34.7745, 32.0805];
const MALL: [number, number] = [34.7918, 32.0745];
const MARKET: [number, number] = [35.2122, 31.7848];

const visit = (p: [number, number], name: string, address: string, from: [number, number], to: [number, number], semanticType?: string) => ({
  placeVisit: {
    location: { ...e7(...p), name, address, placeId: `fixture-${name}`, ...(semanticType ? { semanticType } : {}) },
    duration: { startTimestamp: at(...from), endTimestamp: at(...to) },
  },
});
const activity = (a: [number, number], b: [number, number], type: string, distance: number, from: [number, number], to: [number, number], via: [number, number][] = []) => ({
  activitySegment: {
    startLocation: e7(...a),
    endLocation: e7(...b),
    duration: { startTimestamp: at(...from), endTimestamp: at(...to) },
    distance,
    activityType: type,
    waypointPath: { waypoints: via.map(([lng, lat]) => ({ latE7: Math.round(lat * 1e7), lngE7: Math.round(lng * 1e7) })) },
  },
});

export const TAKEOUT_DAY = '2019-03-04';
export const TAKEOUT_FIXTURE = {
  timelineObjects: [
    visit(HOME, 'בית', 'דיזנגוף 100, תל אביב', [5, 0], [6, 40], 'TYPE_HOME'),
    activity(HOME, CAFE, 'WALKING', 650, [6, 40], [6, 55], [[34.7752, 32.0796]]),
    visit(CAFE, 'קפה לנדוור', 'דיזנגוף 150, תל אביב', [6, 55], [7, 35]),
    activity(CAFE, MALL, 'IN_PASSENGER_VEHICLE', 2600, [7, 35], [7, 55], [[34.779, 32.078], [34.785, 32.0765]]),
    visit(MALL, 'קניון עזריאלי', 'דרך מנחם בגין 132, תל אביב', [7, 55], [10, 30]),
    activity(MALL, MARKET, 'IN_TRAIN', 61000, [10, 30], [11, 30], [[34.95, 31.9], [35.1, 31.8]]),
    visit(MARKET, 'מחנה יהודה', 'ירושלים', [11, 30], [13, 0]),
  ],
};
