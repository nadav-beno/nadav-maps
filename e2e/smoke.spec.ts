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
  // The places archive is found and read lazily (bucket listing, then range reads).
  await expect(page.getByRole('heading', { name: 'ביסטרו הכרמל' })).toBeVisible({ timeout: 15_000 });
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

test('traffic: no TomTom key, no traffic toggle and no TomTom requests', async ({ page }) => {
  const tomtom: string[] = [];
  page.on('request', (r) => r.url().startsWith('https://api.tomtom.com/') && tomtom.push(r.url()));
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
