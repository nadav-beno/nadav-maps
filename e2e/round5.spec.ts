import { expect, test } from '@playwright/test';
import { ROUTE_LINE, stubNetwork } from './stubs.ts';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

const AZRIELI = '?place=osm:n2002#17/32.0745/34.7918';

test('directions: route tags, why each route, avoid options per mode, motorcycle', async ({ page }) => {
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=car');
  const options = page.locator('.route-option');
  await expect(options.first()).toContainText('כביש אגרה');
  await expect(options.first()).toContainText('המסלול הכי מהיר');
  await expect(options.nth(1)).toContainText(/ארוך ב-\d+ דק׳/);
  await expect(options.nth(1)).toContainText('בלי כביש אגרה');
  await page.getByRole('button', { name: 'אפשרויות מסלול' }).click();
  await expect(page.getByRole('checkbox', { name: 'בלי מעבורות' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'בלי דרכי עפר' })).toBeVisible();
  await page.getByRole('button', { name: 'הליכה' }).click();
  await expect(page.getByRole('checkbox', { name: /בלי מדרגות/ })).toBeVisible();
  await page.getByRole('button', { name: 'אופנוע' }).click();
  await expect(page).toHaveURL(/mode=motorcycle/);
  await expect(page.locator('.route-option').first()).toBeVisible();
});

test('directions: stops can be reordered from the keyboard', async ({ page }) => {
  await page.goto('./?route=34.7741,32.0787;34.7850,32.0765;34.7918,32.0745&mode=car');
  const fields = page.locator('.endpoint-fields .point-input input');
  await expect(fields).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^שינוי סדר/ })).toHaveCount(3);
  const handle = page.getByRole('button', { name: /^שינוי סדר/ }).nth(1);
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  // The stop moved to the end: the URL's last point is now the old stop.
  await expect(page).toHaveURL(/route=34\.7741,32\.0787;34\.7918,32\.0745;34\.785,32\.0765/);
});

test('preview drive: speed limit, speedometer, lane arrows and search along the route', async ({ page }) => {
  test.slow();
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await page.getByRole('button', { name: 'תצוגה מקדימה' }).click();
  await expect(page.getByText('תצוגה מקדימה', { exact: true })).toBeVisible();
  await expect(page.getByLabel('מהירות מותרת 50')).toBeVisible();
  await expect(page.locator('.speedometer')).toContainText('קמ״ש');
  // Lane arrows appear 800 m before the turn (the preview drives there in a few seconds).
  await expect(page.getByLabel('נתיבים').locator('.lane')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByLabel('נתיבים').locator('.lane.valid')).toHaveCount(1);
  await page.getByRole('button', { name: 'חיפוש לאורך המסלול' }).click();
  await page.getByRole('button', { name: 'דלק' }).click();
  const hit = page.locator('.along-list .list-item').filter({ hasText: 'פז בגין' });
  await expect(hit).toContainText(/\+\d+ דק׳/);
  await page.getByRole('button', { name: 'הגדרות ניווט' }).click();
  await expect(page.getByRole('combobox', { name: /תצוגת המפה/ })).toBeVisible();
  await page.getByRole('button', { name: 'יציאה', exact: true }).click();
  await expect(page.locator('.nav-banner')).toBeHidden();
});

test('a navigation cut short by the browser offers to resume', async ({ page }) => {
  await page.addInitScript((line) => {
    const route = { mode: 'car', distanceM: 1550, durationS: 240, geometry: line, steps: [{ type: 1, instruction: 'צאו לדרך', distanceM: 450, durationS: 60, shapeIndex: 0 }] };
    localStorage.setItem('nm:nav:active', JSON.stringify({ route, destination: { id: 'osm:n2002', name: 'קניון עזריאלי', lng: 34.7918, lat: 32.0745 }, vias: [], at: Date.now() }));
  }, ROUTE_LINE);
  await page.goto('./');
  await expect(page.getByText('להמשיך בניווט אל קניון עזריאלי?')).toBeVisible();
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.locator('.nav-banner')).toBeVisible();
});

test('saved parking spot shows on the home screen and can be cleared', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nm:parking', JSON.stringify({ lng: 34.7918, lat: 32.0745, at: Date.now() - 20 * 60000, near: 'קניון עזריאלי' })));
  await page.goto('./');
  const card = page.getByLabel('החניה שלך');
  await expect(card).toContainText('החניה שלך ליד קניון עזריאלי');
  await expect(card).toContainText('לפני 20 דק׳');
  await card.getByRole('button', { name: 'מחיקת מקום החניה' }).click();
  await expect(card).toBeHidden();
});

test('search filters: cuisine, accessible, update with the map', async ({ page }) => {
  await page.goto('./?cat=cafe#16/32.0800/34.7770');
  await expect(page.getByRole('heading', { name: 'בתי קפה' })).toBeVisible();
  const filters = page.getByRole('toolbar', { name: 'סינון תוצאות' });
  await expect(filters.getByRole('button', { name: 'עדכון לפי המפה' })).toBeVisible();
  await filters.getByRole('button', { name: 'נגיש' }).click();
  await expect(page.locator('.result-title')).toHaveText(['קפה תמיד']);
  await expect(page).toHaveURL(/filter=access/);
  await filters.getByRole('button', { name: 'נגיש' }).click();
  await expect(page.locator('.result-title')).toHaveCount(3);
  await filters.getByRole('button', { name: 'בית קפה' }).click();
  await expect(page.locator('.result-title')).toHaveCount(2);
});

test('suggestions show the distance and an arrow that fills the box', async ({ page }) => {
  await page.goto('./#15/32.0787/34.7741');
  const box = page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' });
  await box.fill('עזריאלי');
  const option = page.getByRole('option').filter({ hasText: 'קניון עזריאלי' });
  await expect(option.locator('.sugg-dist')).toHaveText(/ק״מ|מ׳/);
  await option.getByRole('button', { name: 'השלמה: קניון עזריאלי' }).click();
  await expect(box).toHaveValue('קניון עזריאלי');
});

test('place card: free photos from Commons open a gallery with author and licence', async ({ page }) => {
  await page.goto(`./${AZRIELI}`);
  await expect(page.getByRole('heading', { name: 'קניון עזריאלי' })).toBeVisible();
  await page.getByRole('button', { name: '2 תמונות' }).click();
  await expect(page.getByRole('heading', { name: 'תמונות: קניון עזריאלי' })).toBeVisible();
  await page.getByRole('button', { name: 'Azrieli towers' }).click();
  await expect(page.locator('.photo-full figcaption')).toContainText('דנה כהן · CC BY-SA 4.0');
});

test('a mall mapped as an area has a directory with floors', async ({ page }) => {
  await page.goto('./?place=osm:w7007#17/32.0745/34.7918');
  await expect(page.getByRole('heading', { name: 'קניון הדגמה' })).toBeVisible();
  await page.getByRole('button', { name: /מדריך המקום/ }).click();
  await expect(page.getByRole('heading', { name: 'מדריך: קניון הדגמה' })).toBeVisible();
  await expect(page.locator('.directory .li-title')).toHaveCount(3);
  await expect(page.locator('.directory .list-item').filter({ hasText: 'זארה' })).toContainText('קומה 1');
  await page.getByRole('button', { name: 'אוכל ושתייה' }).click();
  await expect(page.locator('.directory .li-title')).toHaveText(['ארומה']);
});

test('private label on a place card, and incognito mode', async ({ page }) => {
  await page.goto(`./${AZRIELI}`);
  await page.getByRole('button', { name: 'הוספת תווית פרטית' }).click();
  await page.getByRole('textbox', { name: /תווית פרטית/ }).fill('הקניון');
  await page.getByRole('textbox', { name: /תווית פרטית/ }).press('Enter');
  await expect(page.getByText('תווית: הקניון')).toBeVisible();
  await page.goto('./');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'גלישה בסתר' }).click();
  await expect(page.getByText('גלישה בסתר: החיפושים והמקומות לא נשמרים')).toBeVisible();
});

test('location: a short explanation comes before the browser asks', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('nm:location:explained'));
  await page.goto('./');
  await page.getByRole('button', { name: 'הצגת המיקום שלי' }).click();
  await expect(page.getByRole('dialog', { name: 'להראות איפה אתם?' })).toBeVisible();
  await page.getByRole('button', { name: 'לא עכשיו' }).click();
  await expect(page.getByRole('dialog', { name: 'להראות איפה אתם?' })).toBeHidden();
});

test('air quality layer shows readings and a legend', async ({ page }) => {
  await page.goto('./?panel=layers#10/32.08/34.78');
  await page.getByRole('button', { name: 'איכות אוויר' }).click();
  await expect(page.getByLabel('מקרא איכות אוויר')).toContainText('Open-Meteo');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { map: { querySourceFeatures(s: string): unknown[] } }).map.querySourceFeatures('air-quality').length), { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test('embed mode: only the map and the card, with a link to the full app', async ({ page }) => {
  await page.goto(`./${AZRIELI.replace('?', '?embed=1&')}`);
  await expect(page.getByRole('heading', { name: 'קניון עזריאלי' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'חיפוש מקום או כתובת' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'פתיחה במפות נדב' })).toHaveAttribute('href', /place=osm:n2002/);
  await expect(page).toHaveURL(/embed=1/);
});

test('embed code from the menu', async ({ page }) => {
  await page.goto('./#14/32.08/34.78');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'הטמעת מפה באתר' }).click();
  await expect(page.getByRole('textbox', { name: 'קוד להטמעה' })).toHaveValue(/<iframe src="http:\/\/localhost:\d+\/.*embed=1/);
});
