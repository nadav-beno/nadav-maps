import { expect, test, type Page } from '@playwright/test';
import { stubGeodata, stubNetwork } from './stubs.ts';
import { encodePlusCode } from '../packages/core/src/plus-code.ts';
import { adsbAreaResponse, adsbResponse, fakeGps, FLIGHT_FIXES, openskyResponse, routesetResponse, worldResponse } from './flight-fixture.ts';
import { TAKEOUT_DAY, TAKEOUT_FIXTURE } from './timeline-fixture.ts';

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
  // Many steps: on a busy CI runner it can pass 30 s.
  test.slow();
  await page.goto('./');
  await page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' }).fill('עזריאלי');
  await page.getByRole('option').first().click();
  // One tap saves to favorites (the last list used) and offers to change the list.
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByText('נשמר במועדפים')).toBeVisible();
  await page.getByRole('button', { name: 'שינוי' }).click();
  await expect(page.getByRole('checkbox', { name: /מועדפים/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /תוכניות נסיעה/ }).check();
  await page.getByRole('button', { name: 'סיום' }).click();
  await expect(page.getByRole('button', { name: 'נשמר' })).toBeVisible();
  // A private label and a note on the card.
  await page.getByRole('button', { name: 'הוספת תווית פרטית' }).click();
  await page.getByRole('textbox', { name: /תווית פרטית/ }).fill('הקניון שלי');
  await page.getByRole('textbox', { name: /תווית פרטית/ }).press('Enter');
  await expect(page.getByText('תווית: הקניון שלי')).toBeVisible();
  await page.goBack();
  // Wait for the back to close the card: a tab tapped before the app handles popstate is undone by it.
  await expect(page.getByText('תווית: הקניון שלי')).toBeHidden();
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'שמורים' }).click();
  await page.getByRole('button', { name: /מועדפים/ }).click();
  await expect(page.getByText('קניון עזריאלי')).toBeVisible();
});

test('a business from Overture opens with its phone, website and socials', async ({ page }) => {
  await page.goto('./?place=ovt:aaaaaaaa-0000-4000-8000-000000000001#18/32.0801/34.7792');
  // The places archive is found and read lazily (bucket listing, then range reads).
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/03-?523-?6058/)).toBeVisible();
  await expect(page.getByText('bistro.example', { exact: true })).toBeVisible();
  await expect(page.getByText('פייסבוק')).toBeVisible();
});

test('place card like Google: service options, kosher, Plus Code, about tab, similar places', async ({ page }) => {
  test.slow();
  await page.goto('./?place=ovt:aaaaaaaa-0000-4000-8000-000000000001#16.5/32.0801/34.7792');
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible({ timeout: 15_000 });
  const services = page.getByRole('list', { name: 'אפשרויות שירות' });
  await expect(services).toContainText('לאכול במקום');
  await expect(services).toContainText('איסוף עצמי');
  await expect(services).toContainText('אין משלוחים');
  await expect(page.getByText('Bistro HaCarmel')).toBeVisible();
  await expect(page.locator('.kosher-badge')).toHaveText('כשר');
  await expect(page.getByText('ביסטרו ים-תיכוני קטן ליד שוק הכרמל')).toBeVisible();
  await expect(page.getByRole('link', { name: 'תפריט' })).toHaveAttribute('href', 'https://bistro.example/menu');
  const code = encodePlusCode(32.0801, 34.7792);
  await expect(page.getByRole('button', { name: `Plus Code ${code.slice(4)} תל אביב - יפו, העתקה` })).toBeVisible();
  await page.getByRole('tab', { name: 'מידע כללי' }).click();
  await expect(page.getByText('Wi-Fi חינם')).toBeVisible();
  await expect(page.getByText('כרטיסי אשראי')).toBeVisible();
  await expect(page.getByText('העישון אסור')).toBeVisible();
  await page.getByRole('tab', { name: 'סקירה כללית' }).click();
  const similar = page.locator('.similar');
  await expect(similar.getByRole('heading', { name: 'אנשים מחפשים גם' })).toBeVisible({ timeout: 15_000 });
  // Same kind of place nearby; the permanently closed restaurant is left out.
  await expect(similar.getByRole('button', { name: /מסעדת הגפן/ })).toBeVisible();
  await expect(similar.getByRole('button', { name: /סגור לצמיתות/ })).toHaveCount(0);
  await similar.getByRole('button', { name: /מסעדת הגפן/ }).click();
  await expect(page.getByRole('heading', { name: 'מסעדת הגפן' })).toBeVisible();
  await expect(page).toHaveURL(/place=ovt:aaaaaaaa-0000-4000-8000-000000000009/);
});

test('send to phone shows a QR code of the link; nearby chips search around the place', async ({ page }) => {
  await page.goto('./?place=ovt:aaaaaaaa-0000-4000-8000-000000000001#16.5/32.0801/34.7792');
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'שליחה לטלפון' }).click();
  const dialog = page.getByRole('dialog', { name: 'שליחה לטלפון' });
  await expect(dialog.getByRole('img', { name: 'קוד QR של הקישור' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Escape closed only the sheet, not the card under it.
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible();
  await page.getByRole('button', { name: 'באזור' }).click();
  await page.getByRole('toolbar', { name: 'חיפוש באזור ביסטרו הכרמל' }).getByRole('button', { name: 'בתי קפה' }).click();
  await expect(page.getByRole('heading', { name: 'בתי קפה ליד ביסטרו הכרמל' })).toBeVisible();
  await expect(page.locator('.list').getByText('קפה לנדוור')).toBeVisible();
});

test('directions: fastest route badge, send to phone, and what is around the destination', async ({ page }) => {
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await expect(page.locator('.route-option')).toHaveCount(2);
  await expect(page.locator('.route-option').first().locator('.route-badge')).toHaveText('המסלול הכי מהיר');
  await expect(page.locator('.route-badge')).toHaveCount(1);
  await page.getByRole('button', { name: 'שליחת המסלול לטלפון' }).click();
  await expect(page.getByRole('dialog', { name: 'שליחה לטלפון' }).getByRole('img', { name: 'קוד QR של הקישור' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click();
  const around = page.locator('.around-dest');
  await expect(around.getByRole('heading', { name: /^מה יש באזור/ })).toBeVisible();
  await around.getByRole('button', { name: 'בתי קפה' }).click();
  await expect(page.locator('.list').getByText('קפה תמיד')).toBeVisible();
  // Back returns to the route.
  await page.getByRole('button', { name: 'חזרה' }).first().click();
  await expect(page.locator('.route-option')).toHaveCount(2);
});

test('tapping a business on the map opens its card', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the visual centre is easy to compute beside the side panel');
  await page.goto('./#18/32.0801/34.7792');
  // The side panel takes 408px on the right, so the map's centre is at x = (1280 - 408) / 2.
  // The places archive loads lazily: wait until the business is drawn there before tapping it.
  type Q = { map: { queryRenderedFeatures(b: [[number, number], [number, number]], o: { layers: string[] }): unknown[] } };
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Q).map.queryRenderedFeatures([[426, 390], [446, 410]], { layers: ['ovt-poi'] }).length), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(300);
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

test('traffic: no TomTom or HERE key, no traffic toggle and no traffic requests', async ({ page }) => {
  const tomtom: string[] = [];
  page.on('request', (r) => (r.url().startsWith('https://api.tomtom.com/') || /^https:\/\/[a-z.]*hereapi\.com\//.test(r.url())) && tomtom.push(r.url()));
  await page.goto('./#14/32.08/34.79');
  await page.getByRole('button', { name: 'שכבות' }).click();
  await expect(page.getByRole('button', { name: 'תחבורה ציבורית' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'תנועה', exact: true })).toHaveCount(0);
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await expect(page.locator('.route-option .route-time').first()).toContainText('4 דק׳');
  await expect(page.locator('.route-traffic')).toHaveCount(0);
  expect(tomtom).toEqual([]);
});

test('traffic (TomTom key): live traffic layer with credits, incident details and traffic-aware car time', async ({ page }) => {
  test.slow(); // three screens and two page loads
  const tomtom: string[] = [];
  page.on('request', (r) => r.url().startsWith('https://api.tomtom.com/') && tomtom.push(new URL(r.url()).pathname));
  // ?tomtom= works on localhost only; the stubs answer for the key "test".
  await page.goto('./?tomtom=test#15/32.08/34.792');
  await page.getByRole('button', { name: 'שכבות' }).click();
  const toggle = page.getByRole('button', { name: 'תנועה', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => tomtom.some((p) => p.startsWith('/traffic/map/4/tile/flow/relative/'))).toBe(true);
  await expect.poll(() => tomtom.some((p) => p.startsWith('/traffic/map/4/tile/incidents/'))).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('TomTom');
  await page.getByRole('region', { name: 'לוח מידע' }).getByLabel('חזרה').click();

  // Tap the accident icon.
  type W = { map: { queryRenderedFeatures(o: { layers: string[] }): unknown[]; project(p: [number, number]): { x: number; y: number } } };
  await page.waitForFunction(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['traffic-incidents'] }).length > 0);
  const at = await page.evaluate(() => (window as unknown as W).map.project([34.792, 32.08]));
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect(page.getByRole('heading', { name: 'תאונה' })).toBeVisible();
  await expect(page.getByText('תאונה בנתיב השמאלי')).toBeVisible();
  await expect(page.getByText('כביש 20 · ממחלף השלום עד מחלף ארלוזורוב')).toBeVisible();
  await expect(page.getByText('עיכוב: 7 דק׳')).toBeVisible();

  // Traffic-aware time next to Valhalla's.
  await page.goto('./?tomtom=test&route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await expect(page.locator('.route-option .route-traffic').first()).toHaveText('עם תנועה: 7 דק׳');
  expect(tomtom.some((p) => p.startsWith('/routing/1/calculateRoute/'))).toBe(true);
});

test('traffic (HERE key, Israel): HERE flow and incidents with credits, details and traffic-aware car time', async ({ page }) => {
  test.slow(); // three screens and two page loads
  const here: string[] = [];
  const tomtom: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.host.endsWith('hereapi.com')) here.push(u.host + u.pathname);
    if (u.host === 'api.tomtom.com') tomtom.push(u.pathname);
  });
  // ?here= works on localhost only; the stubs answer for the key "test".
  await page.goto('./?here=test#15/32.088/34.792');
  await page.getByRole('button', { name: 'שכבות' }).click();
  const toggle = page.getByRole('button', { name: 'תנועה', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('תנועה בזמן אמת מ-HERE')).toBeVisible();
  await expect.poll(() => here.some((p) => p.startsWith('traffic.vector.hereapi.com/v2/traffictiles/traffic/mc/'))).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('HERE');
  await page.getByRole('region', { name: 'לוח מידע' }).getByLabel('חזרה').click();

  // One icon per incident (the secondary point is filtered out); tap it.
  type W = { map: { queryRenderedFeatures(o: { layers: string[] }): unknown[]; project(p: [number, number]): { x: number; y: number } } };
  await page.waitForFunction(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['traffic-incidents'] }).length > 0);
  expect(await page.evaluate(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['traffic-incidents'] }).length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as W).map.queryRenderedFeatures({ layers: ['traffic-flow'] }).length)).toBeGreaterThan(0);
  const at = await page.evaluate(() => (window as unknown as W).map.project([34.792, 32.088]));
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await expect(page.getByRole('heading', { name: 'תאונה' })).toBeVisible();
  await expect(page.getByText('תאונה בין מחלף ארלוזורוב למחלף רוקח')).toBeVisible();
  await expect(page.getByText('כביש 20 · ממחלף ארלוזורוב עד מחלף רוקח')).toBeVisible();
  await expect(page.getByText('מידע על תנועה: HERE')).toBeVisible();
  expect(here).toContain('data.traffic.hereapi.com/v7/incidents');

  // With both keys, Israel still uses HERE for the traffic-aware time.
  await page.goto('./?here=test&tomtom=test&route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await expect(page.locator('.route-option .route-traffic').first()).toHaveText('עם תנועה: 9 דק׳');
  expect(here).toContain('router.hereapi.com/v8/routes');
  expect(tomtom).toEqual([]);
});

test('public transport directions show lines, live times and steps', async ({ page }) => {
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=transit');
  await expect(page.locator('.transit-option')).toHaveCount(2);
  const first = page.locator('.transit-option').first();
  await expect(first.locator('.line-chip')).toContainText('18');
  await expect(first).toContainText('בזמן אמת');
  await page.getByRole('button', { name: 'שלבים' }).click();
  await expect(page.getByText('לכיוון תחנה מרכזית')).toBeVisible();
  await expect(page.getByText('3 תחנות')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Waze' })).toHaveAttribute('href', /waze\.com\/ul\?ll=32\.0745,34\.7918/);
});

test('departures near me list the next buses', async ({ page }) => {
  await page.goto('./#16/32.0779/34.7752');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'יציאות קרובות' }).click();
  await expect(page.getByText('לכיוון בת ים')).toBeVisible();
  await expect(page.locator('.departure').first().locator('.dep-time')).toHaveClass(/live/);
  await expect(page.locator('.departure')).toHaveCount(3);
});

test('a stop on the way is kept in the link', async ({ page }) => {
  await page.goto('./?route=34.7741,32.0787;34.7850,32.0765;34.7918,32.0745');
  await expect(page.getByRole('textbox', { name: 'עצירה 1' })).toBeVisible();
  await expect(page.locator('.route-option').first()).toBeVisible();
  await page.getByRole('button', { name: 'הסרת עצירה 1' }).click();
  await expect(page).toHaveURL(/route=34\.7741,32\.0787;34\.7918,32\.0745/);
});

test('typos: shows results for the corrected query, and can search as typed instead', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => r.url().startsWith('https://photon.komoot.io/api') && asked.push(new URL(r.url()).searchParams.get('q') ?? ''));
  await page.goto('./#15/32.08/34.78');
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  // The fixture's Photon knows "קפה", not "קפע".
  await box.fill('קפע');
  await box.press('Enter');
  const note = page.locator('.did-you-mean');
  await expect(note).toContainText('מציג תוצאות עבור');
  await expect(note.locator('b')).toHaveText('קפה');
  await expect(page.locator('.list').getByText('קניון עזריאלי')).toBeVisible();
  await expect(page).toHaveURL(/q=%D7%A7%D7%A4%D7%A2/);
  expect(asked).toContain('קפה');
  await note.getByRole('button', { name: /חפש במקום זאת/ }).click();
  await expect(page.getByText('לא מצאנו תוצאות.')).toBeVisible();
  await expect(page.locator('.did-you-mean')).toBeHidden();
});

test('typos: suggestions show the corrected place with the typed part in bold', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' }).fill('עזראלי');
  const option = page.getByRole('option').filter({ hasText: 'קניון עזריאלי' });
  await expect(option).toBeVisible();
  await expect(option.locator('.li-title b')).toHaveText('עזריאלי');
  await option.click();
  await expect(page.getByRole('heading', { name: 'קניון עזריאלי' })).toBeVisible();
});

test('typos: a misspelled street with its city, or typed on the English layout, opens the place card', async ({ page }) => {
  await page.goto('./');
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  await box.fill('דיזנגוב תל אביב');
  await box.press('Enter');
  await expect(page.getByRole('heading', { name: 'דיזנגוף' })).toBeVisible();
  await expect(page).toHaveURL(/place=osm:w1001/);
  await page.goto('./');
  await box.fill('shzbdu;');
  await box.press('Enter');
  await expect(page.getByRole('heading', { name: 'דיזנגוף' })).toBeVisible();
});

test('category near a place: "בתי קפה ליד עזראלי" lists cafes around Azrieli', async ({ page }) => {
  await page.goto('./#13/32.1/34.85');
  const overpass = page.waitForRequest((r) => r.url().includes('overpass') && decodeURIComponent(r.postData() ?? '').includes('"amenity"="cafe"'));
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  await box.fill('בתי קפה ליד עזראלי');
  await box.press('Enter');
  const body = decodeURIComponent((await overpass).postData() ?? '');
  // The box is around Azrieli (32.0745, 34.7918), not the map centre.
  const box4 = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(body)!.slice(1).map(Number);
  expect(box4[0]).toBeLessThan(32.0745);
  expect(box4[2]).toBeGreaterThan(32.0745);
  expect(box4[1]).toBeLessThan(34.7918);
  expect(box4[3]).toBeGreaterThan(34.7918);
  await expect(page.locator('.list').getByText('קפה לנדוור')).toBeVisible();
  await expect(page.locator('.near-line')).toHaveText('בתי קפה ליד קניון עזריאלי');
  await expect(page).toHaveURL(/q=/);
});

test('category chip finds nearby cafes', async ({ page }) => {
  await page.goto('./#15/32.08/34.78');
  await page.getByRole('button', { name: 'בתי קפה' }).click();
  await expect(page.getByText('קפה לנדוור')).toBeVisible();
});

test('"open now" filter keeps open places and says how many had no hours', async ({ page }) => {
  await page.goto('./#15/32.08/34.78');
  await page.getByRole('button', { name: 'בתי קפה' }).click();
  const list = page.locator('.list');
  await expect(list.getByText('קפה לנדוור')).toBeVisible();
  await expect(list.getByText('קפה אף פעם')).toBeVisible();
  await expect(list.getByText('סגור', { exact: true })).toBeVisible();
  await page.locator('.result-filters').getByRole('button', { name: 'פתוח עכשיו' }).click();
  await expect(page.locator('.result-filters').getByRole('button', { name: 'פתוח עכשיו' })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByText('קפה תמיד')).toBeVisible();
  await expect(list.getByText('קפה לנדוור')).toBeHidden();
  await expect(list.getByText('קפה אף פעם')).toBeHidden();
  await expect(page.getByText('תוצאה אחת ללא שעות פתיחה ידועות הוסתרה')).toBeVisible();
  await expect(page).toHaveURL(/cat=cafe&filter=open/);
  // The filtered list is shareable.
  await page.reload();
  await expect(page.locator('.list').getByText('קפה תמיד')).toBeVisible();
  await expect(page.locator('.list').getByText('קפה לנדוור')).toBeHidden();
});

test('moving the map offers "search this area" and runs the search again', async ({ page }, info) => {
  await page.goto('./#15/32.08/34.78');
  await page.getByRole('button', { name: 'בתי קפה' }).click();
  await expect(page.locator('.list').getByText('קפה לנדוור')).toBeVisible();
  const pill = page.getByRole('button', { name: 'חיפוש באזור הזה' });
  await expect(pill).toBeHidden();
  // Drag the map well past a third of its width (on phones, above the half-open sheet).
  const desktop = info.project.name === 'desktop';
  const y = desktop ? 400 : 230;
  const [x0, x1] = desktop ? [80, 480] : [40, 330];
  await page.mouse.move(x0, y);
  await page.mouse.down();
  // Few steps: each pointer move re-renders the map, which is slow with software WebGL in CI.
  await page.mouse.move(x1, y, { steps: 3 });
  await page.mouse.up();
  await expect(pill).toBeVisible();
  const again = page.waitForRequest((r) => r.url().includes('overpass') && decodeURIComponent(r.postData() ?? '').includes('"amenity"="cafe"'));
  await pill.click();
  await again;
  await expect(pill).toBeHidden();
  await expect(page.locator('.list').getByText('קפה לנדוור')).toBeVisible();
});

test('typing a business name suggests Overture places loaded on the map', async ({ page }) => {
  await page.goto('./#17/32.0801/34.7792');
  await page.waitForTimeout(1500);
  await page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' }).fill('ביסטרו');
  const option = page.getByRole('option').filter({ hasText: 'ביסטרו הכרמל' });
  await expect(option).toBeVisible();
  await expect(option).toContainText('מסעדה');
  await option.click();
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible();
  await expect(page).toHaveURL(/place=ovt:aaaaaaaa-0000-4000-8000-000000000001/);
});

test('pasting a Google Maps link drops a pin there', async ({ page }) => {
  await page.goto('./#13/32.07/34.79');
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  await box.focus();
  await box.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, 'https://www.google.com/maps/@32.0853,34.7818,16z');
  await expect(page).toHaveURL(/place=pt:34\.78180,32\.08530/);
  await expect(page.getByRole('heading', { name: 'דיזנגוף' })).toBeVisible();
  await expect(page).toHaveURL(/#16\/32\.085\d*\/34\.781\d*/);
});

test('typed Waze link opens on Enter; short links explain what to do', async ({ page }) => {
  await page.goto('./');
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  await box.fill('https://maps.app.goo.gl/AbCdEf');
  await expect(page.getByText('קישור מקוצר לא נפתח ישירות')).toBeVisible();
  await expect(page.getByText(/העתיקו את הכתובת המלאה/)).toBeVisible();
  await box.fill('https://waze.com/ul?ll=32.0745%2C34.7918&navigate=yes');
  await expect(page.getByRole('option').filter({ hasText: 'המיקום מהקישור' })).toBeVisible();
  await box.press('Enter');
  await expect(page).toHaveURL(/place=pt:34\.79180,32\.07450/);
});

test.describe('with location', () => {
  test.use({ geolocation: { latitude: 32.0787, longitude: 34.7741 }, permissions: ['geolocation'] });

  test('turn-by-turn navigation (simulated drive) shows hebrew instructions and exits cleanly', async ({ page }) => {
    await page.goto('./?route=me;34.7918,32.0745&mode=car&simulate=1');
    await page.getByRole('button', { name: /יציאה לדרך/ }).click();
    const banner = page.locator('.nav-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('פנו ימינה אל דרך מנחם בגין');
    await expect(page.locator('.nav-eta .nav-left')).toHaveText(/דק׳/);
    await expect(page.locator('.nav-eta .nav-arrive')).toHaveText(/^\d{2}:\d{2}$/);
    await page.getByRole('button', { name: 'יציאה', exact: true }).click();
    await expect(banner).toBeHidden();
    await expect(page.getByRole('button', { name: /יציאה לדרך/ })).toBeVisible();
  });
});

test.describe('navigation mode', () => {
  test.use({ geolocation: { latitude: 32.0787, longitude: 34.7741 }, permissions: ['geolocation'] });

  test('the start button is on screen without scrolling the route card', async ({ page }) => {
    await page.goto('./?route=me;34.7918,32.0745&mode=car');
    await expect(page.getByRole('button', { name: /יציאה לדרך/ })).toBeInViewport();
  });

  test('one tap on "ניווט" in a place card starts navigation; panning offers re-center and an overview', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' }).fill('עזריאלי');
    await page.getByRole('option').filter({ hasText: 'קניון עזריאלי' }).click();
    await page.getByRole('button', { name: 'ניווט', exact: true }).click();
    await expect(page.locator('.nav-banner')).toContainText('פנו ימינה אל דרך מנחם בגין');
    await expect(page.getByRole('button', { name: 'מרכז מחדש' })).toBeHidden();
    await page.getByRole('button', { name: 'סקירת המסלול' }).click();
    await expect(page.getByRole('button', { name: 'מרכז מחדש' })).toBeVisible();
    await page.getByRole('button', { name: 'מרכז מחדש' }).click();
    await expect(page.getByRole('button', { name: 'מרכז מחדש' })).toBeHidden();
    await page.getByRole('button', { name: 'יציאה', exact: true }).click();
    await expect(page.locator('.nav-banner')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'קניון עזריאלי' })).toBeVisible();
  });
});

test('dark mode and units from settings persist across reloads', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'הגדרות', exact: true }).click();
  await page.getByRole('button', { name: 'כהה' }).click();
  await page.getByRole('button', { name: 'מיילים' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'הגדרות', exact: true }).click();
  await expect(page.getByRole('button', { name: 'מיילים' })).toHaveAttribute('aria-pressed', 'true');
});

test('measure distance: two taps on the map show the distance', async ({ page }) => {
  await page.goto('./#15/32.08/34.78');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'מדידת מרחק' }).click();
  const value = page.locator('.measure-value');
  await expect(value).toHaveText('מדידת מרחק');
  await page.waitForTimeout(500);
  const { width, height } = page.viewportSize()!;
  await page.mouse.click(Math.round(width * 0.2), Math.round(height * 0.35));
  await expect(page.locator('.measure-sub')).toHaveText('לחצו על נקודה נוספת במפה');
  await page.mouse.click(Math.round(width * 0.45), Math.round(height * 0.45));
  await expect(value).toHaveText(/^\d[\d.,]* (מ׳|ק״מ)$/);
  await expect(page).toHaveURL(/panel=measure/);
  await page.getByRole('button', { name: 'בטל נקודה אחרונה' }).click();
  await expect(value).toHaveText('מדידת מרחק');
  await page.getByRole('button', { name: 'סגירת המדידה' }).click();
  await expect(value).toBeHidden();
});

test('save map image downloads a PNG on desktop', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'phones open the share sheet instead');
  await page.goto('./#15/32.08/34.78');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'תפריט' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'שמירת תמונת מפה' }).click();
  expect((await download).suggestedFilename()).toMatch(/^nadav-maps-.*\.png$/);
  await expect(page.getByText('תמונת המפה נשמרה')).toBeVisible();
});

test('keyboard shortcuts on desktop: ? opens the help, Escape closes it, M measures', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard shortcuts are for computers');
  await page.goto('./');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'קיצורי מקלדת' })).toBeVisible();
  await expect(page.getByText('מדידת מרחק')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'קיצורי מקלדת' })).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('.measure-value')).toHaveText('מדידת מרחק');
  await page.keyboard.press('Escape');
  await expect(page.locator('.measure-value')).toBeHidden();
  // Typing in the search box never triggers a shortcut.
  await page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' }).fill('m?');
  await expect(page.getByRole('heading', { name: 'קיצורי מקלדת' })).toBeHidden();
  await expect(page.locator('.measure-value')).toBeHidden();
});

/** The bits of the MapLibre map (window.map) the flight tests read. */
type MapLike = {
  getLayer(id: string): unknown;
  getLayoutProperty(id: string, name: string): unknown;
  queryRenderedFeatures(o: { layers: string[] }): { properties: Record<string, unknown> }[];
};

test.describe('flight mode', () => {
  // These wait on the map rendering; give a loaded machine room.
  test.setTimeout(90_000);
  const worldVisible = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const map = (window as unknown as { map: MapLike }).map;
      return !!map.getLayer('world-land') && map.getLayoutProperty('world-land', 'visibility') === 'visible';
    });
  const renderedCities = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const map = (window as unknown as { map: MapLike }).map;
      return map.queryRenderedFeatures({ layers: ['world-city-label'] }).map((f) => String(f.properties.name));
    });

  test('flight: live readouts, what is below, a destination with ETA, the plane on the map', async ({ page }) => {
    await fakeGps(page, FLIGHT_FIXES);
    await page.goto('./#8/32.08/34.78');
    await page.getByRole('button', { name: 'תפריט' }).click();
    await page.getByRole('button', { name: 'מצב טיסה' }).click();
    await expect(page).toHaveURL(/panel=flight/);
    await expect(page.locator('.flight-gps')).toHaveText('GPS פעיל');
    const stat = (label: string) => page.locator('.flight-stat').filter({ hasText: label });
    await expect(stat('מהירות קרקע')).toContainText('864');
    await expect(stat('מהירות קרקע')).toContainText('467 קשר');
    await expect(stat('גובה')).toContainText('11,000');
    await expect(stat('גובה')).toContainText('36,089 רגל');
    await expect(stat('כיוון')).toContainText('285°');
    await expect(stat('כיוון')).toContainText('מערב');
    await expect(page.locator('.flight-above-title')).toHaveText('יוון');
    await expect(stat('מרחק שעברתם')).not.toContainText(/^מרחק שעברתם0/);
    // Destination from the bundled airports, offline-capable.
    await page.getByRole('button', { name: 'בחירת יעד' }).click();
    await page.getByRole('searchbox', { name: 'חיפוש יעד' }).fill('TLV');
    await page.getByRole('button', { name: /Ben Gurion/ }).click();
    await expect(page.locator('.flight-dest-line')).toContainText(/נשארו \d[\d,]* ק״מ/);
    await expect(page.locator('.flight-dest-line')).toContainText(/נחיתה משוערת \d{2}:\d{2}/);
    // The plane, its track and the great circle toward the destination are on the map.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = (window as unknown as { map: MapLike }).map;
          return ['flight-plane', 'flight-track', 'flight-route'].map((id) => map.queryRenderedFeatures({ layers: [id] }).length > 0);
        }),
        { timeout: 15_000 },
      )
      .toEqual([true, true, true]);
    // Flight mode shows the bundled world map instead of the normal one.
    expect(await worldVisible(page)).toBe(true);
    await page.getByRole('button', { name: 'יציאה ממצב טיסה' }).click();
    await expect(page.locator('.flight')).toBeHidden();
    expect(await worldVisible(page)).toBe(false);
  });

  test('flight: before the first GPS fix it explains what to do', async ({ page }) => {
    await fakeGps(page, []);
    await page.goto('./?panel=flight');
    await expect(page.getByText('מחפשים אות GPS…')).toBeVisible();
    await expect(page.getByText(/שבו ליד החלון/)).toBeVisible();
    await expect(page.locator('.flight-stat').filter({ hasText: 'גובה' })).toContainText('—');
  });

  test('flight offline: tiles fail and the bundled world map still renders', async ({ page }) => {
    // No network for the map: the tile index, tiles and fonts all fail.
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort('internetdisconnected'));
    await page.goto('./#5.5/32/34.8');
    await expect.poll(() => worldVisible(page), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => renderedCities(page), { timeout: 15_000 }).toContain('ירושלים');
    // And in flight mode, with GPS over Greece.
    await fakeGps(page, FLIGHT_FIXES);
    await page.goto('./?panel=flight#5/38/23');
    await expect(page.locator('.flight-above-title')).toHaveText('יוון');
    await expect.poll(() => renderedCities(page), { timeout: 15_000 }).toContain('אתונה');
  });

  test('flight: find my flight by number when there is no GPS (ADS-B)', async ({ page }) => {
    await fakeGps(page, []);
    const asked: string[] = [];
    await page.route('https://api.adsb.lol/**', (r) => {
      const cs = r.request().url().split('/').pop()!;
      asked.push(cs);
      return r.fulfill({ json: cs === 'ELY001' ? adsbResponse() : { ac: [], total: 0 }, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('./?panel=flight');
    await page.getByRole('textbox', { name: 'מספר טיסה' }).fill('ly001');
    await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
    await expect(page.locator('.flight-adsb')).toContainText('ELY001');
    await expect(page.locator('.flight-adsb')).toContainText('B789');
    await expect(page.locator('.flight-gps')).toHaveText('לפי ADS-B');
    await expect(page.locator('.flight-stat').filter({ hasText: 'גובה' })).toContainText('11,476');
    await expect(page.locator('.flight-stat').filter({ hasText: 'מהירות קרקע' })).toContainText('893');
    // Only the flight number left the device.
    expect(asked).toEqual(['ELY1', 'ELY001']);
  });
});

test('live flights: planes around the map close up, a plane card, and the whole world from OpenSky', async ({ page }) => {
  test.setTimeout(90_000);
  const cors = { 'access-control-allow-origin': '*' };
  const asked: string[] = [];
  await page.route('https://api.adsb.lol/**', (r) => {
    const url = r.request().url();
    asked.push(url);
    return r.fulfill({ json: adsbAreaResponse(), headers: cors });
  });
  await page.route('https://adsb.im/api/0/routeset', (r) => r.fulfill({ json: routesetResponse(), headers: cors }));
  await page.route('https://opensky-network.org/**', (r) => {
    asked.push(r.request().url());
    return r.fulfill({ json: openskyResponse(Math.floor(Date.now() / 1000)), headers: cors });
  });
  // One tap on the round map button, from the home screen.
  await page.goto('./#9/32.05/34.75');
  await page.getByRole('button', { name: 'טיסות בזמן אמת' }).click();
  await expect(page).toHaveURL(/panel=flights/);
  await expect(page.getByRole('heading', { name: 'טיסות בעולם' })).toBeVisible();
  await expect(page.getByLabel('צבע המטוס לפי גובה')).toBeVisible();
  await expect(page.locator('.live-status')).toContainText('מטוס אחד באוויר במפה');
  await expect(page.locator('.live-status')).toContainText('1 על הקרקע');
  await expect(page.locator('.live-status')).toContainText('adsb.lol');
  // Close up only the visible area goes to adsb.lol, as one circle.
  expect(asked.find((u) => u.includes('/v2/point/'))).toMatch(/^https:\/\/api\.adsb\.lol\/v2\/point\/[\d.]+\/[\d.]+\/\d+$/);

  // Tap the plane in the air.
  const planeAt = () => page.evaluate(() => {
    const map = (window as unknown as { map: MapLike & { project(p: number[]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } }).map;
    const f = map.queryRenderedFeatures({ layers: ['live-flights-planes'] }).find((x) => x.properties.cs === 'ELY001') as unknown as { geometry: { coordinates: number[] } } | undefined;
    if (!f) return null;
    const p = map.project(f.geometry.coordinates);
    const r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await expect.poll(planeAt, { timeout: 15_000 }).not.toBeNull();
  const at = (await planeAt())!;
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.live-callsign')).toHaveText('ELY001');
  await expect(page.locator('.live-model')).toContainText('BOEING 787-9 Dreamliner');
  await expect(page.locator('.live-model')).toContainText('4X-EDF');
  await expect(page.locator('.flight-stat').filter({ hasText: 'גובה' })).toContainText('2,789');
  await expect(page.locator('.flight-stat').filter({ hasText: 'גובה' })).toContainText('עולה');
  await expect(page.getByRole('button', { name: 'המפה עוקבת' })).toBeVisible();
  // Where it flies: from the crowd-sourced route database.
  await expect(page.locator('.live-route')).toContainText('TLV');
  await expect(page.locator('.live-route')).toContainText('JFK');
  await expect(page.locator('.live-route')).toContainText('נשארו');
  await page.getByRole('button', { name: 'סגירה' }).click();

  // The whole world: OpenSky, one call without a box.
  await page.getByRole('button', { name: 'כל העולם' }).click();
  await expect(page.locator('.live-status')).toContainText('OpenSky', { timeout: 15_000 });
  await expect(page.locator('.live-status')).toContainText('2 מטוסים באוויר במפה');
  expect(asked.some((u) => u.startsWith('https://opensky-network.org/api/states/all'))).toBe(true);

  // The map button closes it again and clears the planes.
  await page.getByRole('button', { name: 'הסתרת הטיסות' }).click();
  await expect(page.getByRole('heading', { name: 'טיסות בעולם' })).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { map: MapLike }).map.queryRenderedFeatures({ layers: ['live-flights-planes'] }).length))
    .toBe(0);
});

test('live flights: the whole world from the relay, a shape per kind, filters, an emergency, saving a flight', async ({ page }) => {
  test.setTimeout(180_000);
  const cors = { 'access-control-allow-origin': '*' };
  const bodies: Record<string, unknown>[] = [];
  await page.route('https://relay.test/flights', async (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (body.world) return r.fulfill({ json: worldResponse(), headers: cors });
    return r.fulfill({ json: { ac: [] }, headers: cors });
  });
  await page.goto('./?panel=flights&flightsrelay=https://relay.test/flights#1.3/25/20');
  await expect(page.locator('.live-status')).toContainText('8 מטוסים באוויר במפה', { timeout: 15_000 });
  await expect(page.locator('.live-status')).toContainText('1 על הקרקע');
  await expect(page.locator('.live-status')).toContainText('adsb.lol · adsb.fi');
  // Only the map area went out, as a box, in the request body.
  const box = bodies.find((b) => b.world)!.world as number[];
  expect(box).toHaveLength(4);
  expect(box[2] - box[0]).toBeGreaterThan(90);
  // Every plane is drawn with the shape of its kind.
  const icons = () =>
    page.evaluate(() =>
      [
        ...new Map(
          (window as unknown as { map: { querySourceFeatures(s: string): { properties: { hex: string; i: string } }[] } }).map
            .querySourceFeatures('live-flights')
            .map((f) => [f.properties.hex, f.properties.i.replace(/-\d+$/, '')]),
        ).values(),
      ].sort(),
    );
  await expect.poll(icons, { timeout: 15_000 }).toEqual(
    ['live-bizjet', 'live-fighter', 'live-glider', 'live-heavy', 'live-heavy', 'live-heavy', 'live-heli', 'live-jet', 'live-prop'],
  );
  // An emergency anywhere on the map is called out; a tap opens that plane.
  await page.getByRole('button', { name: /מטוס אחד משדר מצב חירום/ }).click();
  await expect(page.locator('.live-callsign')).toHaveText('ACA870');
  await expect(page.locator('.live-emergency')).toContainText('7700');
  await expect(page.locator('.live-kind')).toContainText('מטוס רחב גוף');
  // Save it: it shows under "my flights" on this device.
  await page.getByRole('button', { name: 'שמירת הטיסה' }).click();
  await expect(page.getByRole('button', { name: 'שמורה' })).toBeVisible();
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.getByRole('region', { name: 'הטיסות שלי' })).toContainText('ACA870');
  // Opening the plane zoomed in; back out to the whole world.
  await page.getByRole('button', { name: 'כל העולם' }).click();
  await expect(page.locator('.live-status')).toContainText('8 מטוסים באוויר במפה', { timeout: 15_000 });
  // Filters: helicopters and military off, then only in the air.
  await page.getByRole('button', { name: 'סינון' }).click();
  await page.getByRole('button', { name: 'מסוקים' }).click();
  await page.getByRole('button', { name: 'צבאיים' }).click();
  await expect(page.locator('.live-status')).toContainText('6 מטוסים באוויר במפה');
  await page.getByRole('button', { name: 'רק באוויר' }).click();
  await expect(page.locator('.live-status')).not.toContainText('על הקרקע');
  await expect.poll(async () => (await icons()).length).toBe(6);
  await page.getByRole('button', { name: 'ניקוי' }).click();
  await expect(page.locator('.live-status')).toContainText('8 מטוסים באוויר במפה');
});

test('live flights: when OpenSky cannot be reached, the world view falls back to adsb.lol and says so', async ({ page }) => {
  test.setTimeout(60_000);
  const cors = { 'access-control-allow-origin': '*' };
  let opensky = 0;
  await page.route('https://api.adsb.lol/**', (r) => r.fulfill({ json: adsbAreaResponse(), headers: cors }));
  // What a browser sees when CORS or a network block stops the request.
  await page.route('https://opensky-network.org/**', (r) => {
    opensky++;
    return r.abort('failed');
  });
  await page.goto('./?panel=flights#1.5/30/20');
  await expect(page.locator('.live-note')).toContainText('לא זמין');
  await expect(page.locator('.live-status')).toContainText('מטוס אחד באוויר במפה');
  // Panning around does not keep hitting the failed source.
  await page.evaluate(() => (window as unknown as { map: { panBy(o: number[]): void } }).map.panBy([200, 0]));
  await page.waitForTimeout(1500);
  expect(opensky).toBe(1);
});

test('timeline: importing a Google Takeout file shows the day, and a visit can be renamed', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./?panel=timeline');
  await expect(page.getByRole('heading', { name: 'ציר הזמן שלי' })).toBeVisible();
  await expect(page.getByText('הקלטת ציר זמן כבויה')).toBeVisible();
  await page.getByRole('button', { name: 'הגדרות ציר הזמן' }).click();
  await page.locator('#tl-import').setInputFiles({ name: '2019_MARCH.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(TAKEOUT_FIXTURE)) });
  await expect(page).toHaveURL(new RegExp(`panel=timeline&day=${TAKEOUT_DAY}`));
  const day = page.getByRole('list', { name: 'המקומות והדרכים של היום' });
  await expect(day.getByText('מחנה יהודה')).toBeVisible();
  await expect(day.getByText('נסיעה ברכבת')).toBeVisible();
  // Times in the region's time zone (Israel, UTC+2 in March).
  await expect(day.locator('.tl-time').filter({ hasText: '13:30–15:00' })).toBeVisible();
  await expect(page.getByLabel('סיכום היום')).toContainText('4');
  // "This was…": give the café our own name.
  await day.getByRole('button', { name: 'תיקון המקום: קפה לנדוור' }).click();
  await page.getByRole('textbox', { name: 'שם משלך' }).fill('הקפה של הבוקר');
  await page.getByRole('textbox', { name: 'שם משלך' }).press('Enter');
  await expect(day.getByText('הקפה של הבוקר')).toBeVisible();
  // Everything is on the device: a reload of the shared link shows the same day.
  await page.reload();
  await expect(day.getByText('הקפה של הבוקר')).toBeVisible({ timeout: 20_000 });
  await expect(day.getByText('קניון עזריאלי')).toBeVisible();
});

test.describe('timeline with location', () => {
  test.use({ geolocation: { latitude: 32.0787, longitude: 34.7741 }, permissions: ['geolocation'] });

  test('timeline: recording is opt-in and saves location points while the app is open', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('./?panel=timeline');
    await page.getByRole('button', { name: 'הפעלה' }).click();
    await expect(page.getByText('מקליט בזמן שהאפליקציה פתוחה')).toBeVisible();
    await expect(page.getByText(/נקודה אחת נשמרה/)).toBeVisible();
    // The choice is remembered, and the home screen shows that it records.
    await page.goto('./');
    await expect(page.getByRole('button', { name: /ציר הזמן מקליט/ })).toBeVisible();
    await page.getByRole('button', { name: /ציר הזמן מקליט/ }).click();
    await page.getByRole('button', { name: 'עצירה' }).click();
    await expect(page.getByText('הקלטת ציר זמן כבויה')).toBeVisible();
  });
});

test.describe('install as an app (iPhone Safari)', () => {
  const SAFARI_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  test.use({ userAgent: SAFARI_IOS });

  test('the install guide shows once on the second visit, can be dismissed and stays away', async ({ page, context }) => {
    const dialog = (p: typeof page) => p.getByRole('dialog', { name: 'התקנה כאפליקציה' });
    // First visit: nothing pops up (a shared link should just show the map).
    await page.goto('./');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.waitForTimeout(3800);
    await expect(dialog(page)).toHaveCount(0);

    // Second visit (a new tab = a new session): the guide slides up after a moment.
    const second = await context.newPage();
    await stubNetwork(second);
    await second.goto('./');
    await expect(dialog(second)).toBeVisible({ timeout: 8000 });
    await expect(dialog(second)).toContainText('הוספה למסך הבית');
    await expect(dialog(second).locator('.install-step')).toHaveCount(3);
    await dialog(second).getByRole('button', { name: 'לא עכשיו' }).click();
    await expect(dialog(second)).toHaveCount(0);

    // Third visit: shown once is enough.
    const third = await context.newPage();
    await stubNetwork(third);
    await third.goto('./');
    await expect(third.locator('.maplibregl-canvas')).toBeVisible();
    await third.waitForTimeout(3800);
    await expect(dialog(third)).toHaveCount(0);

    // It is still in the menu.
    await third.getByRole('button', { name: 'תפריט' }).click();
    await third.getByRole('button', { name: 'התקנה כאפליקציה' }).click();
    await expect(third.getByRole('heading', { name: 'התקנה כאפליקציה' })).toBeVisible();
    await expect(third.getByText('בסרגל שבתחתית המסך')).toBeVisible();
  });

  test('inside an in-app browser the guide says to open the page in Safari', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 326.0.3.30.91 (iPhone14,5; iOS 17_4; he_IL; he; scale=3.00; 1170x2532; 584123456)',
      viewport: { width: 390, height: 844 },
      locale: 'he-IL',
      serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await stubNetwork(page);
    await page.goto('./?panel=install');
    await expect(page.getByText('אתם בתוך הדפדפן של אינסטגרם')).toBeVisible();
    await expect(page.getByRole('button', { name: 'העתקת הקישור' })).toBeVisible();
    await context.close();
  });
});

test.describe('our own map data (geodata)', () => {
  /** Requests that left for Photon or Overpass: with local data there should be none. */
  /** Public search, reverse and details lookups (a category search for "people also search" is not one). */
  function publicLookups(page: Page) {
    const urls: string[] = [];
    page.on('request', (r) => {
      if (/photon\.komoot\.io/.test(r.url())) urls.push(r.url());
      if (/overpass-api\.de/.test(r.url())) {
        const q = decodeURIComponent((r.postData() ?? '').replace(/^data=/, '').replace(/\+/g, ' '));
        if (/\b(node|way|relation)\(\d+\)|around:/.test(q)) urls.push(r.url());
      }
    });
    return urls;
  }

  test.beforeEach(async ({ page }) => {
    await stubGeodata(page);
  });

  test('geodata: an address and a business only in our data are found and opened', async ({ page }) => {
    const external = publicLookups(page);
    await page.goto('./#15/32.08/34.78');
    const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
    await box.fill('אבן גבירול 71 תל אביב');
    await page.getByRole('option').filter({ hasText: 'אבן גבירול 71' }).first().click();
    await expect(page.getByRole('heading', { name: 'אבן גבירול 71' })).toBeVisible();
    await expect(page).toHaveURL(/place=pt:34\.7819\d,32\.0818\d/);

    await page.goBack();
    await box.fill('מאפיית אורנה');
    await page.getByRole('option').filter({ hasText: 'מאפיית אורנה' }).first().click();
    await expect(page.getByRole('heading', { name: 'מאפיית אורנה' })).toBeVisible();
    await expect(page).toHaveURL(/place=osm:n7000001/);
    // Details (wheelchair access) come from our own shards, not Overpass.
    await expect(page.getByText('נגיש לכיסאות גלגלים')).toBeVisible();
    expect(external).toEqual([]);
  });

  test('geodata: a long-press names the address from our data', async ({ page }) => {
    const external = publicLookups(page);
    await page.goto('./#18/32.0818/34.78196');
    await page.waitForFunction(() => (window as unknown as { map?: { loaded(): boolean } }).map?.loaded());
    // The map's long press is its contextmenu event (a right click on desktop, a hold on touch).
    await page.evaluate(() => {
      const m = (window as unknown as { map: { fire(type: string, e: unknown): void } }).map;
      m.fire('contextmenu', { lngLat: { lng: 34.78196, lat: 32.08182 }, point: { x: 0, y: 0 }, originalEvent: new MouseEvent('contextmenu') });
    });
    await expect(page.getByRole('heading', { name: 'אבן גבירול 71' })).toBeVisible();
    await expect(page.getByText('תל אביב-יפו').first()).toBeVisible();
    expect(external).toEqual([]);
  });
});

test('our own places tiles replace Overture inside Israel', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the visual centre is easy to compute beside the side panel');
  await stubGeodata(page, { places: true });
  await page.goto('./#18/32.0801/34.7792');
  type Q = { map: { queryRenderedFeatures(b: [[number, number], [number, number]], o: { layers: string[] }): unknown[] } };
  const drawn = (layer: string) => page.evaluate((l) => (window as unknown as Q).map.queryRenderedFeatures([[426, 390], [446, 410]], { layers: [l] }).length, layer);
  await expect.poll(() => drawn('places-il'), { timeout: 15_000 }).toBeGreaterThan(0);
  // Overture's own copy of the same place is not drawn on top of ours.
  expect(await drawn('ovt-poi')).toBe(0);
  await page.waitForTimeout(300);
  await page.mouse.click(436, 400);
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible();
  await expect(page).toHaveURL(/place=ovt:aaaaaaaa-0000-4000-8000-000000000001/);
});

test('layers: bright map stays bright in dark mode, and the theme is one tap away', async ({ page }) => {
  type Q = { map: { getPaintProperty(l: string, p: string): unknown } };
  // Reads null while the new style is still loading (a theme or map type switch swaps it).
  const background = () =>
    page.evaluate(() => {
      try {
        return String((window as unknown as Q).map.getPaintProperty('background', 'background-color'));
      } catch {
        return null;
      }
    });
  await page.goto('./');
  await page.getByRole('button', { name: 'שכבות' }).click();
  await page.getByRole('group', { name: 'מצב תצוגה' }).getByRole('button', { name: 'כהה' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: 'בהיר וצבעוני' }).click();
  await expect.poll(background).toBe('#f8f4ee');
  await page.getByRole('group', { name: 'מצב תצוגה' }).getByRole('button', { name: 'בהיר' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect.poll(background).toBe('#f8f4ee');
});

test('location: once allowed, it turns on by itself at launch', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 32.0801, longitude: 34.7792, accuracy: 20 });
  // An installed iPhone app often reports "prompt" even after you allowed it: our memory decides.
  await page.addInitScript(() => {
    localStorage.setItem('nm:location:granted', 'true');
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d.name === 'geolocation' ? Promise.resolve({ state: 'prompt', onchange: null } as PermissionStatus) : query(d));
  });
  await page.goto('./');
  await expect(page.getByRole('button', { name: /המפה עוקבת אחריך|מרכוז על המיקום שלי/ })).toBeVisible();
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'הרשאות מיקום ותנועה' }).click();
  await expect(page.getByRole('heading', { name: 'הרשאות מיקום ותנועה' })).toBeVisible();
  await expect(page.locator('.perm-row').first()).toContainText('מאושר');
});
