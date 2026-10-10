import { describe, expect, it } from 'vitest';
import { maneuverIcon } from './maneuver.ts';
import { overtureCategory, overturePlace } from './overture.ts';
import { placeVisual } from './place-visual.ts';
import { parsePlaceId } from './ids.ts';

describe('Overture places', () => {
  const props = {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    '@name': 'ביסטרו הכרמל',
    basic_category: 'restaurant',
    phones: JSON.stringify(['+97235236058']),
    websites: JSON.stringify(['https://bistro.example']),
    socials: JSON.stringify(['https://www.facebook.com/123']),
    emails: JSON.stringify(['hello@bistro.example']),
    addresses: JSON.stringify([{ freeform: 'בן יהודה 28', locality: 'תל אביב - יפו' }]),
  };

  it('turns tile properties into a place with contact details', () => {
    const p = overturePlace(props, 34.7792, 32.0801);
    expect(p).toMatchObject({
      id: 'ovt:aaaaaaaa-0000-4000-8000-000000000001',
      name: 'ביסטרו הכרמל',
      address: 'בן יהודה 28, תל אביב - יפו',
      category: { key: 'overture', value: 'restaurant' },
      contact: { phone: '+97235236058', website: 'https://bistro.example', email: 'hello@bistro.example', socials: ['https://www.facebook.com/123'] },
    });
    expect(parsePlaceId(p.id)).toMatchObject({ overture: props.id });
  });

  it('survives missing and broken fields', () => {
    const p = overturePlace({ id: 'x', brand: JSON.stringify({ names: { primary: 'Aroma' } }), phones: '{not json' }, 1, 2);
    expect(p.name).toBe('Aroma');
    expect(p.contact?.phone).toBeUndefined();
    expect(p.category).toBeUndefined();
  });

  it('knows its categories, with a fallback for new ones', () => {
    expect(overtureCategory('restaurant').group).toBe('food');
    expect(overtureCategory('some_new_category').group).toBeTruthy();
  });
});

describe('place visuals', () => {
  it('colours and icons places by category', () => {
    expect(placeVisual({ category: { key: 'amenity', value: 'cafe' } })).toEqual({ icon: 'local_cafe', group: 'food' });
    expect(placeVisual({ category: { key: 'overture', value: 'restaurant' } })).toEqual({ icon: 'restaurant', group: 'food' });
    expect(placeVisual({ category: { key: 'shop', value: 'something_rare' } })).toEqual({ icon: 'storefront', group: 'shop' });
    expect(placeVisual({}).group).toBe('address');
  });
});

describe('maneuver icons', () => {
  it('maps Valhalla turns to arrows', () => {
    expect(maneuverIcon(10)).toBe('turn_right');
    expect(maneuverIcon(15)).toBe('turn_left');
    expect(maneuverIcon(26)).toBe('roundabout_right');
    expect(maneuverIcon(4)).toBe('sports_score');
    expect(maneuverIcon(999)).toBe('arrow_upward');
  });
});

describe('elevation helpers', () => {
  it('samples a line evenly', async () => {
    const { sampleLine, lineLength } = await import('./geo.ts');
    const line: [number, number][] = [[34.78, 32.08], [34.79, 32.08], [34.79, 32.09]];
    const s = sampleLine(line, 5);
    expect(s).toHaveLength(5);
    expect(s[0].p).toEqual(line[0]);
    expect(s[4].p[0]).toBeCloseTo(34.79, 6);
    expect(s[4].p[1]).toBeCloseTo(32.09, 6);
    expect(s[4].d).toBeCloseTo(lineLength(line), 3);
  });
  it('sums climb and descent without jitter', async () => {
    const { climb } = await import('./geo.ts');
    expect(climb([10, 11, 10, 30, 29, 5])).toEqual({ up: 20, down: 25 });
  });
  it('decodes terrarium pixels and finds tiles', async () => {
    const { terrariumHeight, tilePixel } = await import('./geo.ts');
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    expect(terrariumHeight(128, 100, 128)).toBe(100.5);
    const t = tilePixel([0, 0], 1);
    expect(t).toMatchObject({ x: 1, y: 1, px: 0, py: 0 });
  });
});

describe('departure times', () => {
  it('reads like a transit app', async () => {
    const { formatDeparture, delayMinutes } = await import('./format.ts');
    const now = Date.parse('2026-10-10T08:00:00Z');
    expect(formatDeparture('2026-10-10T07:59:30Z', now)).toBe('עכשיו');
    expect(formatDeparture('2026-10-10T08:04:00Z', now)).toBe('בעוד 4 דק׳');
    expect(formatDeparture('2026-10-10T09:30:00Z', now, 'Asia/Jerusalem')).toBe('12:30');
    expect(delayMinutes('2026-10-10T08:05:00Z', '2026-10-10T08:02:00Z')).toBe(3);
  });
});
