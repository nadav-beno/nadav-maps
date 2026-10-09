import { overtureCategory, type PoiGroupId } from './overture.ts';
import type { Place } from './types.ts';

/**
 * How a place looks in lists and cards: a Material Symbols icon name and a colour group
 * (the same groups the map uses, so a café is orange everywhere).
 */
export interface PlaceVisual {
  icon: string;
  group: PoiGroupId | 'place' | 'address';
}

const BY_VALUE: Record<string, PlaceVisual> = {
  restaurant: { icon: 'restaurant', group: 'food' },
  fast_food: { icon: 'fastfood', group: 'food' },
  food_court: { icon: 'restaurant', group: 'food' },
  cafe: { icon: 'local_cafe', group: 'food' },
  bar: { icon: 'local_bar', group: 'food' },
  pub: { icon: 'sports_bar', group: 'food' },
  biergarten: { icon: 'sports_bar', group: 'food' },
  ice_cream: { icon: 'icecream', group: 'food' },
  nightclub: { icon: 'nightlife', group: 'food' },
  bakery: { icon: 'bakery_dining', group: 'food' },
  supermarket: { icon: 'grocery', group: 'shop' },
  convenience: { icon: 'grocery', group: 'shop' },
  greengrocer: { icon: 'grocery', group: 'shop' },
  mall: { icon: 'local_mall', group: 'shop' },
  department_store: { icon: 'local_mall', group: 'shop' },
  clothes: { icon: 'checkroom', group: 'shop' },
  shoes: { icon: 'checkroom', group: 'shop' },
  jewelry: { icon: 'diamond', group: 'shop' },
  florist: { icon: 'local_florist', group: 'shop' },
  electronics: { icon: 'devices', group: 'shop' },
  mobile_phone: { icon: 'devices', group: 'shop' },
  books: { icon: 'book_2', group: 'shop' },
  toys: { icon: 'toys', group: 'shop' },
  alcohol: { icon: 'liquor', group: 'shop' },
  hairdresser: { icon: 'content_cut', group: 'service' },
  beauty: { icon: 'spa', group: 'service' },
  laundry: { icon: 'local_laundry_service', group: 'service' },
  dry_cleaning: { icon: 'local_laundry_service', group: 'service' },
  hotel: { icon: 'hotel', group: 'lodging' },
  hostel: { icon: 'hotel', group: 'lodging' },
  guest_house: { icon: 'hotel', group: 'lodging' },
  motel: { icon: 'hotel', group: 'lodging' },
  apartment: { icon: 'cottage', group: 'lodging' },
  camp_site: { icon: 'camping', group: 'outdoor' },
  hospital: { icon: 'local_hospital', group: 'health' },
  clinic: { icon: 'medical_services', group: 'health' },
  doctors: { icon: 'medical_services', group: 'health' },
  dentist: { icon: 'dentistry', group: 'health' },
  pharmacy: { icon: 'local_pharmacy', group: 'health' },
  veterinary: { icon: 'pets', group: 'service' },
  bank: { icon: 'account_balance', group: 'money' },
  atm: { icon: 'local_atm', group: 'money' },
  bureau_de_change: { icon: 'local_atm', group: 'money' },
  fuel: { icon: 'local_gas_station', group: 'transport' },
  charging_station: { icon: 'ev_station', group: 'transport' },
  parking: { icon: 'local_parking', group: 'transport' },
  car_rental: { icon: 'car_rental', group: 'transport' },
  car_repair: { icon: 'car_repair', group: 'transport' },
  bus_station: { icon: 'directions_bus', group: 'transport' },
  bus_stop: { icon: 'directions_bus', group: 'transport' },
  station: { icon: 'train', group: 'transport' },
  halt: { icon: 'train', group: 'transport' },
  tram_stop: { icon: 'train', group: 'transport' },
  subway_entrance: { icon: 'train', group: 'transport' },
  aerodrome: { icon: 'flight', group: 'transport' },
  airport: { icon: 'flight', group: 'transport' },
  ferry_terminal: { icon: 'directions_boat', group: 'transport' },
  museum: { icon: 'museum', group: 'sights' },
  gallery: { icon: 'palette', group: 'sights' },
  arts_centre: { icon: 'palette', group: 'sights' },
  theatre: { icon: 'theater_comedy', group: 'sights' },
  cinema: { icon: 'movie', group: 'sights' },
  attraction: { icon: 'attractions', group: 'sights' },
  viewpoint: { icon: 'landscape_2', group: 'sights' },
  artwork: { icon: 'palette', group: 'sights' },
  monument: { icon: 'castle', group: 'sights' },
  memorial: { icon: 'castle', group: 'sights' },
  castle: { icon: 'castle', group: 'sights' },
  ruins: { icon: 'castle', group: 'sights' },
  archaeological_site: { icon: 'castle', group: 'sights' },
  zoo: { icon: 'pets', group: 'outdoor' },
  theme_park: { icon: 'attractions', group: 'outdoor' },
  park: { icon: 'park', group: 'outdoor' },
  garden: { icon: 'park', group: 'outdoor' },
  nature_reserve: { icon: 'nature_people', group: 'outdoor' },
  playground: { icon: 'playground', group: 'outdoor' },
  beach: { icon: 'beach_access', group: 'outdoor' },
  peak: { icon: 'landscape_2', group: 'outdoor' },
  spring: { icon: 'water', group: 'outdoor' },
  stadium: { icon: 'stadium', group: 'outdoor' },
  pitch: { icon: 'sports_soccer', group: 'outdoor' },
  sports_centre: { icon: 'fitness_center', group: 'service' },
  fitness_centre: { icon: 'fitness_center', group: 'service' },
  swimming_pool: { icon: 'pool', group: 'outdoor' },
  golf_course: { icon: 'golf_course', group: 'outdoor' },
  school: { icon: 'school', group: 'civic' },
  kindergarten: { icon: 'child_care', group: 'civic' },
  university: { icon: 'school', group: 'civic' },
  college: { icon: 'school', group: 'civic' },
  library: { icon: 'local_library', group: 'civic' },
  townhall: { icon: 'account_balance', group: 'civic' },
  courthouse: { icon: 'gavel', group: 'civic' },
  police: { icon: 'local_police', group: 'civic' },
  fire_station: { icon: 'local_fire_department', group: 'civic' },
  post_office: { icon: 'local_post_office', group: 'civic' },
  community_centre: { icon: 'groups', group: 'civic' },
  toilets: { icon: 'wc', group: 'civic' },
  place_of_worship: { icon: 'synagogue', group: 'worship' },
  synagogue: { icon: 'synagogue', group: 'worship' },
  church: { icon: 'church', group: 'worship' },
  mosque: { icon: 'mosque', group: 'worship' },
};

/** Maki icon names (used by Overture categories) -> Material Symbols. */
const MAKI_TO_MATERIAL: Record<string, string> = {
  restaurant: 'restaurant', 'fast-food': 'fastfood', cafe: 'local_cafe', bakery: 'bakery_dining', 'ice-cream': 'icecream',
  bar: 'local_bar', beer: 'sports_bar', nightclub: 'nightlife', lodging: 'hotel', shop: 'storefront',
  'clothing-store': 'checkroom', shoe: 'checkroom', 'jewelry-store': 'diamond', grocery: 'grocery', convenience: 'grocery',
  'alcohol-shop': 'liquor', library: 'local_library', gift: 'local_florist', 'mobile-phone': 'devices', paint: 'palette',
  hardware: 'home_repair_service', furniture: 'cottage', veterinary: 'pets', gaming: 'toys', music: 'music_note',
  warehouse: 'warehouse', optician: 'visibility', pharmacy: 'local_pharmacy', hospital: 'local_hospital',
  dentist: 'dentistry', doctor: 'medical_services', bank: 'account_balance', 'town-hall': 'account_balance',
  embassy: 'flag', post: 'local_post_office', police: 'local_police', 'fire-station': 'local_fire_department',
  school: 'school', college: 'school', 'religious-jewish': 'synagogue', 'religious-christian': 'church',
  'religious-muslim': 'mosque', 'place-of-worship': 'synagogue', cemetery: 'nature_people', 'art-gallery': 'palette',
  museum: 'museum', historic: 'castle', monument: 'castle', attraction: 'attractions', theatre: 'theater_comedy',
  cinema: 'movie', star: 'celebration', aquarium: 'water', park: 'park', beach: 'beach_access',
  'drinking-water': 'water', mountain: 'landscape_2', water: 'water', 'amusement-park': 'attractions', zoo: 'pets',
  playground: 'playground', campsite: 'camping', golf: 'golf_course', pitch: 'sports_soccer', stadium: 'stadium',
  swimming: 'pool', parking: 'local_parking', fuel: 'local_gas_station', 'charging-station': 'ev_station',
  rail: 'train', bus: 'directions_bus', airport: 'flight', car: 'directions_car', 'car-repair': 'car_repair',
  'car-rental': 'car_rental', 'fitness-centre': 'fitness_center', hairdresser: 'content_cut', heart: 'spa',
  laundry: 'local_laundry_service', suitcase: 'luggage', bicycle: 'directions_bike', building: 'business_center',
  'communications-tower': 'business_center', home: 'cottage', construction: 'construction', industry: 'factory',
  garden: 'park',
};

export function placeVisual(p: Pick<Place, 'category'>): PlaceVisual {
  const k = p.category?.key ?? '';
  const v = p.category?.value ?? '';
  if (k === 'overture') {
    const o = overtureCategory(v);
    return { icon: (o.maki && MAKI_TO_MATERIAL[o.maki]) || 'storefront', group: o.group };
  }
  if (k === 'place' || k === 'boundary') return { icon: 'location_on', group: 'place' };
  if (k === 'highway' || k === 'building' || !k) return { icon: 'location_on', group: 'address' };
  const hit = BY_VALUE[v];
  if (hit) return hit;
  if (k === 'shop') return { icon: 'storefront', group: 'shop' };
  if (k === 'tourism') return { icon: 'attractions', group: 'sights' };
  if (k === 'leisure' || k === 'natural') return { icon: 'park', group: 'outdoor' };
  if (k === 'office' || k === 'craft') return { icon: 'business_center', group: 'service' };
  if (k === 'railway' || k === 'public_transport') return { icon: 'train', group: 'transport' };
  if (k === 'historic') return { icon: 'castle', group: 'sights' };
  return { icon: 'location_on', group: 'address' };
}
