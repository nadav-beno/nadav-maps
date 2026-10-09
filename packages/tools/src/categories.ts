import type { Place } from '@nm/core';

/** Category search ("cafes near here"). Shared by the web chips and the MCP tool. */
export interface Category {
  id: string;
  label: string;
  icon: string;
  /** Overpass tag filters, OR-ed together. */
  filters: string[];
}

export const CATEGORIES: Category[] = [
  { id: 'restaurant', label: 'מסעדות', icon: '🍽️', filters: ['["amenity"="restaurant"]', '["amenity"="fast_food"]'] },
  { id: 'cafe', label: 'בתי קפה', icon: '☕', filters: ['["amenity"="cafe"]'] },
  { id: 'supermarket', label: 'סופרמרקט', icon: '🛒', filters: ['["shop"="supermarket"]', '["shop"="convenience"]'] },
  { id: 'fuel', label: 'תחנות דלק', icon: '⛽', filters: ['["amenity"="fuel"]'] },
  { id: 'charging', label: 'טעינה לרכב', icon: '🔌', filters: ['["amenity"="charging_station"]'] },
  { id: 'pharmacy', label: 'בתי מרקחת', icon: '💊', filters: ['["amenity"="pharmacy"]'] },
  { id: 'atm', label: 'כספומט', icon: '🏧', filters: ['["amenity"="atm"]', '["amenity"="bank"]["atm"="yes"]'] },
  { id: 'parking', label: 'חניונים', icon: '🅿️', filters: ['["amenity"="parking"]'] },
  { id: 'hotel', label: 'מלונות', icon: '🛏️', filters: ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="hostel"]'] },
  { id: 'attraction', label: 'אטרקציות', icon: '📸', filters: ['["tourism"="attraction"]', '["tourism"="museum"]', '["tourism"="viewpoint"]'] },
  { id: 'park', label: 'פארקים', icon: '🌳', filters: ['["leisure"="park"]'] },
  { id: 'hospital', label: 'בתי חולים', icon: '🏥', filters: ['["amenity"="hospital"]', '["amenity"="clinic"]'] },
];

export function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/** Hebrew label for an OSM key/value, for place cards and result lists. */
const LABELS: Record<string, string> = {
  'amenity=restaurant': 'מסעדה',
  'amenity=fast_food': 'מזון מהיר',
  'amenity=cafe': 'בית קפה',
  'amenity=bar': 'בר',
  'amenity=pub': 'פאב',
  'amenity=fuel': 'תחנת דלק',
  'amenity=charging_station': 'עמדת טעינה',
  'amenity=pharmacy': 'בית מרקחת',
  'amenity=atm': 'כספומט',
  'amenity=bank': 'בנק',
  'amenity=parking': 'חניון',
  'amenity=hospital': 'בית חולים',
  'amenity=clinic': 'מרפאה',
  'amenity=school': 'בית ספר',
  'amenity=university': 'אוניברסיטה',
  'amenity=place_of_worship': 'מקום תפילה',
  'amenity=post_office': 'סניף דואר',
  'amenity=police': 'משטרה',
  'amenity=library': 'ספרייה',
  'amenity=cinema': 'קולנוע',
  'amenity=theatre': 'תיאטרון',
  'shop=supermarket': 'סופרמרקט',
  'shop=convenience': 'מכולת',
  'shop=bakery': 'מאפייה',
  'shop=mall': 'קניון',
  'shop=clothes': 'חנות בגדים',
  'tourism=hotel': 'מלון',
  'tourism=hostel': 'אכסניה',
  'tourism=guest_house': 'צימר / בית הארחה',
  'tourism=museum': 'מוזיאון',
  'tourism=attraction': 'אטרקציה',
  'tourism=viewpoint': 'נקודת תצפית',
  'leisure=park': 'פארק',
  'leisure=playground': 'גן משחקים',
  'leisure=beach_resort': 'חוף',
  'natural=beach': 'חוף',
  'natural=peak': 'פסגה',
  'railway=station': 'תחנת רכבת',
  'highway=bus_stop': 'תחנת אוטובוס',
  'aeroway=aerodrome': 'שדה תעופה',
  'place=city': 'עיר',
  'place=town': 'עיר',
  'place=village': 'יישוב',
  'place=hamlet': 'יישוב',
  'place=suburb': 'שכונה',
  'place=neighbourhood': 'שכונה',
  'place=country': 'מדינה',
  'place=state': 'מחוז',
  'boundary=administrative': 'אזור',
  'building=yes': 'בניין',
  'place=house': 'כתובת',
};
const KEY_LABELS: Record<string, string> = {
  highway: 'רחוב',
  shop: 'חנות',
  tourism: 'תיירות',
  amenity: 'שירות',
  building: 'בניין',
  office: 'משרד',
  historic: 'אתר היסטורי',
  natural: 'טבע',
  leisure: 'פנאי',
};

export function categoryLabel(c?: { key: string; value: string }): string | undefined {
  if (!c) return undefined;
  return LABELS[`${c.key}=${c.value}`] ?? KEY_LABELS[c.key];
}

/** Emoji for a place, by its OSM category. */
export function placeIcon(p: Pick<Place, 'category'>): string {
  const v = p.category?.value ?? '';
  const k = p.category?.key ?? '';
  const byValue: Record<string, string> = {
    restaurant: '🍽️', fast_food: '🍔', cafe: '☕', bar: '🍸', pub: '🍺', fuel: '⛽', charging_station: '🔌',
    pharmacy: '💊', hospital: '🏥', clinic: '🩺', atm: '🏧', bank: '🏦', parking: '🅿️', supermarket: '🛒',
    convenience: '🛒', hotel: '🛏️', hostel: '🛏️', guest_house: '🛏️', museum: '🏛️', park: '🌳', school: '🏫',
    university: '🎓', station: '🚉', bus_stop: '🚏', aerodrome: '✈️', beach: '🏖️', peak: '⛰️', viewpoint: '📸',
    attraction: '📸', place_of_worship: '🕍', city: '🏙️', town: '🏙️', village: '🏘️',
  };
  if (byValue[v]) return byValue[v];
  if (k === 'highway') return '🛣️';
  if (k === 'shop') return '🛍️';
  if (k === 'place') return '📍';
  return '📍';
}

