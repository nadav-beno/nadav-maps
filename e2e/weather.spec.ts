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
  await page.getByRole('button', { name: 'הסתרת שכבת מזג האוויר' }).click();
  await expect(page.getByRole('region', { name: 'שכבת רוח' })).toBeHidden();
});
