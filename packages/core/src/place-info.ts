/**
 * What a place card can say about a business from OpenStreetMap tags (and Overture
 * categories): Google's "service options" line, the "about" attributes (accessibility,
 * amenities, food, payments...), the kosher badge, and which places count as "similar".
 * Pure functions, so the wording is unit-tested.
 */
import { OVERTURE_CATEGORIES } from './overture.ts';

type Tags = Record<string, string | undefined>;
type Category = { key: string; value: string } | undefined;

export interface InfoItem {
  label: string;
  /** false: the place says it does not offer this ("אין משלוחים"). */
  ok: boolean;
  /** Set on facts the card also shows elsewhere (wheelchair access has its own overview row). */
  key?: string;
}

const YES = new Set(['yes', 'only', 'designated', 'limited', 'recommended', 'required']);
const isYes = (v?: string) => !!v && YES.has(v.split(';')[0].trim());
const isNo = (v?: string) => v === 'no';

/** OSM amenity values where eating in is the point of the place. */
const EAT_IN = new Set(['restaurant', 'cafe', 'fast_food', 'food_court', 'pub', 'bar', 'ice_cream', 'biergarten']);
/** Overture categories where you can sit down to eat or drink. */
const OVERTURE_EAT_IN = new Set([
  'restaurant', 'casual_eatery', 'fast_food_restaurant', 'coffee_shop', 'cafe', 'bar', 'pub', 'lounge',
  'dessert_shop', 'ice_cream_shop', 'smoothie_juice_bar', 'non_alcoholic_beverage_venue', 'alcoholic_beverage_venue',
]);

export function isFoodPlace(tags: Tags, category?: Category): boolean {
  if (tags.amenity && EAT_IN.has(tags.amenity)) return true;
  if (category?.key === 'amenity' && EAT_IN.has(category.value)) return true;
  return category?.key === 'overture' && OVERTURE_EAT_IN.has(category.value);
}

/**
 * Google's "לאכול במקום · איסוף עצמי · משלוחים" line, in Google's order: dine-in, takeaway,
 * delivery, drive-through, outdoor seating, reservations. Only what the data says, except
 * dine-in, which restaurants and cafés offer unless they are takeaway-only.
 */
export function serviceOptions(tags: Tags, category?: Category): InfoItem[] {
  const out: InfoItem[] = [];
  const food = isFoodPlace(tags, category);
  const takeawayOnly = tags.takeaway === 'only' || tags.delivery === 'only';
  if (tags.dine_in === 'no' || takeawayOnly) {
    if (food) out.push({ label: 'אין ישיבה במקום', ok: false });
  } else if (isYes(tags.dine_in) || (food && tags.indoor_seating !== 'no')) out.push({ label: 'לאכול במקום', ok: true });
  if (isYes(tags.takeaway)) out.push({ label: 'איסוף עצמי', ok: true });
  else if (isNo(tags.takeaway)) out.push({ label: 'אין איסוף עצמי', ok: false });
  if (isYes(tags.delivery)) out.push({ label: 'משלוחים', ok: true });
  else if (isNo(tags.delivery)) out.push({ label: 'אין משלוחים', ok: false });
  if (isYes(tags.drive_through)) out.push({ label: 'דרייב-אין', ok: true });
  if (isYes(tags.outdoor_seating)) out.push({ label: 'ישיבה בחוץ', ok: true });
  if (tags.reservation === 'required') out.push({ label: 'חובה להזמין מקום', ok: true });
  else if (tags.reservation === 'recommended') out.push({ label: 'מומלץ להזמין מקום', ok: true });
  else if (tags.reservation === 'yes') out.push({ label: 'אפשר להזמין מקום', ok: true });
  else if (tags.reservation === 'no') out.push({ label: 'אין הזמנת מקומות', ok: false });
  return out;
}

/** "כשר", "כשר חלבי", "כשר למהדרין"... from diet:kosher / kosher=*, or null. */
export function kosherBadge(tags: Tags): string | null {
  const v = (tags['diet:kosher'] ?? tags.kosher)?.split(';')[0].trim();
  if (!v || v === 'no') return null;
  const kind: Record<string, string> = { meat: 'כשר בשרי', dairy: 'כשר חלבי', parve: 'כשר פרווה', pareve: 'כשר פרווה' };
  if (kind[v]) return kind[v];
  if (v === 'mehadrin' || /mehadrin|מהדרין/i.test(tags['kosher:certification'] ?? tags['diet:kosher:certification'] ?? '')) return 'כשר למהדרין';
  if (v === 'yes' || v === 'only' || v === 'certified') return 'כשר';
  return null;
}

export interface InfoGroup {
  title: string;
  items: InfoItem[];
}

const PAYMENTS: [tag: string, label: string][] = [
  ['cash', 'מזומן'],
  ['credit_cards', 'כרטיסי אשראי'],
  ['debit_cards', 'כרטיסי חיוב'],
  ['contactless', 'תשלום ללא מגע (NFC)'],
  ['apple_pay', 'Apple Pay'],
  ['google_pay', 'Google Pay'],
  ['bit', 'ביט'],
  ['paybox', 'פייבוקס'],
  ['pango', 'פנגו'],
  ['cellopark', 'סלופארק'],
  ['rav_kav', 'רב-קו'],
];

/** Google's "מידע כללי" tab: groups of yes/no facts, each group only when the data has something. */
export function placeAttributes(tags: Tags): InfoGroup[] {
  const groups: InfoGroup[] = [];
  const add = (title: string, items: (InfoItem | null | false | undefined)[]) => {
    const list = items.filter((x): x is InfoItem => !!x);
    if (list.length) groups.push({ title, items: list });
  };

  const wc = tags.wheelchair;
  add('נגישות', [
    wc === 'yes' || wc === 'designated' ? { label: 'כניסה נגישה לכיסאות גלגלים', ok: true, key: 'wheelchair' } : null,
    wc === 'limited' ? { label: 'נגישות חלקית לכיסאות גלגלים', ok: true, key: 'wheelchair' } : null,
    wc === 'no' ? { label: 'אין כניסה נגישה לכיסאות גלגלים', ok: false, key: 'wheelchair' } : null,
    isYes(tags['toilets:wheelchair']) ? { label: 'שירותים נגישים', ok: true } : isNo(tags['toilets:wheelchair']) ? { label: 'אין שירותים נגישים', ok: false } : null,
    isYes(tags['parking:wheelchair']) || isYes(tags['capacity:disabled']) ? { label: 'חניית נכים', ok: true } : null,
    isYes(tags.hearing_loop) ? { label: 'לולאת השראה', ok: true } : null,
  ]);

  const net = tags.internet_access;
  add('שירותים במקום', [
    isYes(tags.toilets) ? { label: 'שירותים', ok: true } : isNo(tags.toilets) ? { label: 'אין שירותים', ok: false } : null,
    net && net !== 'no' && net !== 'terminal'
      ? { label: tags['internet_access:fee'] === 'no' ? 'Wi-Fi חינם' : 'Wi-Fi', ok: true }
      : net === 'no' ? { label: 'אין Wi-Fi', ok: false } : null,
    isYes(tags.air_conditioning) ? { label: 'מיזוג אוויר', ok: true } : null,
    isYes(tags.changing_table) ? { label: 'שולחן החתלה', ok: true } : null,
    isYes(tags.highchair) ? { label: 'כיסאות לתינוקות', ok: true } : null,
  ]);

  const kosher = kosherBadge(tags);
  const veg = tags['diet:vegetarian'];
  const vegan = tags['diet:vegan'];
  add('תזונה', [
    kosher ? { label: kosher, ok: true } : tags['diet:kosher'] === 'no' || tags.kosher === 'no' ? { label: 'לא כשר', ok: false } : null,
    veg === 'only' ? { label: 'צמחוני בלבד', ok: true } : isYes(veg) ? { label: 'מנות צמחוניות', ok: true } : null,
    vegan === 'only' ? { label: 'טבעוני בלבד', ok: true } : isYes(vegan) ? { label: 'מנות טבעוניות', ok: true } : null,
    isYes(tags['diet:gluten_free']) ? { label: 'מנות ללא גלוטן', ok: true } : null,
    isYes(tags['diet:halal']) ? { label: 'חלאל', ok: true } : null,
  ]);

  const smoking: Record<string, InfoItem> = {
    no: { label: 'העישון אסור', ok: false },
    yes: { label: 'מותר לעשן', ok: true },
    outside: { label: 'עישון בחוץ בלבד', ok: true },
    separated: { label: 'אזור עישון נפרד', ok: true },
    isolated: { label: 'חדר עישון', ok: true },
    dedicated: { label: 'מקום לעישון', ok: true },
  };
  const dogs = tags.dog ?? tags.dogs;
  add('אווירה', [
    tags.smoking ? smoking[tags.smoking] : null,
    dogs === 'yes' || dogs === 'leashed' ? { label: dogs === 'leashed' ? 'מותר להכניס כלבים ברצועה' : 'מותר להכניס כלבים', ok: true } : dogs === 'no' ? { label: 'אסור להכניס כלבים', ok: false } : null,
  ]);

  add(
    'תשלום',
    PAYMENTS.map(([k, label]) => {
      const v = tags[`payment:${k}`];
      if (isYes(v)) return { label, ok: true };
      if (isNo(v) && (k === 'cash' || k === 'credit_cards')) return { label: k === 'cash' ? 'לא מקבלים מזומן' : 'לא מקבלים כרטיסי אשראי', ok: false };
      return null;
    }),
  );
  return groups;
}

/**
 * Families of Overture categories that count as "the same kind of place" for "אנשים מחפשים גם".
 * A restaurant suggests restaurants, a café cafés, a hotel other places to stay.
 */
const FAMILIES: string[][] = [
  ['restaurant', 'casual_eatery', 'food_service', 'food_and_drink'],
  ['fast_food_restaurant', 'food_truck_stand'],
  ['coffee_shop', 'cafe', 'bakery'],
  ['dessert_shop', 'ice_cream_shop', 'smoothie_juice_bar'],
  ['bar', 'pub', 'lounge', 'alcoholic_beverage_venue', 'dance_club'],
  ['hotel', 'lodging', 'resort', 'bed_and_breakfast', 'hostel', 'motel', 'private_lodging'],
  ['grocery_store', 'supermarket', 'convenience_store', 'food_and_beverage_store'],
  ['pharmacy_and_drug_store'],
  ['gym', 'fitness_studio'],
  ['hair_salon', 'personal_or_beauty_service'],
  ['museum', 'art_gallery', 'cultural_center', 'historic_site'],
  ['bank_or_credit_union', 'atm'],
  ['gas_station'],
  ['parking'],
];

/** OSM tag value -> the Overture category it corresponds to. */
const OSM_TO_OVERTURE: Record<string, string> = {
  'amenity=restaurant': 'restaurant',
  'amenity=fast_food': 'fast_food_restaurant',
  'amenity=cafe': 'coffee_shop',
  'shop=bakery': 'bakery',
  'amenity=ice_cream': 'ice_cream_shop',
  'amenity=bar': 'bar',
  'amenity=pub': 'pub',
  'tourism=hotel': 'hotel',
  'tourism=guest_house': 'bed_and_breakfast',
  'tourism=hostel': 'hostel',
  'tourism=motel': 'motel',
  'shop=supermarket': 'supermarket',
  'shop=convenience': 'convenience_store',
  'amenity=pharmacy': 'pharmacy_and_drug_store',
  'leisure=fitness_centre': 'gym',
  'shop=hairdresser': 'hair_salon',
  'tourism=museum': 'museum',
  'tourism=gallery': 'art_gallery',
  'amenity=bank': 'bank_or_credit_union',
  'amenity=fuel': 'gas_station',
  'amenity=parking': 'parking',
  'shop=clothes': 'fashion_and_apparel_store',
  'shop=shoes': 'shoe_store',
  'shop=books': 'books_music_and_video_store',
};

/** The Overture categories to look for when suggesting places like this one (empty: don't). */
export function similarCategories(category?: Category): string[] {
  if (!category) return [];
  const ovt = category.key === 'overture' ? category.value : OSM_TO_OVERTURE[`${category.key}=${category.value}`];
  if (!ovt) return [];
  const family = FAMILIES.find((f) => f.includes(ovt));
  if (family) return family;
  return OVERTURE_CATEGORIES[ovt] ? [ovt] : [];
}

/** Our category-search id ("restaurant", "cafe"...) for a place, to fill up suggestions from OSM. */
export function nearbySearchCategory(category?: Category): string | null {
  const f = similarCategories(category);
  if (f.includes('restaurant') || f.includes('fast_food_restaurant')) return 'restaurant';
  if (f.includes('coffee_shop')) return 'cafe';
  if (f.includes('hotel')) return 'hotel';
  if (f.includes('supermarket')) return 'supermarket';
  if (f.includes('pharmacy_and_drug_store')) return 'pharmacy';
  if (f.includes('gas_station')) return 'fuel';
  if (f.includes('parking')) return 'parking';
  return null;
}

/** Links Google shows as rows of their own: menu and reservations. */
export function placeLinks(tags: Tags): { menu?: string; reservation?: string; description?: string } {
  const http = (v?: string) => (v && /^https?:\/\//.test(v) ? v : undefined);
  return {
    menu: http(tags['website:menu'] ?? tags['menu:url'] ?? tags['contact:menu']),
    reservation: http(tags['reservation:website'] ?? tags['website:booking'] ?? tags['booking:website'] ?? tags['reservation:url']),
    description: tags['description:he'] ?? tags.description,
  };
}

const CUISINES: Record<string, string> = {
  mediterranean: 'ים-תיכוני', italian: 'איטלקי', pizza: 'פיצה', burger: 'המבורגר', sushi: 'סושי', japanese: 'יפני',
  chinese: 'סיני', thai: 'תאילנדי', asian: 'אסייתי', indian: 'הודי', mexican: 'מקסיקני', french: 'צרפתי',
  american: 'אמריקאי', middle_eastern: 'מזרח תיכוני', israeli: 'ישראלי', falafel: 'פלאפל', shawarma: 'שווארמה',
  hummus: 'חומוס', kebab: 'קבב', sandwich: 'כריכים', seafood: 'פירות ים', fish: 'דגים', steak_house: 'בשרים',
  grill: 'גריל', meat: 'בשרים', bagel: 'בייגל', breakfast: 'ארוחות בוקר', coffee_shop: 'בית קפה', ice_cream: 'גלידה',
  vegetarian: 'צמחוני', vegan: 'טבעוני', georgian: 'גאורגי', yemeni: 'תימני', moroccan: 'מרוקאי', ethiopian: 'אתיופי',
  greek: 'יווני', turkish: 'טורקי', lebanese: 'לבנוני', arab: 'ערבי', vietnamese: 'וייטנאמי', korean: 'קוריאני',
  spanish: 'ספרדי', bakery: 'מאפה', dessert: 'קינוחים', chicken: 'עוף', noodle: 'נודלס', ramen: 'ראמן', salad: 'סלטים',
  juice: 'מיצים', pasta: 'פסטה', tapas: 'טאפאס', international: 'בינלאומי', regional: 'מקומי', fusion: 'פיוז׳ן',
};

/** The first cuisine of `cuisine=*` in Hebrew ("mediterranean;fish" -> "ים-תיכוני"), or null when unknown. */
export function cuisineLabel(cuisine?: string): string | null {
  const v = cuisine?.split(';')[0].trim().toLowerCase();
  return (v && CUISINES[v]) || null;
}
