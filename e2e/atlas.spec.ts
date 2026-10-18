import { expect, test, type Page } from '@playwright/test';
import { atlasStatus, INCIDENTS, packStatus, SEGMENT_AT, stubAtlas } from './atlas-scene.ts';
import { stubNetwork } from './stubs.ts';

/** Atlas, our own traffic service, with all its requests answered from its archived fixtures. */
type W = {
  map: {
    getLayer(id: string): unknown;
    getSource(id: string): { tiles?: string[] } | undefined;
    queryRenderedFeatures(o: { layers: string[] }): { properties: Record<string, unknown> }[];
  };
};
const rendered = (page: Page) => page.evaluate(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['atlas-flow'] }).length);
const hasLayer = (page: Page) => page.evaluate(() => !!(window as unknown as W).map.getLayer('atlas-flow'));
const tileTemplate = (page: Page) => page.evaluate(() => (window as unknown as W).map.getSource('atlas-flow')?.tiles?.[0] ?? null);

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

async function trafficOn(page: Page) {
  await page.getByRole('button', { name: 'שכבות' }).click();
  const toggle = page.getByRole('button', { name: 'תנועה', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

const kowloon = `#16/${SEGMENT_AT[1]}/${SEGMENT_AT[0]}`;

test('atlas: measured speeds in Hong Kong, new snapshots through setTiles, kept across a style change', async ({ page }) => {
  const atlas = await stubAtlas(page, { status: atlasStatus(), tiles: 'fresh' });
  await page.goto(`./?atlas=test${kowloon}`);
  await trafficOn(page);
  await expect(page.getByText('Atlas: מהירות נמדדת בקמ״ש')).toBeVisible();
  await expect(page.getByRole('list', { name: 'מהירות נמדדת בקמ״ש' })).toContainText('60–80');
  await expect.poll(() => rendered(page)).toBeGreaterThan(0);
  const f = await page.evaluate(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['atlas-flow'] })[0].properties);
  expect(f).toMatchObject({ segment_id: '103495', speed_kph: 64.5 });
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('Transport Department');
  // Status is public (no key, no cookies); tiles carry the key and the snapshot version.
  const status = atlas.requests.filter((r) => r.path === '/api/status');
  expect(status.length).toBeGreaterThan(0);
  expect(status.every((r) => r.key === null && !r.credentials)).toBe(true);
  expect(atlas.requests.some((r) => r.path.startsWith('/api/v1/tiles/flow/16/') && r.key === 'test' && r.v === 'v1')).toBe(true);

  // A new snapshot: the same source gets the new template when the page comes back into view.
  atlas.status = atlasStatus({ tiles_version: 'v2' });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => tileTemplate(page)).toContain('v=v2');
  await expect.poll(() => atlas.requests.some((r) => r.v === 'v2')).toBe(true);

  // Satellite swaps the style: the Atlas layer comes back with it.
  await page.getByRole('radio', { name: 'לוויין' }).click();
  await expect.poll(() => hasLayer(page)).toBe(true);
  await expect.poll(() => tileTemplate(page)).toContain('v=v2');
});

test('atlas: Atlas fixture pack, fresh tile drawn at z14, its stale, error and unavailable statuses hidden', async ({ page }) => {
  const atlas = await stubAtlas(page, { status: packStatus('ok'), tiles: 'fresh' });
  await page.goto(`./?atlas=test#14/${SEGMENT_AT[1]}/${SEGMENT_AT[0]}`);
  await trafficOn(page);
  await expect.poll(() => rendered(page)).toBeGreaterThan(0);
  expect(atlas.requests.some((r) => r.path === '/api/v1/tiles/flow/14/13389/7148.pbf' && r.v === '111111111111111111111111')).toBe(true);

  const check = async () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  for (const name of ['stale', 'error'] as const) {
    atlas.status = packStatus(name);
    await check();
    await expect(page.getByText(/הנתונים של Atlas לא עדכניים \(המדידה האחרונה ב-/)).toBeVisible();
    await expect.poll(() => hasLayer(page)).toBe(false);
    atlas.status = packStatus('ok');
    await check();
    await expect.poll(() => hasLayer(page)).toBe(true);
  }
  // No data at all: unavailable, not "old data".
  atlas.status = packStatus('unavailable');
  await check();
  await expect(page.getByText('Atlas לא זמין כרגע, ולכן הנתונים שלו לא מוצגים.')).toBeVisible();
  expect(await hasLayer(page)).toBe(false);
});

test('atlas: stale tile features and a stale snapshot are hidden', async ({ page }) => {
  // A current status but tiles from an older snapshot whose features say stale=true.
  const atlas = await stubAtlas(page, { status: atlasStatus(), tiles: 'stale' });
  await page.goto(`./?atlas=test#14/${SEGMENT_AT[1]}/${SEGMENT_AT[0]}`);
  await trafficOn(page);
  await expect.poll(() => atlas.requests.some((r) => r.path === '/api/v1/tiles/flow/14/13389/7148.pbf')).toBe(true);
  await expect.poll(() => hasLayer(page)).toBe(true);
  await page.waitForTimeout(500);
  expect(await rendered(page)).toBe(0);

  // The snapshot itself goes stale: the layer is removed and the screen says why.
  atlas.status = atlasStatus({ stale: true, source_status: 'stale' });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText(/הנתונים של Atlas לא עדכניים/)).toBeVisible();
  await expect.poll(() => hasLayer(page)).toBe(false);

  // Atlas down (503): unavailable, still nothing drawn.
  atlas.status = 503;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('Atlas לא זמין כרגע, ולכן הנתונים שלו לא מוצגים.')).toBeVisible();
  expect(await hasLayer(page)).toBe(false);
});

test('atlas: a stale first read is retried soon, and a snapshot hides at stale_after on Atlas clock even when reads fail', async ({ page }) => {
  test.setTimeout(60_000);
  // Atlas's clock is an hour ahead of the device's: hiding by the device clock would never happen.
  const ahead = { aheadS: 3600 };
  const atlas = await stubAtlas(page, { status: atlasStatus({ stale: true, source_status: 'stale' }, ahead), tiles: 'fresh' });
  await page.goto(`./?atlas=test${kowloon}`);
  await trafficOn(page);
  await expect(page.getByText(/הנתונים של Atlas לא עדכניים/)).toBeVisible();

  // The read that found it stale started a refresh on Atlas; the next read, sooner than a minute, sees it.
  atlas.status = () => atlasStatus({}, { ...ahead, freshS: 8 });
  await expect.poll(() => hasLayer(page), { timeout: 20_000 }).toBe(true);
  await expect(page.getByText('Atlas: מהירות נמדדת בקמ״ש')).toBeVisible();

  // From now on Atlas cannot be reached, and the snapshot still hides on time.
  atlas.status = 503;
  await expect.poll(() => hasLayer(page), { timeout: 12_000 }).toBe(false);
  await expect(page.getByText(/הנתונים של Atlas לא עדכניים/)).toBeVisible();
});

test('atlas: official incident announcements as icons with their details', async ({ page }) => {
  const atlas = await stubAtlas(page, { status: atlasStatus(), tiles: 'fresh', incidents: INCIDENTS });
  await page.goto(`./?atlas=test${kowloon}`);
  await trafficOn(page);
  await expect(page.getByText('הודעת תנועה רשמית אחת בלי מיקום, ולכן לא על המפה.')).toBeVisible();
  const inc = atlas.requests.filter((r) => r.path === '/api/v1/incidents');
  expect(inc.length).toBe(1);
  expect(inc[0]).toMatchObject({ key: 'test', bbox: '113.85,22.23,114.29,22.55', credentials: false });
  await page.getByRole('region', { name: 'לוח מידע' }).getByLabel('חזרה').click();

  await page.waitForFunction(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['atlas-incidents'] }).length > 0);
  const at = await page.evaluate((p) => (window as unknown as { map: { project(p: number[]): { x: number; y: number } } }).map.project(p), SEGMENT_AT);
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect(page.getByRole('heading', { name: 'תאונה' })).toBeVisible();
  await expect(page.getByText('Test announcement: one lane of the road is closed.')).toBeVisible();
  await expect(page.getByText('Test Road · Kowloon bound')).toBeVisible();
  await expect(page.getByText(/^הוכרז ב-/)).toBeVisible();
});

test('atlas: a stale incidents answer shows no announcement and says so', async ({ page }) => {
  const atlas = await stubAtlas(page, { status: atlasStatus(), tiles: 'fresh', incidents: { ...INCIDENTS, stale: true, source_status: 'stale' } });
  await page.goto(`./?atlas=test${kowloon}`);
  await trafficOn(page);
  await expect(page.getByText('הודעות התנועה הרשמיות לא עדכניות כרגע, ולכן לא מוצגות.')).toBeVisible();
  expect(atlas.requests.filter((r) => r.path === '/api/v1/incidents').length).toBe(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['atlas-incidents'] }).length)).toBe(0);
});

test('atlas: Israel has no Atlas coverage and asks for no tiles', async ({ page }) => {
  const atlas = await stubAtlas(page, { status: atlasStatus(), tiles: 'fresh' });
  await page.goto('./?atlas=test#15/32.08/34.792');
  await trafficOn(page);
  await expect(page.getByText('אין כיסוי של Atlas באזור הזה')).toBeVisible();
  await page.waitForTimeout(500);
  expect(atlas.requests.filter((r) => r.path.startsWith('/api/v1/tiles/'))).toEqual([]);
  expect(await hasLayer(page)).toBe(false);
});

test('atlas: a refused key (401) switches Atlas off without retrying', async ({ page }) => {
  const atlas = await stubAtlas(page, { status: atlasStatus(), tiles: 401 });
  await page.goto(`./?atlas=test${kowloon}`);
  await trafficOn(page);
  await expect(page.getByText(/Atlas דחה את הבקשה/)).toBeVisible();
  await expect.poll(() => hasLayer(page)).toBe(false);
  const before = atlas.requests.length;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(500);
  expect(atlas.requests.length).toBe(before);
});

test('atlas: without a key there is no Atlas request at all', async ({ page }) => {
  const atlas = await stubAtlas(page, { status: atlasStatus(), tiles: 'fresh' });
  await page.goto(`./${kowloon}`);
  await page.getByRole('button', { name: 'שכבות' }).click();
  await expect(page.getByRole('button', { name: 'תנועה', exact: true })).toHaveCount(0);
  expect(atlas.requests).toEqual([]);
});
