import type { ExpressionSpecification } from 'maplibre-gl';

/**
 * Place-of-interest categories, coloured the way people already read Google Maps:
 * orange food, blue shops, pink hotels, red health, green outdoors, teal sights.
 * Keys of `classes` are OpenMapTiles `poi.class` values; values are Maki icon names.
 */
export interface PoiGroup {
  /** [light, dark] */
  color: [string, string];
  classes: Record<string, string>;
}

export const POI_GROUPS = {
  food: {
    color: ['#e8710a', '#f6a35c'],
    classes: { restaurant: 'restaurant', fast_food: 'fast-food', cafe: 'cafe', bar: 'bar', beer: 'beer', ice_cream: 'ice-cream', bakery: 'bakery' },
  },
  shop: {
    color: ['#1a73e8', '#78a9f5'],
    classes: {
      shop: 'shop', grocery: 'grocery', clothing_store: 'clothing-store', alcohol_shop: 'alcohol-shop', jewelry: 'jewelry-store',
      shoe: 'shoe', furniture: 'furniture', florist: 'florist', hairdresser: 'hairdresser', laundry: 'laundry',
    },
  },
  lodging: { color: ['#d01884', '#f07cbf'], classes: { lodging: 'lodging' } },
  health: {
    color: ['#d93025', '#f28b82'],
    classes: { hospital: 'hospital', doctors: 'doctor', pharmacy: 'pharmacy', dentist: 'dentist', veterinary: 'veterinary' },
  },
  civic: {
    color: ['#795548', '#c2a493'],
    classes: { school: 'school', college: 'college', library: 'library', town_hall: 'town-hall', police: 'police', fire_station: 'fire-station', post: 'post' },
  },
  money: { color: ['#4e5fbf', '#9aa6ec'], classes: { bank: 'bank' } },
  transport: {
    color: ['#2a6fdb', '#7fa8ef'],
    classes: { fuel: 'fuel', parking: 'parking', bicycle: 'bicycle', car: 'car', bus: 'bus', railway: 'rail', harbor: 'harbor', ferry_terminal: 'ferry', airport: 'airport' },
  },
  sights: {
    color: ['#0b8a83', '#5ccbc3'],
    classes: {
      attraction: 'attraction', museum: 'museum', art_gallery: 'art-gallery', theatre: 'theatre', cinema: 'cinema', music: 'music',
      castle: 'castle', monument: 'monument', information: 'information',
    },
  },
  outdoor: {
    color: ['#188038', '#6fcf8b'],
    classes: {
      park: 'park', garden: 'garden', playground: 'playground', campsite: 'campsite', zoo: 'zoo', stadium: 'stadium',
      swimming: 'swimming', golf: 'golf',
    },
  },
  worship: { color: ['#5f6f7a', '#a8b6bf'], classes: { place_of_worship: 'place-of-worship', cemetery: 'cemetery' } },
} satisfies Record<string, PoiGroup>;

type GroupId = keyof typeof POI_GROUPS;
const GROUP_IDS = Object.keys(POI_GROUPS) as GroupId[];

/** Religion-specific icons for places of worship. */
const RELIGION: Record<string, string> = { jewish: 'religious-jewish', christian: 'religious-christian', muslim: 'religious-muslim' };

/** Image id for a POI class, e.g. "nm-poi-restaurant". Unknown classes get a dot in their colour (or grey). */
export function poiIconExpression(): ExpressionSpecification {
  const pairs: unknown[] = [];
  for (const g of GROUP_IDS) for (const cls of Object.keys(POI_GROUPS[g].classes)) pairs.push(cls, `nm-poi-${cls}`);
  return [
    'case',
    ['all', ['==', ['get', 'class'], 'place_of_worship'], ['has', 'subclass'], ['in', ['get', 'subclass'], ['literal', Object.keys(RELIGION)]]],
    ['concat', 'nm-poi-worship-', ['get', 'subclass']],
    ['match', ['get', 'class'], ...pairs, 'nm-poi-other'],
  ] as unknown as ExpressionSpecification;
}

export function poiColorExpression(theme: 'light' | 'dark'): ExpressionSpecification {
  const i = theme === 'dark' ? 1 : 0;
  const pairs: unknown[] = [];
  for (const g of GROUP_IDS) pairs.push(Object.keys(POI_GROUPS[g].classes), POI_GROUPS[g].color[i]);
  return ['match', ['get', 'class'], ...pairs, theme === 'dark' ? '#a0a7b0' : '#6b7178'] as unknown as ExpressionSpecification;
}

/** Every image the base map style refers to: id -> [maki icon or null, colour]. */
export function poiImageList(theme: 'light' | 'dark'): { id: string; icon: string | null; color: string }[] {
  const i = theme === 'dark' ? 1 : 0;
  const out: { id: string; icon: string | null; color: string }[] = [];
  for (const g of GROUP_IDS) {
    const grp: PoiGroup = POI_GROUPS[g];
    for (const [cls, icon] of Object.entries(grp.classes)) out.push({ id: `nm-poi-${cls}`, icon, color: grp.color[i] });
  }
  for (const [rel, icon] of Object.entries(RELIGION)) out.push({ id: `nm-poi-worship-${rel}`, icon, color: POI_GROUPS.worship.color[i] });
  out.push({ id: 'nm-poi-other', icon: null, color: theme === 'dark' ? '#8a929b' : '#7d848c' });
  return out;
}
