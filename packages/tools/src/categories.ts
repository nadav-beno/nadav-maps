import { lightKey, makeIndex, normalizeQuery, overtureCategory, searchIndex, type NameIndex, type Place } from '@nm/core';

/** Category search ("cafes near here"). Shared by the web chips and the MCP tool. */
export interface Category {
  id: string;
  label: string;
  /** Material Symbols icon name. */
  icon: string;
  /** Overpass tag filters, OR-ed together. */
  filters: string[];
}

export const CATEGORIES: Category[] = [
  { id: 'restaurant', label: 'מסעדות', icon: 'restaurant', filters: ['["amenity"="restaurant"]', '["amenity"="fast_food"]'] },
  { id: 'cafe', label: 'בתי קפה', icon: 'local_cafe', filters: ['["amenity"="cafe"]'] },
  { id: 'supermarket', label: 'סופרמרקט', icon: 'grocery', filters: ['["shop"="supermarket"]', '["shop"="convenience"]'] },
  { id: 'fuel', label: 'תחנות דלק', icon: 'local_gas_station', filters: ['["amenity"="fuel"]'] },
  { id: 'charging', label: 'טעינה לרכב', icon: 'ev_station', filters: ['["amenity"="charging_station"]'] },
  { id: 'pharmacy', label: 'בתי מרקחת', icon: 'local_pharmacy', filters: ['["amenity"="pharmacy"]'] },
  { id: 'atm', label: 'כספומט', icon: 'local_atm', filters: ['["amenity"="atm"]', '["amenity"="bank"]["atm"="yes"]'] },
  { id: 'parking', label: 'חניונים', icon: 'local_parking', filters: ['["amenity"="parking"]'] },
  { id: 'hotel', label: 'מלונות', icon: 'hotel', filters: ['["tourism"="hotel"]', '["tourism"="guest_house"]', '["tourism"="hostel"]'] },
  { id: 'attraction', label: 'אטרקציות', icon: 'attractions', filters: ['["tourism"="attraction"]', '["tourism"="museum"]', '["tourism"="viewpoint"]'] },
  { id: 'park', label: 'פארקים', icon: 'park', filters: ['["leisure"="park"]'] },
  { id: 'hospital', label: 'בתי חולים', icon: 'local_hospital', filters: ['["amenity"="hospital"]', '["amenity"="clinic"]'] },
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
  if (c.key === 'overture') return overtureCategory(c.value).label;
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

/** Words people type for each category (Hebrew and English, singular and plural). */
const CATEGORY_WORDS: Record<string, string[]> = {
  restaurant: ['מסעדה', 'מסעדות', 'אוכל', 'מזון מהיר', 'פיצה', 'פיצריה', 'פיצריות', 'המבורגר', 'סושי', 'שווארמה', 'פלאפל', 'חומוס', 'restaurant', 'restaurants', 'food', 'pizza', 'burger', 'sushi', 'falafel', 'hummus'],
  cafe: ['קפה', 'בית קפה', 'בתי קפה', 'cafe', 'cafes', 'coffee', 'coffee shop'],
  supermarket: ['סופר', 'סופרמרקט', 'סופרמרקטים', 'מכולת', 'מכולות', 'supermarket', 'supermarkets', 'grocery', 'groceries'],
  fuel: ['דלק', 'תחנת דלק', 'תחנות דלק', 'gas', 'gas station', 'fuel', 'petrol'],
  charging: ['טעינה', 'עמדת טעינה', 'עמדות טעינה', 'טעינה לרכב', 'charging', 'charging station', 'ev charging'],
  pharmacy: ['בית מרקחת', 'בתי מרקחת', 'מרקחת', 'pharmacy', 'pharmacies', 'drugstore'],
  atm: ['כספומט', 'כספומטים', 'בנק', 'בנקים', 'atm', 'atms', 'bank', 'cash'],
  parking: ['חניה', 'חנייה', 'חניון', 'חניונים', 'parking', 'car park', 'parking lot'],
  hotel: ['מלון', 'מלונות', 'בית מלון', 'בתי מלון', 'אכסניה', 'הוסטל', 'צימר', 'hotel', 'hotels', 'hostel', 'lodging'],
  attraction: ['אטרקציה', 'אטרקציות', 'מוזיאון', 'מוזיאונים', 'תצפית', 'attraction', 'attractions', 'museum', 'museums', 'things to do'],
  park: ['פארק', 'פארקים', 'גן ציבורי', 'גינה', 'park', 'parks'],
  hospital: ['בית חולים', 'בתי חולים', 'מרפאה', 'מרפאות', 'קופת חולים', 'hospital', 'hospitals', 'clinic'],
};

/** Place words that start with ב themselves (used when no name dictionary is at hand). */
const B_WORDS = new Set(['בית', 'בני', 'באר', 'בת', 'בנימינה', 'בקעה', 'בבלי', 'בלפור', 'בר', 'בורסה', 'בניאס', 'ביתר', 'בוגרשוב', 'בגין', 'בלומפילד', 'ברזילי', 'בילינסון']);

/** "near", "in", ... between the category and the place, longest first. "ל" may be glued to the place. */
const CONNECTORS = ['בסביבה של', 'בסביבת', 'קרוב ל', 'סמוך ל', 'קרוב', 'ליד', 'באזור', 'close to', 'nearby', 'near', 'around', 'in', 'at', 'by'];

let categoryIndex: NameIndex | null = null;
function categoryWords(): NameIndex {
  categoryIndex ??= makeIndex(Object.entries(CATEGORY_WORDS).flatMap(([id, words]) => words.map((n) => ({ n, k: id }))));
  return categoryIndex;
}

/** The category a phrase names ("מסעדות", "מסעדוט", "pizza"), typos allowed. */
export function categoryFromText(text: string): Category | undefined {
  const t = text.trim();
  const len = lightKey(t).replace(/ /g, '').length;
  if (len < 2) return undefined;
  const m = searchIndex(categoryWords(), t, { limit: 1, prefix: false, minScore: len <= 4 ? 0.9 : 0.8 })[0];
  return m ? categoryById(m.entry.k!) : undefined;
}

export interface CategoryQuery {
  category: Category;
  /** The place to search around, as typed ("דיזנגוף סנטר"). */
  anchor: string;
}

/**
 * "<category> (ליד|קרוב ל|ב|באזור|near|in) <place>": "מסעדות ליד דיזנגוף סנטר",
 * "קפה בפלורנטין", "חניה קרוב לעזריאלי", "pizza near azrieli". Null for anything else.
 */
export function parseCategoryQuery(input: string, isName: (word: string) => boolean = (w) => B_WORDS.has(w)): CategoryQuery | null {
  const words = normalizeQuery(input).replace(/[,?!]/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  if (words.length < 2) return null;
  const lower = words.map((w) => w.toLowerCase());
  const tryAt = (i: number, rest: string[]): CategoryQuery | null => {
    if (!rest.length || !rest.join('')) return null;
    const category = categoryFromText(words.slice(0, i).join(' '));
    return category ? { category, anchor: rest.join(' ') } : null;
  };
  // An explicit connector: "מסעדות ליד X", "קרוב לX", "near X".
  for (let i = 1; i < words.length; i++) {
    for (const c of CONNECTORS) {
      const cw = c.split(' ');
      let found: CategoryQuery | null = null;
      if (lower.slice(i, i + cw.length).join(' ') === c) found = tryAt(i, words.slice(i + cw.length));
      else if (cw.at(-1) === 'ל') {
        const head = cw.slice(0, -1);
        const glued = words[i + head.length];
        if (lower.slice(i, i + head.length).join(' ') === head.join(' ') && glued?.startsWith('ל') && glued.length > 2) {
          found = tryAt(i, [glued.slice(1), ...words.slice(i + head.length + 1)]);
        }
      }
      if (found) return found;
    }
  }
  // A glued "ב" on the place: "קפה בפלורנטין".
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (!/^ב[א-ת]{2,}/.test(w)) continue;
    // A place word that itself starts with ב ("מסעדות בית שמש") keeps it.
    const found = tryAt(i, isName(w) ? words.slice(i) : [w.slice(1), ...words.slice(i + 1)]);
    if (found) return found;
  }
  return null;
}

