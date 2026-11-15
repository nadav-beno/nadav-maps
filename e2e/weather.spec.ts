import { expect, test } from '@playwright/test';
import { stubNetwork } from './stubs.ts';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

test('weather screen: now, hourly, 10 days and the tiles (UV, visibility, wind…)', async ({ page }) => {
  await page.goto('./?panel=weather&at=34.78,32.08#12/32.08/34.78');
  const hero = page.getByRole('region', { name: 'מזג האוויר עכשיו' });
  await expect(hero).toContainText('23°');
  await expect(hero).toContainText('מעונן חלקית');
  await expect(page.getByRole('region', { name: 'גשם בשעתיים הקרובות' })).toContainText(/גשם צפוי להתחיל בעוד כ-\d+ דקות/);
  await expect(page.getByRole('region', { name: 'תחזית שעתית' }).getByRole('listitem').first()).toContainText('עכשיו');
  await expect(page.getByRole('region', { name: 'תחזית ל-10 ימים' })).toContainText('היום');
  await expect(page.getByRole('region', { name: 'מדד UV' })).toContainText('6 · גבוה');
  await expect(page.getByRole('region', { name: 'ראות' })).toContainText('24 ק״מ');
  await expect(page.getByRole('region', { name: 'רוח' })).toContainText('15 קמ״ש');
  await expect(page.getByRole('region', { name: 'רוח' })).toContainText('מערבית');
  await expect(page.getByRole('region', { name: 'קרינת שמש' })).toContainText('W/m²');
  await expect(page.getByRole('region', { name: 'איכות אוויר' })).toContainText(/\d+ · /);
  await expect(page.getByRole('region', { name: 'ירח' })).toContainText('מואר');
  const sea = page.getByRole('region', { name: 'מצב הים' });
  await expect(sea).toContainText('0.8 מ׳ · נוח');
  await expect(sea).toContainText('גלים ממערב');
  await expect(sea).toContainText('טמפרטורת המים 25°');
  // A tile opens its 24-hour chart.
  await page.getByRole('region', { name: 'מדד UV' }).getByRole('button').click();
  await expect(page.getByRole('img', { name: /24 השעות הקרובות/ })).toBeVisible();
  await expect(page.getByText('Open-Meteo (CC BY 4.0)')).toBeVisible();
  await expect(page).toHaveURL(/panel=weather&at=34\.78,32\.08/);
});

test('weather chip on the map opens the weather screen', async ({ page }) => {
  await page.goto('./#12/32.08/34.78');
  const chip = page.getByRole('button', { name: /^מזג אוויר: \d+°/ });
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await chip.click();
  await expect(page.getByRole('region', { name: 'מזג האוויר עכשיו' })).toBeVisible();
});

test('typing "מזג אוויר" in search opens the weather here', async ({ page }) => {
  await page.goto('./#12/32.08/34.78');
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  await box.fill('מזג אוויר');
  await box.press('Enter');
  await expect(page.getByRole('region', { name: 'מזג האוויר עכשיו' })).toContainText('23°');
});

test('place card shows the weather there', async ({ page }) => {
  await page.goto('./?place=osm:n2002#17/32.0745/34.7918');
  const row = page.getByRole('region', { name: 'מזג אוויר במקום' });
  await expect(row).toContainText('23° · מעונן חלקית');
  await row.getByRole('button').click();
  await expect(page.getByRole('region', { name: 'מזג האוויר עכשיו' })).toBeVisible();
});

test('no sea tile inland', async ({ page }) => {
  await page.goto('./?panel=weather&at=35.21,31.77#12/31.77/35.21');
  await expect(page.getByRole('region', { name: 'ירח' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'מצב הים' })).toHaveCount(0);
});

test('beach place card shows the waves and the water temperature', async ({ page }) => {
  await page.goto('./?place=osm:n8008#16/32.0835/34.7676');
  const row = page.getByRole('region', { name: 'מזג אוויר במקום' });
  await expect(row).toContainText('23°');
  await expect(row.getByRole('button', { name: 'מצב הים' })).toContainText('ים נוח · גלים 0.8 מ׳');
  await expect(row).toContainText('טמפרטורת המים 25°');
});

test('weather map layers: UV field, time bar and legend', async ({ page }) => {
  await page.goto('./?panel=layers#9/32.08/34.78');
  await page.getByRole('button', { name: 'מדד UV' }).click();
  const bar = page.getByRole('region', { name: 'שכבת מדד UV' });
  await expect(bar).toBeVisible();
  await expect(bar.getByLabel('מקרא מדד UV')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { map: { querySourceFeatures(s: string): unknown[] } }).map.querySourceFeatures('wx-points').length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { map: { getLayoutProperty(l: string, p: string): unknown } }).map.getLayoutProperty('wx-field', 'visibility')))
    .toBe('visible');
  const slider = bar.getByRole('slider', { name: 'שעת התחזית' });
  await expect(bar).toContainText('עכשיו');
  await slider.fill('6');
  await expect(bar).not.toContainText('עכשיו');
  await page.getByRole('button', { name: 'רוח', exact: true }).click();
  await expect(page.getByRole('region', { name: 'שכבת רוח' })).toBeVisible();
  // Wind streaks move over the wind layer.
  await expect(page.locator('canvas.wx-particles')).toHaveCount(1, { timeout: 10_000 });
  await page.getByRole('button', { name: 'הסתרת שכבת מזג האוויר' }).click();
  await expect(page.getByRole('region', { name: 'שכבת רוח' })).toBeHidden();
  await expect(page.locator('canvas.wx-particles')).toHaveCount(0);
});

test('no wind streaks with "reduce motion"', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?panel=layers#9/32.08/34.78');
  await page.getByRole('button', { name: 'רוח', exact: true }).click();
  await expect(page.getByRole('region', { name: 'שכבת רוח' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { map: { getLayoutProperty(l: string, p: string): unknown } }).map.getLayoutProperty('wx-field', 'visibility')), { timeout: 10_000 }).toBe('visible');
  await expect(page.locator('canvas.wx-particles')).toHaveCount(0);
});

test('daily satellite image from NASA GIBS, by day', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('gibs.earthdata.nasa.gov') && asked.push(r.url()));
  await page.goto('./?panel=layers#6/32.08/34.78');
  await page.getByRole('button', { name: 'לוויין', exact: true }).click();
  const bar = page.getByRole('region', { name: 'שכבת לוויין' });
  await expect(bar).toContainText('אתמול');
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await expect.poll(() => asked.some((u) => u.includes(`/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${yesterday}/GoogleMapsCompatible_Level9/`))).toBe(true);
  await bar.getByRole('slider', { name: 'יום התמונה' }).fill('4');
  await expect(bar).not.toContainText('אתמול');
  const day3 = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  await expect.poll(() => asked.some((u) => u.includes(`/default/${day3}/`))).toBe(true);
  // A forecast layer replaces it.
  await page.getByRole('button', { name: 'טמפרטורה', exact: true }).click();
  await expect(page.getByRole('region', { name: 'שכבת טמפרטורה' })).toBeVisible();
  await expect(bar).toBeHidden();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { map: { getLayer(id: string): unknown } }).map.getLayer('wx-sat'))).toBe(false);
});
