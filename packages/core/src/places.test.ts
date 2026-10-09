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
