import { expect, test } from '@playwright/test';
import { stubCurlbus, stubNetwork } from './stubs.ts';

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

test('live arrivals: a stop shows when each bus arrives, and the bus can be shown on the map', async ({ page }) => {
  test.setTimeout(60_000);
  const asked: string[] = [];
  await stubCurlbus(page, asked);
  await page.goto('./#16/32.0779/34.7752');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'יציאות קרובות' }).click();
  const rows = page.locator('.departure');
  // Live predictions (SIRI via curlbus) for the buses; the passed bus is gone.
  await expect(rows.first().locator('.line-chip')).toContainText('18');
  await expect(rows.first()).toContainText('לכיוון ת. מרכזית בת ים');
  await expect(rows.first().locator('.dep-time')).toHaveClass(/live/);
  await expect(rows.first().locator('.dep-time')).toContainText(/בעוד [23] דק׳/);
  await expect(rows.filter({ hasText: 'מסוף רידינג' })).toHaveCount(1);
  expect(asked.some((u) => u.startsWith('/nearby?'))).toBe(true);
  expect(asked).toContain('/21330+21331');
  // Bus 18 reported where it is: tap to see it on the map, with its arrival at the stop.
  await rows.first().getByRole('button', { name: 'איפה קו 18 עכשיו' }).click();
  await expect(page.getByText(/מגיע לדיזנגוף סנטר בעוד [23] דק׳/)).toBeVisible();
  await expect.poll(() => vehicles(page), { timeout: 15_000 }).toContain('18');
});
