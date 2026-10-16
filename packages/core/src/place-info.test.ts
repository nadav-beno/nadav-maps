import { describe, expect, it } from 'vitest';
import { cuisineLabel, kosherBadge, nearbySearchCategory, placeAttributes, placeLinks, serviceOptions, similarCategories } from './place-info.ts';

const labels = (xs: { label: string; ok: boolean }[]) => xs.map((x) => (x.ok ? x.label : `✗ ${x.label}`));

describe('service options', () => {
  it('reads like Google: dine-in, takeaway, delivery, then the rest', () => {
    const tags = { amenity: 'restaurant', delivery: 'yes', takeaway: 'yes', outdoor_seating: 'yes', reservation: 'recommended', drive_through: 'no' };
    expect(labels(serviceOptions(tags))).toEqual(['לאכול במקום', 'איסוף עצמי', 'משלוחים', 'ישיבה בחוץ', 'מומלץ להזמין מקום']);
  });
  it('says what is not offered', () => {
    expect(labels(serviceOptions({ amenity: 'cafe', delivery: 'no', takeaway: 'no' }))).toEqual(['לאכול במקום', '✗ אין איסוף עצמי', '✗ אין משלוחים']);
    expect(labels(serviceOptions({ amenity: 'fast_food', takeaway: 'only', drive_through: 'yes' }))).toEqual(['✗ אין ישיבה במקום', 'איסוף עצמי', 'דרייב-אין']);
  });
  it('implies dine-in for Overture restaurants and cafés only', () => {
    expect(labels(serviceOptions({}, { key: 'overture', value: 'coffee_shop' }))).toEqual(['לאכול במקום']);
    expect(serviceOptions({}, { key: 'overture', value: 'hotel' })).toEqual([]);
    expect(serviceOptions({ shop: 'mall' })).toEqual([]);
  });
});

describe('kosher', () => {
  it('reads diet:kosher and kosher=*', () => {
    expect(kosherBadge({ 'diet:kosher': 'yes' })).toBe('כשר');
    expect(kosherBadge({ kosher: 'dairy' })).toBe('כשר חלבי');
    expect(kosherBadge({ 'diet:kosher': 'only', 'kosher:certification': 'Badatz Mehadrin' })).toBe('כשר למהדרין');
    expect(kosherBadge({ 'diet:kosher': 'no' })).toBeNull();
    expect(kosherBadge({})).toBeNull();
  });
});

describe('attributes', () => {
  it('groups accessibility, amenities, food, atmosphere and payments', () => {
    const groups = placeAttributes({
      wheelchair: 'yes',
      'toilets:wheelchair': 'yes',
      toilets: 'yes',
      internet_access: 'wlan',
      'internet_access:fee': 'no',
      'diet:vegetarian': 'yes',
      'diet:vegan': 'only',
      'diet:kosher': 'meat',
      smoking: 'outside',
      dog: 'leashed',
      'payment:cash': 'no',
      'payment:credit_cards': 'yes',
      'payment:apple_pay': 'yes',
      'payment:bit': 'yes',
    });
    expect(Object.fromEntries(groups.map((g) => [g.title, labels(g.items)]))).toEqual({
      נגישות: ['כניסה נגישה לכיסאות גלגלים', 'שירותים נגישים'],
      'שירותים במקום': ['שירותים', 'Wi-Fi חינם'],
      תזונה: ['כשר בשרי', 'מנות צמחוניות', 'טבעוני בלבד'],
      אווירה: ['עישון בחוץ בלבד', 'מותר להכניס כלבים ברצועה'],
      תשלום: ['✗ לא מקבלים מזומן', 'כרטיסי אשראי', 'Apple Pay', 'ביט'],
    });
  });
  it('is empty without data', () => {
    expect(placeAttributes({ name: 'x', amenity: 'cafe' })).toEqual([]);
    expect(labels(placeAttributes({ smoking: 'no', internet_access: 'no', dogs: 'no' }).flatMap((g) => g.items))).toEqual([
      '✗ אין Wi-Fi',
      '✗ העישון אסור',
      '✗ אסור להכניס כלבים',
    ]);
  });
});

describe('similar places', () => {
  it('maps OSM and Overture categories to families', () => {
    expect(similarCategories({ key: 'amenity', value: 'restaurant' })).toContain('casual_eatery');
    expect(similarCategories({ key: 'overture', value: 'casual_eatery' })).toContain('restaurant');
    expect(similarCategories({ key: 'overture', value: 'museum' })).toContain('art_gallery');
    expect(similarCategories({ key: 'overture', value: 'shoe_store' })).toEqual(['shoe_store']);
    expect(similarCategories({ key: 'highway', value: 'primary' })).toEqual([]);
    expect(nearbySearchCategory({ key: 'amenity', value: 'cafe' })).toBe('cafe');
    expect(nearbySearchCategory({ key: 'shop', value: 'mall' })).toBeNull();
  });
  it('names cuisines in Hebrew', () => {
    expect(cuisineLabel('mediterranean;fish')).toBe('ים-תיכוני');
    expect(cuisineLabel('Pizza')).toBe('פיצה');
    expect(cuisineLabel('klingon')).toBeNull();
    expect(cuisineLabel()).toBeNull();
  });
  it('finds menu and booking links', () => {
    expect(placeLinks({ 'website:menu': 'https://x.example/menu', 'reservation:website': 'https://book.example', description: 'ביסטרו' })).toEqual({
      menu: 'https://x.example/menu',
      reservation: 'https://book.example',
      description: 'ביסטרו',
    });
    expect(placeLinks({ 'website:menu': 'javascript:alert(1)' }).menu).toBeUndefined();
  });
});
