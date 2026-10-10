import { describe, expect, it } from 'vitest';
import { fromE7, googleMode, ownExport, parseLatLng, parseTime, parseTimelineExport } from './google.ts';
import type { Move, Stay } from './types.ts';

// Small hand-written fixtures in the shapes Google exports.
const DEVICE = {
  semanticSegments: [
    {
      startTime: '2024-05-01T07:10:00.000+03:00',
      endTime: '2024-05-01T08:30:00.000+03:00',
      startTimeTimezoneUtcOffsetMinutes: 180,
      visit: {
        hierarchyLevel: 0,
        probability: 0.93,
        topCandidate: { placeId: 'ChIJhome', semanticType: 'INFERRED_HOME', probability: 0.9, placeLocation: { latLng: '32.0853°, 34.7818°' } },
      },
    },
    {
      startTime: '2024-05-01T07:20:00.000+03:00',
      endTime: '2024-05-01T07:40:00.000+03:00',
      visit: { hierarchyLevel: 1, topCandidate: { placeId: 'ChIJnested', placeLocation: { latLng: '32.0854°, 34.7819°' } } },
    },
    {
      startTime: '2024-05-01T08:30:00.000+03:00',
      endTime: '2024-05-01T08:55:00.000+03:00',
      activity: {
        start: { latLng: '32.0853°, 34.7818°' },
        end: { latLng: '32.0745°, 34.7918°' },
        distanceMeters: 2100.5,
        topCandidate: { type: 'IN_PASSENGER_VEHICLE', probability: 0.8 },
      },
    },
    {
      startTime: '2024-05-01T08:00:00.000+03:00',
      endTime: '2024-05-01T10:00:00.000+03:00',
      timelinePath: [
        { point: '32.0800°, 34.7860°', time: '2024-05-01T08:40:00.000+03:00' },
        { point: '32.0770°, 34.7890°', time: '2024-05-01T08:47:00.000+03:00' },
      ],
    },
    {
      startTime: '2024-05-01T08:55:00.000+03:00',
      endTime: '2024-05-01T17:05:00.000+03:00',
      visit: { hierarchyLevel: 0, topCandidate: { placeId: 'ChIJwork', semanticType: 'UNKNOWN', placeLocation: { latLng: '32.0745°, 34.7918°' } } },
    },
  ],
  rawSignals: [
    { position: { LatLng: '32.0853°, 34.7818°', accuracyMeters: 12, altitudeMeters: 31, source: 'WIFI', timestamp: '2024-05-01T07:15:00.000+03:00', speedMetersPerSecond: 0 } },
    { wifiScan: { deliveryTime: '2024-05-01T07:16:00.000+03:00' } },
    { position: { LatLng: 'nonsense', timestamp: '2024-05-01T07:17:00.000+03:00' } },
  ],
  userLocationProfile: { frequentPlaces: [{ placeId: 'ChIJwork', placeLocation: '32.0745°, 34.7918°', label: 'WORK' }] },
};

const IOS = [
  {
    startTime: '2024-05-02T09:00:00.000+03:00',
    endTime: '2024-05-02T10:00:00.000+03:00',
    visit: { hierarchyLevel: '0', probability: '0.9', topCandidate: { placeID: 'ChIJcafe', semanticType: 'Unknown', probability: '0.7', placeLocation: 'geo:32.080100,34.779200' } },
  },
  {
    startTime: '2024-05-02T10:00:00.000+03:00',
    endTime: '2024-05-02T10:20:00.000+03:00',
    activity: { start: 'geo:32.080100,34.779200', end: 'geo:32.090000,34.780000', distanceMeters: '1150.0', topCandidate: { type: 'walking', probability: '0.9' } },
  },
  {
    startTime: '2024-05-02T10:00:00.000+03:00',
    endTime: '2024-05-02T12:00:00.000+03:00',
    timelinePath: [{ point: 'geo:32.085000,34.779600', durationMinutesOffsetFromStartTime: '10' }],
  },
];

const SEMANTIC = {
  timelineObjects: [
    {
      placeVisit: {
        location: { latitudeE7: 320853000, longitudeE7: 347818000, placeId: 'ChIJhome', address: 'דיזנגוף 1\nתל אביב', name: 'בית', semanticType: 'TYPE_HOME' },
        duration: { startTimestamp: '2019-03-04T05:00:00Z', endTimestamp: '2019-03-04T06:30:00Z' },
        placeConfidence: 'HIGH_CONFIDENCE',
      },
    },
    {
      activitySegment: {
        startLocation: { latitudeE7: 320853000, longitudeE7: 347818000 },
        endLocation: { latitudeE7: 317683000, longitudeE7: 352137000 },
        duration: { startTimestampMs: String(Date.UTC(2019, 2, 4, 6, 30)), endTimestampMs: String(Date.UTC(2019, 2, 4, 7, 45)) },
        distance: 61000,
        activityType: 'IN_TRAIN',
        simplifiedRawPath: { points: [{ latE7: 319000000, lngE7: 349500000, timestampMs: String(Date.UTC(2019, 2, 4, 7)) }] },
      },
    },
    {
      placeVisit: {
        location: { latitudeE7: 317683000, longitudeE7: 352137000, name: 'מחנה יהודה', address: 'ירושלים' },
        duration: { startTimestampMs: String(Date.UTC(2019, 2, 4, 7, 45)), endTimestampMs: String(Date.UTC(2019, 2, 4, 9)) },
      },
    },
    { placeVisit: { location: { name: 'no coordinates' }, duration: { startTimestamp: '2019-03-04T10:00:00Z', endTimestamp: '2019-03-04T11:00:00Z' } } },
  ],
};

const RECORDS = {
  locations: [
    { latitudeE7: 320853000, longitudeE7: 347818000, accuracy: 20, altitude: 40, velocity: 1, timestamp: '2015-06-01T10:00:00.000Z' },
    { latitudeE7: 320855000, longitudeE7: 347820000, accuracy: 15, timestampMs: '1433152860000' },
    // int32 overflow from old exports: 4294967296 - 1225000000 => -122.5
    { latitudeE7: 377749000, longitudeE7: 3069967296, accuracy: 10, timestamp: '2015-06-02T10:00:00Z' },
    { latitudeE7: 'x', longitudeE7: 1, timestamp: '2015-06-02T10:00:00Z' },
  ],
};

describe('coordinate and time helpers', () => {
  it('reads every coordinate spelling Google uses', () => {
    expect(parseLatLng('32.0853°, 34.7818°')).toEqual([34.7818, 32.0853]);
    expect(parseLatLng('geo:32.0853,34.7818')).toEqual([34.7818, 32.0853]);
    expect(parseLatLng('-33.5, -70.25')).toEqual([-70.25, -33.5]);
    expect(parseLatLng({ latitudeE7: 320853000, longitudeE7: 347818000 })).toEqual([34.7818, 32.0853]);
    expect(parseLatLng({ latLng: '1.5°, 2.5°' })).toEqual([2.5, 1.5]);
    expect(parseLatLng('0°, 0°')).toBeNull();
    expect(parseLatLng('95, 10')).toBeNull();
    expect(parseLatLng('hello')).toBeNull();
  });
  it('fixes overflowed E7 values', () => {
    expect(fromE7(3069967296)).toBeCloseTo(-122.5);
  });
  it('reads ISO and millisecond times', () => {
    expect(parseTime('2024-05-01T07:10:00.000+03:00')).toBe(Date.UTC(2024, 4, 1, 4, 10));
    expect(parseTime('1433152860000')).toBe(1433152860000);
    expect(parseTime('')).toBeUndefined();
  });
  it('maps activity names to modes', () => {
    expect(googleMode('IN_PASSENGER_VEHICLE')).toBe('car');
    expect(googleMode('in passenger vehicle')).toBe('car');
    expect(googleMode('MOTORCYCLING')).toBe('car');
    expect(googleMode('CYCLING')).toBe('bike');
    expect(googleMode('walking')).toBe('walk');
    expect(googleMode('IN_BUS')).toBe('bus');
    expect(googleMode('IN_SUBWAY')).toBe('train');
    expect(googleMode('FLYING')).toBe('flight');
    expect(googleMode('IN_FERRY')).toBe('boat');
    expect(googleMode('UNKNOWN_ACTIVITY_TYPE')).toBe('unknown');
  });
});

describe('on-device Timeline.json (Android)', () => {
  const r = parseTimelineExport(DEVICE);
  it('is detected', () => expect(r.kind).toBe('device'));
  it('reads top-level visits and skips nested ones', () => {
    const stays = r.segs.filter((s): s is Stay => s.kind === 'stay');
    expect(stays).toHaveLength(2);
    expect(stays[0]).toMatchObject({ lng: 34.7818, lat: 32.0853, semantic: 'home', source: 'google', start: Date.UTC(2024, 4, 1, 4, 10) });
    expect(stays[0].place?.googlePlaceId).toBe('ChIJhome');
    // Labelled WORK in the profile.
    expect(stays[1].semantic).toBe('work');
  });
  it('reads activities with their path samples', () => {
    const m = r.segs.find((s): s is Move => s.kind === 'move')!;
    expect(m.mode).toBe('car');
    expect(m.distanceM).toBeCloseTo(2100.5);
    expect(m.path).toEqual([
      [34.7818, 32.0853],
      [34.786, 32.08],
      [34.789, 32.077],
      [34.7918, 32.0745],
    ]);
  });
  it('reads raw positions, skipping other signals and bad coordinates', () => {
    expect(r.points).toEqual([{ t: Date.UTC(2024, 4, 1, 4, 15), lng: 34.7818, lat: 32.0853, acc: 12, alt: 31, speed: 0 }]);
  });
});

describe('on-device export (iPhone array)', () => {
  const r = parseTimelineExport(IOS);
  it('is detected and read', () => {
    expect(r.kind).toBe('ios');
    const [s, m] = r.segs as [Stay, Move];
    expect(s).toMatchObject({ kind: 'stay', lng: 34.7792, lat: 32.0801 });
    expect(s.place?.googlePlaceId).toBe('ChIJcafe');
    expect(m).toMatchObject({ kind: 'move', mode: 'walk', distanceM: 1150 });
    // Sample at start + 10 minutes lands inside the walk.
    expect(m.path).toHaveLength(3);
  });
});

describe('Takeout Semantic Location History', () => {
  const r = parseTimelineExport(SEMANTIC);
  it('reads place visits with names and activity segments', () => {
    expect(r.kind).toBe('semantic');
    expect(r.segs).toHaveLength(3);
    const [home, train, market] = r.segs as [Stay, Move, Stay];
    expect(home.place).toMatchObject({ name: 'בית', address: 'דיזנגוף 1, תל אביב', googlePlaceId: 'ChIJhome' });
    expect(home.semantic).toBe('home');
    expect(train).toMatchObject({ mode: 'train', distanceM: 61000, start: Date.UTC(2019, 2, 4, 6, 30), end: Date.UTC(2019, 2, 4, 7, 45) });
    expect(train.path).toHaveLength(3);
    expect(market.place?.name).toBe('מחנה יהודה');
  });
});

describe('Takeout Records.json', () => {
  const r = parseTimelineExport(RECORDS);
  it('reads raw locations with E7, ms timestamps and the overflow fix', () => {
    expect(r.kind).toBe('records');
    expect(r.points).toHaveLength(3);
    expect(r.points[0]).toEqual({ t: Date.UTC(2015, 5, 1, 10), lng: 34.7818, lat: 32.0853, acc: 20, alt: 40, speed: 1 });
    expect(r.points[1].t).toBe(1433152860000);
    expect(r.points[2].lng).toBeCloseTo(-122.5);
  });
});

describe('own format', () => {
  it('round-trips', () => {
    const file = ownExport(
      [{ t: 1, lng: 34.78, lat: 32.08, acc: 5 }],
      [{ kind: 'stay', id: 's:1', start: 1, end: 2, lng: 34.78, lat: 32.08, source: 'gps' }],
      [{ id: 's:1', place: { name: 'סבתא', lng: 34.78, lat: 32.08, source: 'edit' }, at: 3 }],
      0,
    );
    const r = parseTimelineExport(JSON.parse(JSON.stringify(file)));
    expect(r.kind).toBe('nadav');
    expect(r.points).toHaveLength(1);
    expect(r.segs).toHaveLength(1);
    expect(r.edits[0].place.name).toBe('סבתא');
  });
  it('unknown JSON reads as nothing', () => {
    expect(parseTimelineExport({ hello: 1 }).kind).toBe('unknown');
    expect(parseTimelineExport([1, 2]).kind).toBe('unknown');
    expect(parseTimelineExport(null).kind).toBe('unknown');
  });
});
