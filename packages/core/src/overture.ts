/**
 * Overture Maps places (CDLA-Permissive-2.0): tens of millions of businesses with phone,
 * website and category, served as a public PMTiles archive. Here: how its categories map to
 * our map groups, map icons (Maki names) and Hebrew labels, and how to read a tile feature.
 */
import type { Place } from './types.ts';

/** Map style source id for Overture places; features use it to recognise taps on them. */
export const OVERTURE_SOURCE = 'overture';

/**
 * Colour groups shared by the base map and the UI. Same families Google Maps uses:
 * orange food, blue shops, pink hotels, red health, green outdoors, teal culture.
 */
export type PoiGroupId =
  | 'food' | 'shop' | 'lodging' | 'health' | 'civic' | 'money' | 'transport' | 'sights' | 'outdoor' | 'worship' | 'service';

type Row = [group: PoiGroupId, maki: string, label: string];

/** Overture `basic_category` -> group, Maki icon, Hebrew label. */
export const OVERTURE_CATEGORIES: Record<string, Row> = {
  restaurant: ['food', 'restaurant', 'מסעדה'],
  casual_eatery: ['food', 'restaurant', 'מסעדה'],
  fast_food_restaurant: ['food', 'fast-food', 'מזון מהיר'],
  food_truck_stand: ['food', 'fast-food', 'דוכן אוכל'],
  food_service: ['food', 'restaurant', 'שירותי הסעדה'],
  food_and_drink: ['food', 'restaurant', 'אוכל ושתייה'],
  coffee_shop: ['food', 'cafe', 'בית קפה'],
  cafe: ['food', 'cafe', 'בית קפה'],
  bakery: ['food', 'bakery', 'מאפייה'],
  dessert_shop: ['food', 'ice-cream', 'קינוחים'],
  ice_cream_shop: ['food', 'ice-cream', 'גלידרייה'],
  smoothie_juice_bar: ['food', 'cafe', 'בר מיצים'],
  non_alcoholic_beverage_venue: ['food', 'cafe', 'משקאות'],
  bar: ['food', 'bar', 'בר'],
  alcoholic_beverage_venue: ['food', 'bar', 'בר'],
  lounge: ['food', 'bar', 'לאונג׳'],
  pub: ['food', 'beer', 'פאב'],
  dance_club: ['food', 'nightclub', 'מועדון'],
  adult_entertainment_venue: ['food', 'nightclub', 'בידור למבוגרים'],

  hotel: ['lodging', 'lodging', 'מלון'],
  lodging: ['lodging', 'lodging', 'לינה'],
  private_lodging: ['lodging', 'lodging', 'דירת אירוח'],
  resort: ['lodging', 'lodging', 'אתר נופש'],
  bed_and_breakfast: ['lodging', 'lodging', 'צימר'],
  hostel: ['lodging', 'lodging', 'אכסניה'],
  motel: ['lodging', 'lodging', 'מוטל'],

  shopping: ['shop', 'shop', 'חנות'],
  specialty_store: ['shop', 'shop', 'חנות'],
  fashion_and_apparel_store: ['shop', 'clothing-store', 'אופנה'],
  shoe_store: ['shop', 'shoe', 'חנות נעליים'],
  jewelry_store: ['shop', 'jewelry-store', 'תכשיטים'],
  food_and_beverage_store: ['shop', 'grocery', 'מזון ומשקאות'],
  grocery_store: ['shop', 'grocery', 'מכולת'],
  supermarket: ['shop', 'grocery', 'סופרמרקט'],
  convenience_store: ['shop', 'convenience', 'מכולת'],
  farmers_market: ['shop', 'grocery', 'שוק'],
  liquor_store: ['shop', 'alcohol-shop', 'חנות משקאות'],
  books_music_and_video_store: ['shop', 'library', 'ספרים ומוזיקה'],
  flowers_and_gifts_store: ['shop', 'gift', 'פרחים ומתנות'],
  electronics_store: ['shop', 'mobile-phone', 'אלקטרוניקה'],
  sporting_goods_store: ['shop', 'shop', 'ציוד ספורט'],
  arts_crafts_and_hobby_store: ['shop', 'paint', 'יצירה ותחביבים'],
  hardware_home_and_garden_store: ['shop', 'hardware', 'בית וגן'],
  furniture_store: ['shop', 'furniture', 'רהיטים'],
  personal_care_and_beauty_store: ['shop', 'shop', 'טיפוח ויופי'],
  animal_and_pet_store: ['shop', 'veterinary', 'חנות לחיות מחמד'],
  second_hand_store: ['shop', 'shop', 'יד שנייה'],
  toys_and_games_store: ['shop', 'gaming', 'צעצועים ומשחקים'],
  musical_instrument_and_pro_audio_store: ['shop', 'music', 'כלי נגינה'],
  shopping_mall: ['shop', 'shop', 'קניון'],
  department_store: ['shop', 'shop', 'כלבו'],
  discount_store: ['shop', 'shop', 'חנות הנחות'],
  warehouse_club_store: ['shop', 'warehouse', 'מועדון קנייה'],
  eyewear_store: ['shop', 'optician', 'אופטיקה'],

  pharmacy_and_drug_store: ['health', 'pharmacy', 'בית מרקחת'],
  hospital: ['health', 'hospital', 'בית חולים'],
  surgery: ['health', 'hospital', 'מרכז ניתוחים'],
  specialized_medical_facility: ['health', 'hospital', 'מרכז רפואי'],
  dental_clinic: ['health', 'dentist', 'מרפאת שיניים'],
  health_care: ['health', 'doctor', 'שירותי בריאות'],
  medical_service: ['health', 'doctor', 'שירותי רפואה'],
  outpatient_care_facility: ['health', 'doctor', 'מרפאה'],
  primary_care_or_general_clinic: ['health', 'doctor', 'מרפאה'],
  specialized_health_care: ['health', 'doctor', 'רפואה מקצועית'],
  pediatric_clinic: ['health', 'doctor', 'מרפאת ילדים'],
  vision_or_eye_care_clinic: ['health', 'optician', 'מרפאת עיניים'],
  behavioral_or_mental_health_clinic: ['health', 'doctor', 'בריאות הנפש'],
  diagnostics_imaging_or_lab_service: ['health', 'doctor', 'מכון בדיקות'],
  complementary_and_alternative_medicine: ['health', 'doctor', 'רפואה משלימה'],
  physical_medicine_and_rehabilitation: ['health', 'doctor', 'שיקום ופיזיותרפיה'],
  reproductive_perinatal_and_womens_care: ['health', 'doctor', 'בריאות האישה'],

  bank_or_credit_union: ['money', 'bank', 'בנק'],
  atm: ['money', 'bank', 'כספומט'],
  financial_service: ['money', 'bank', 'שירותים פיננסיים'],
  insurance_agency: ['money', 'bank', 'ביטוח'],

  government_office: ['civic', 'town-hall', 'משרד ממשלתי'],
  embassy: ['civic', 'embassy', 'שגרירות'],
  community_center: ['civic', 'town-hall', 'מרכז קהילתי'],
  community_and_government: ['civic', 'town-hall', 'קהילה ושלטון'],
  civic_organization: ['civic', 'town-hall', 'ארגון אזרחי'],
  social_or_community_service: ['civic', 'town-hall', 'שירותים קהילתיים'],
  family_service: ['civic', 'town-hall', 'שירותים למשפחה'],
  youth_organization: ['civic', 'town-hall', 'תנועת נוער'],
  labor_union: ['civic', 'town-hall', 'איגוד מקצועי'],
  library: ['civic', 'library', 'ספרייה'],
  post_office: ['civic', 'post', 'דואר'],
  police_station: ['civic', 'police', 'משטרה'],
  fire_station: ['civic', 'fire-station', 'תחנת כיבוי'],
  military_site: ['civic', 'town-hall', 'אתר צבאי'],
  preschool: ['civic', 'school', 'גן ילדים'],
  elementary_school: ['civic', 'school', 'בית ספר יסודי'],
  middle_school: ['civic', 'school', 'חטיבת ביניים'],
  high_school: ['civic', 'school', 'תיכון'],
  specialty_school: ['civic', 'school', 'בית ספר מקצועי'],
  place_of_learning: ['civic', 'school', 'מוסד לימודים'],
  education: ['civic', 'school', 'חינוך'],
  educational_service: ['civic', 'school', 'שירותי חינוך'],
  college_university: ['civic', 'college', 'אוניברסיטה'],
  campus_building: ['civic', 'college', 'בניין בקמפוס'],
  research_institute: ['civic', 'college', 'מכון מחקר'],

  jewish_place_of_worship: ['worship', 'religious-jewish', 'בית כנסת'],
  christian_place_of_worship: ['worship', 'religious-christian', 'כנסייה'],
  muslim_place_of_worship: ['worship', 'religious-muslim', 'מסגד'],
  religious_organization: ['worship', 'place-of-worship', 'ארגון דתי'],
  place_of_worship: ['worship', 'place-of-worship', 'מקום תפילה'],
  cemetery: ['worship', 'cemetery', 'בית קברות'],

  art_gallery: ['sights', 'art-gallery', 'גלריה'],
  street_art: ['sights', 'art-gallery', 'אמנות רחוב'],
  museum: ['sights', 'museum', 'מוזיאון'],
  historic_site: ['sights', 'historic', 'אתר היסטורי'],
  monument: ['sights', 'monument', 'אנדרטה'],
  cultural_center: ['sights', 'museum', 'מרכז תרבות'],
  arts_and_entertainment: ['sights', 'attraction', 'תרבות ובידור'],
  music_venue: ['sights', 'music', 'מקום הופעות'],
  theatre_venue: ['sights', 'theatre', 'תיאטרון'],
  performing_arts_venue: ['sights', 'theatre', 'אמנויות הבמה'],
  comedy_club: ['sights', 'theatre', 'מועדון סטנדאפ'],
  movie_theater: ['sights', 'cinema', 'קולנוע'],
  event_venue: ['sights', 'star', 'אולם אירועים'],
  gaming_venue: ['sights', 'gaming', 'משחקייה'],
  aquarium: ['sights', 'aquarium', 'אקווריום'],
  landmark: ['sights', 'attraction', 'ציון דרך'],

  park: ['outdoor', 'park', 'פארק'],
  public_plaza: ['outdoor', 'park', 'כיכר'],
  beach: ['outdoor', 'beach', 'חוף'],
  public_fountain: ['outdoor', 'drinking-water', 'מזרקה'],
  mountain: ['outdoor', 'mountain', 'הר'],
  lake: ['outdoor', 'water', 'אגם'],
  river: ['outdoor', 'water', 'נחל'],
  amusement_park: ['outdoor', 'amusement-park', 'פארק שעשועים'],
  zoo: ['outdoor', 'zoo', 'גן חיות'],
  animal_attraction: ['outdoor', 'zoo', 'פינת חי'],
  playground: ['outdoor', 'playground', 'גן שעשועים'],
  campground: ['outdoor', 'campsite', 'חניון לילה'],
  golf_course: ['outdoor', 'golf', 'מגרש גולף'],
  sports_and_recreation: ['outdoor', 'pitch', 'ספורט ופנאי'],
  sport_or_fitness_facility: ['outdoor', 'pitch', 'מתקן ספורט'],
  sport_or_recreation_club: ['outdoor', 'pitch', 'מועדון ספורט'],
  sport_court: ['outdoor', 'pitch', 'מגרש'],
  sport_field: ['outdoor', 'pitch', 'מגרש'],
  sport_league: ['outdoor', 'pitch', 'ליגת ספורט'],
  sport_team: ['outdoor', 'pitch', 'קבוצת ספורט'],
  stadium_arena: ['outdoor', 'stadium', 'אצטדיון'],
  swimming_pool: ['outdoor', 'swimming', 'בריכה'],

  parking: ['transport', 'parking', 'חניון'],
  gas_station: ['transport', 'fuel', 'תחנת דלק'],
  ev_charging_station: ['transport', 'charging-station', 'עמדת טעינה'],
  train_station: ['transport', 'rail', 'תחנת רכבת'],
  bus_station: ['transport', 'bus', 'תחנה מרכזית'],
  public_transit_facility_or_service: ['transport', 'bus', 'תחבורה ציבורית'],
  air_transport_facility_or_service: ['transport', 'airport', 'תעופה'],
  airport: ['transport', 'airport', 'שדה תעופה'],
  travel_and_transportation: ['transport', 'car', 'תחבורה'],
  auto_dealer: ['transport', 'car', 'סוכנות רכב'],
  vehicle_dealer: ['transport', 'car', 'סוכנות רכב'],
  automotive_service: ['transport', 'car-repair', 'מוסך'],
  vehicle_service: ['transport', 'car-repair', 'שירותי רכב'],
  car_rental: ['transport', 'car-rental', 'השכרת רכב'],

  gym: ['service', 'fitness-centre', 'חדר כושר'],
  fitness_studio: ['service', 'fitness-centre', 'סטודיו לכושר'],
  personal_or_beauty_service: ['service', 'hairdresser', 'יופי וטיפוח'],
  hair_salon: ['service', 'hairdresser', 'מספרה'],
  wellness_service: ['service', 'heart', 'בריאות ורווחה'],
  laundry_service: ['service', 'laundry', 'מכבסה'],
  travel_service: ['service', 'suitcase', 'סוכנות נסיעות'],
  rental_service: ['service', 'shop', 'השכרה'],
  recreational_equipment_rental: ['service', 'bicycle', 'השכרת ציוד'],
  animal_or_pet_service: ['service', 'veterinary', 'שירותים לבעלי חיים'],
  veterinarian: ['service', 'veterinary', 'וטרינר'],
  real_estate_service: ['service', 'building', 'נדל״ן'],
  attorney_or_law_firm: ['service', 'building', 'משרד עורכי דין'],
  legal_service: ['service', 'building', 'שירותים משפטיים'],
  professional_service: ['service', 'building', 'שירותים מקצועיים'],
  b2b_office_and_professional_service: ['service', 'building', 'שירותים לעסקים'],
  b2b_service: ['service', 'building', 'שירותים לעסקים'],
  b2b_transportation_and_storage_service: ['service', 'warehouse', 'הובלה ואחסון'],
  corporate_or_business_office: ['service', 'building', 'משרדים'],
  design_service: ['service', 'paint', 'עיצוב'],
  printing_service: ['service', 'shop', 'דפוס'],
  media_service: ['service', 'building', 'מדיה'],
  radio_station: ['service', 'communications-tower', 'תחנת רדיו'],
  event_or_party_service: ['service', 'star', 'הפקת אירועים'],
  home_service: ['service', 'home', 'שירותים לבית'],
  technical_service: ['service', 'hardware', 'שירותים טכניים'],
  building_or_construction_service: ['service', 'construction', 'בנייה ושיפוצים'],
  shipping_or_delivery_service: ['service', 'post', 'משלוחים'],
  storage_facility: ['service', 'warehouse', 'מחסן'],
  manufacturer: ['service', 'industry', 'יצרן'],
  wholesaler: ['service', 'warehouse', 'סיטונאי'],
  senior_living_facility: ['service', 'home', 'דיור מוגן'],
  environmental_or_ecological_service: ['service', 'garden', 'שירותי סביבה'],
};

/**
 * Groups shown as soon as places appear (z15). Offices, lawyers and other services wait
 * for a closer zoom, the way Google Maps keeps the street view readable.
 */
export const PROMINENT_GROUPS: PoiGroupId[] = ['food', 'shop', 'lodging', 'health', 'sights', 'outdoor', 'transport', 'worship', 'money'];

export function overtureCategory(basic?: string): { group: PoiGroupId; maki: string | null; label?: string } {
  const row = basic ? OVERTURE_CATEGORIES[basic] : undefined;
  return row ? { group: row[0], maki: row[1], label: row[2] } : { group: 'service', maki: null };
}

function json<T>(v: unknown): T | undefined {
  if (typeof v !== 'string') return (v as T) ?? undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

/** A tapped Overture tile feature -> a Place with its contact details. */
export function overturePlace(props: Record<string, unknown>, lng: number, lat: number): Place {
  const addr = json<{ freeform?: string; locality?: string }[]>(props.addresses)?.[0];
  const phones = json<string[]>(props.phones) ?? [];
  const websites = json<string[]>(props.websites) ?? [];
  const socials = json<string[]>(props.socials) ?? [];
  const emails = json<string[]>(props.emails) ?? [];
  const brand = json<{ names?: { primary?: string } }>(props.brand)?.names?.primary;
  const address = [addr?.freeform, addr?.locality].filter(Boolean).join(', ') || undefined;
  return {
    id: `ovt:${String(props.id)}`,
    name: String(props['@name'] ?? brand ?? ''),
    lng,
    lat,
    address,
    category: props.basic_category ? { key: 'overture', value: String(props.basic_category) } : undefined,
    contact: {
      phone: phones[0],
      website: websites[0],
      email: emails[0],
      socials: socials.length ? socials : undefined,
    },
  };
}
