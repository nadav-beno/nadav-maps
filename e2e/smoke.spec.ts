import { expect, test } from '@playwright/test';
import { stubNetwork } from './stubs.ts';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

test('loads the map in Hebrew, right to left', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' })).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
});

test('search with autocomplete opens a place card with details', async ({ page }) => {
  await page.goto('./');
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  await box.fill('עזריאלי');
  await page.getByRole('option').filter({ hasText: 'קניון עזריאלי' }).click();
  await expect(page.getByRole('heading', { name: 'קניון עזריאלי' })).toBeVisible();
  await expect(page.getByText('נגיש לכיסאות גלגלים')).toBeVisible();
  await expect(page).toHaveURL(/place=osm:n2002/);
});

test('route from a shared link shows alternatives and steps', async ({ page }) => {
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await expect(page.locator('.route-option .route-time').first()).toHaveText('4 דק׳');
  await expect(page.locator('.route-option')).toHaveCount(2);
  await page.getByRole('button', { name: 'שלבים' }).click();
  await expect(page.getByText('פנו ימינה אל דרך מנחם בגין')).toBeVisible();
});

test('back button closes the place card', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' }).fill('עזריאלי');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('heading', { name: 'קניון עזריאלי' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'קניון עזריאלי' })).toBeHidden();
});

test('save a place to favorites and see it in the saved list', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' }).fill('עזריאלי');
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('checkbox', { name: /מועדפים/ }).check();
  await page.getByRole('button', { name: 'סיום' }).click();
  await expect(page.getByRole('button', { name: 'נשמר' })).toBeVisible();
  await page.goBack();
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'שמורים' }).click();
  await page.getByRole('button', { name: /מועדפים/ }).click();
  await expect(page.getByText('קניון עזריאלי')).toBeVisible();
});

test('a business from Overture opens with its phone, website and socials', async ({ page }) => {
  await page.goto('./?place=ovt:aaaaaaaa-0000-4000-8000-000000000001#18/32.0801/34.7792');
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible();
  await expect(page.getByText(/03-?523-?6058/)).toBeVisible();
  await expect(page.getByText('bistro.example', { exact: true })).toBeVisible();
  await expect(page.getByText('פייסבוק')).toBeVisible();
});

test('tapping a business on the map opens its card', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the visual centre is easy to compute beside the side panel');
  await page.goto('./#18/32.0801/34.7792');
  await page.waitForTimeout(1500);
  // The side panel takes 408px on the right, so the map's centre is at x = (1280 - 408) / 2.
  await page.mouse.click(436, 400);
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible();
  await expect(page).toHaveURL(/place=ovt:aaaaaaaa/);
});

test('layers: satellite map type and transit lines are remembered', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'שכבות' }).click();
  await page.getByRole('radio', { name: 'לוויין' }).click();
  await page.getByRole('button', { name: 'תחבורה ציבורית' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'שכבות' }).click();
  await expect(page.getByRole('radio', { name: 'לוויין' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'תחבורה ציבורית' })).toHaveAttribute('aria-pressed', 'true');
});

test('category chip finds nearby cafes', async ({ page }) => {
  await page.goto('./#15/32.08/34.78');
  await page.getByRole('button', { name: 'בתי קפה' }).click();
  await expect(page.getByText('קפה לנדוור')).toBeVisible();
});

test.describe('with location', () => {
  test.use({ geolocation: { latitude: 32.0787, longitude: 34.7741 }, permissions: ['geolocation'] });

  test('turn-by-turn navigation (simulated drive) shows hebrew instructions and exits cleanly', async ({ page }) => {
    await page.goto('./?route=me;34.7918,32.0745&mode=car&simulate=1');
    await page.getByRole('button', { name: /יציאה לדרך/ }).click();
    const banner = page.locator('.nav-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('פנו ימינה אל דרך מנחם בגין');
    await expect(page.locator('.nav-eta strong')).toHaveText(/^\d{2}:\d{2}$/);
    await page.getByRole('button', { name: 'יציאה', exact: true }).click();
    await expect(banner).toBeHidden();
    await expect(page.getByRole('button', { name: /יציאה לדרך/ })).toBeVisible();
  });
});

test('dark mode and units from settings persist across reloads', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'הגדרות' }).click();
  await page.getByRole('button', { name: 'כהה' }).click();
  await page.getByRole('button', { name: 'מיילים' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'הגדרות' }).click();
  await expect(page.getByRole('button', { name: 'מיילים' })).toHaveAttribute('aria-pressed', 'true');
});
