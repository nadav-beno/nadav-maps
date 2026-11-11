import { expect, test } from '@playwright/test';
import { stubNetwork } from './stubs.ts';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

type MapLike = {
  getSource(id: string): unknown;
  querySourceFeatures(id: string): { properties: Record<string, unknown> }[];
  project(p: [number, number]): { x: number; y: number };
  getCanvas(): HTMLCanvasElement;
};

const vehicles = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { map: MapLike }).map;
    if (!map.getSource('live-vehicles')) return [];
    return [...new Set(map.querySourceFeatures('live-vehicles').map((f) => String(f.properties.line)))].sort();
  });

test('live transit: GPS buses and a moving tram appear with the transit layer, and a bus opens its card', async ({ page }) => {
  test.setTimeout(60_000);
  const stride: string[] = [];
  page.on('request', (r) => r.url().includes('open-bus-stride-api') && stride.push(r.url()));
  await page.goto('./#15/32.076/34.783');
  await page.getByRole('button', { name: 'שכבות' }).click();
  await page.getByRole('button', { name: 'תחבורה ציבורית' }).click();
  // Two GPS buses (lines 18, 25) and the light rail from Transitous; the timetable bus is dropped where GPS exists.
  await expect.poll(() => vehicles(page), { timeout: 15_000 }).toEqual(['18', '25', 'R']);
  expect(stride.some((u) => u.includes('/siri_vehicle_locations/list'))).toBe(true);

  // Tap bus 18 where the map draws it.
  await page.getByRole('region', { name: 'לוח מידע' }).getByRole('button', { name: 'חזרה' }).click();
  const pt = await page.evaluate(() => {
    const map = (window as unknown as { map: MapLike }).map;
    const p = map.project([34.779, 32.0775]);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByRole('heading', { name: /לכיוון ת\. מרכזית בת ים/ })).toBeVisible();
  await expect(page.getByText('מיקום GPS שהאוטובוס דיווח')).toBeVisible();
  await expect(page.getByText('דן', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'עקבו אחרי הרכב' }).click();
  await expect(page.getByRole('button', { name: 'מפסיקים לעקוב' })).toHaveAttribute('aria-pressed', 'true');
});

test('live transit: nothing is fetched while the transit layer is off', async ({ page }) => {
  const live: string[] = [];
  page.on('request', (r) => (r.url().includes('open-bus-stride-api') || r.url().includes('/map/trips')) && live.push(r.url()));
  await page.goto('./#15/32.076/34.783');
  await expect(page.getByRole('button', { name: 'שכבות' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(live).toEqual([]);
});
