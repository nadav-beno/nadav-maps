import { test } from '@playwright/test';
import { stubNetwork } from './stubs.ts';
import { adsbResponse, fakeGps, FLIGHT_FIXES } from './flight-fixture.ts';
import { TAKEOUT_DAY, TAKEOUT_FIXTURE } from './timeline-fixture.ts';

// Screenshots for visual review (not assertions). Run: SHOTS=dir pnpm e2e screens
const dir = process.env.SHOTS;
test.skip(!dir, 'set SHOTS=<dir> to capture screenshots');
test.setTimeout(120_000);

test('screens', async ({ page }, info) => {
  await stubNetwork(page);
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-${n}.png` });
  const tab = (name: string) => page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name }).click();
  await page.goto('./#16/32.08/34.78');
  await page.waitForTimeout(1500);
  await shot('01-home');
  await page.getByRole('searchbox').fill('קפה');
  await page.waitForTimeout(600);
  await shot('02-suggest');
  await page.getByRole('option').filter({ hasText: 'עזריאלי' }).click();
  await page.waitForTimeout(1200);
  await shot('03-place');
  await page.goto('./?place=ovt:aaaaaaaa-0000-4000-8000-000000000001#18/32.0801/34.7792');
  await page.waitForTimeout(1500);
  await shot('04-business');
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await page.waitForTimeout(1500);
  await shot('05-directions');
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=transit');
  await page.waitForTimeout(1500);
  await shot('05b-transit');
  await page.getByRole('button', { name: 'שלבים' }).click();
  await page.waitForTimeout(300);
  await shot('05c-transit-steps');
  await page.goto('./?route=34.7741,32.0787;34.7850,32.0765;34.7918,32.0745&mode=walk');
  await page.waitForTimeout(1500);
  await shot('05d-walk-via');
  await page.goto('./#16/32.0779/34.7752');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'יציאות קרובות' }).click();
  await page.waitForTimeout(800);
  await shot('05e-departures');
  await page.goto('./?panel=layers#15/32.08/34.78');
  await page.waitForTimeout(1200);
  await shot('06-layers');
  await page.goto('./#16/32.08/34.78');
  await page.waitForTimeout(800);
  await tab('שמורים');
  await page.waitForTimeout(400);
  await shot('07-saved');
  await tab('תרומה');
  await page.waitForTimeout(400);
  await shot('08-contribute');
  await tab('סביבה');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.waitForTimeout(400);
  await shot('09-menu');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./#16/32.08/34.78');
  await page.waitForTimeout(1500);
  await shot('10-dark');
});

test('measure', async ({ page }, info) => {
  await stubNetwork(page);
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-measure-${n}.png` });
  await page.goto('./?panel=measure#16/32.08/34.78');
  await page.waitForTimeout(1500);
  const { width, height } = page.viewportSize()!;
  const desktop = width >= 768;
  // Points on the visible map (beside the side panel on desktop, above the sheet on phones).
  const at = (x: number, y: number) => page.mouse.click(Math.round((desktop ? width - 408 : width) * x), Math.round(height * y));
  await at(0.25, 0.3);
  await at(0.7, 0.36);
  await at(0.6, 0.62);
  await page.waitForTimeout(500);
  await shot('1-distance');
  await at(0.25, 0.3);
  await page.waitForTimeout(500);
  await shot('2-area');
});

test('search results', async ({ page }, info) => {
  await stubNetwork(page);
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-${n}.png` });
  await page.goto('./#15/32.08/34.78');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'בתי קפה' }).click();
  await page.locator('.list').getByText('קפה לנדוור').waitFor();
  // Pan the map so "search this area" shows up.
  const desktop = info.project.name === 'desktop';
  const y = desktop ? 400 : 230;
  await page.mouse.move(desktop ? 80 : 40, y);
  await page.mouse.down();
  await page.mouse.move(desktop ? 480 : 330, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  await shot('11-results');
  await page.locator('.result-filters').getByRole('button', { name: 'פתוח עכשיו' }).click();
  await page.waitForTimeout(800);
  await shot('12-results-open-now');
  await page.goto('./#17/32.0801/34.7792');
  await page.waitForTimeout(1500);
  await page.getByRole('searchbox').fill('ביסטרו');
  await page.waitForTimeout(800);
  await shot('13-suggest-business');
  await page.getByRole('searchbox').fill('https://maps.app.goo.gl/AbCdEf');
  await page.waitForTimeout(400);
  await shot('14-short-link');
});

test('search typos', async ({ page }, info) => {
  await stubNetwork(page);
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-${n}.png` });
  await page.goto('./#15/32.08/34.78');
  await page.waitForTimeout(1200);
  const box = page.getByRole('searchbox');
  await box.fill('עזראלי');
  await page.getByRole('option').filter({ hasText: 'קניון עזריאלי' }).waitFor();
  await shot('15-typo-suggest');
  await box.fill('קפע');
  await box.press('Enter');
  await page.locator('.did-you-mean').waitFor();
  await page.waitForTimeout(800);
  await shot('16-typo-results');
  await page.goto('./#13/32.1/34.85');
  await page.waitForTimeout(1000);
  await box.fill('בתי קפה ליד עזראלי');
  await box.press('Enter');
  await page.locator('.near-line').waitFor();
  await page.waitForTimeout(1200);
  await shot('17-category-near');
});

test('basemap', async ({ page }, info) => {
  await stubNetwork(page);
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-map-${n}.png` });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const z of [13, 15, 16.5]) {
      await page.goto(`./?t=${scheme}${z}#${z}/32.081/34.784`);
      await page.waitForTimeout(2000);
      await shot(`${scheme}-z${z}`);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./?t=3d#16.5/32.081/34.786/30/55');
  await page.waitForTimeout(1500);
  await shot('light-3d');
});

test('traffic here', async ({ page }, info) => {
  await stubNetwork(page);
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-traffic-here-${n}.png` });
  await page.goto('./?here=test&panel=layers#15/32.085/34.79');
  await page.getByRole('button', { name: 'תנועה', exact: true }).click();
  await page.waitForTimeout(1500);
  await shot('1-layers');
  await page.goto('./?here=test#15/32.085/34.79');
  await page.waitForTimeout(2000);
  await shot('2-map');
  type W = { map: { project(p: [number, number]): { x: number; y: number } } };
  const at = await page.evaluate(() => (window as unknown as W).map.project([34.792, 32.088]));
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await page.waitForTimeout(1200);
  await shot('3-incident');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./?here=test#15/32.085/34.79');
  await page.waitForTimeout(2000);
  await shot('4-dark');
  await page.goto('./?here=test&route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await page.waitForTimeout(2000);
  await shot('5-route');
});

test('flight', async ({ page }, info) => {
  test.setTimeout(300_000);
  await stubNetwork(page);
  await page.route('https://api.adsb.lol/**', (r) => r.fulfill({ json: adsbResponse(), headers: { 'access-control-allow-origin': '*' } }));
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-flight-${n}.png` });
  // Before the GPS locks on.
  await fakeGps(page, []);
  await page.goto('./?panel=flight#5/38/23');
  await page.waitForTimeout(2500);
  await shot('1-searching');
  // Flying west over Greece with a destination.
  await fakeGps(page, FLIGHT_FIXES);
  // A real reload (the same URL would only be a hash change).
  await page.goto('about:blank');
  await page.goto('./?panel=flight#5/38/23');
  await page.locator('.flight-gps.gps-ok').waitFor();
  await page.getByRole('button', { name: 'בחירת יעד' }).click();
  await page.getByRole('searchbox', { name: 'חיפוש יעד' }).fill('לונ');
  await page.waitForTimeout(400);
  await shot('2-picker');
  await page.getByRole('button', { name: /לונדון/ }).first().click();
  await page.waitForTimeout(4000);
  await shot('3-live');
  await page.getByRole('textbox', { name: 'מספר טיסה' }).fill('LY001');
  await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
  await page.locator('.flight-adsb').waitFor();
  await page.locator('.flight-find').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot('4-adsb');
  // Offline: the vector tiles fail, the bundled world map is drawn, light and dark.
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort('internetdisconnected'));
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`./?panel=flight&t=${scheme}#5/38/23`);
    await page.locator('.flight-gps.gps-ok').waitFor();
    await page.waitForTimeout(4000);
    await shot(`5-offline-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./#4/34/30');
  await page.waitForTimeout(4000);
  await shot('6-offline-home');
});

test('timeline', async ({ page }, info) => {
  await stubNetwork(page);
  page.on('dialog', (d) => void d.accept());
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-timeline-${n}.png` });
  await page.goto('./?panel=timeline#14/32.08/34.78');
  await page.waitForTimeout(1200);
  await shot('1-empty');
  await page.getByRole('button', { name: 'הגדרות ציר הזמן' }).click();
  await page.waitForTimeout(300);
  await shot('2-settings');
  await page.locator('#tl-import').setInputFiles({ name: '2019_MARCH.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(TAKEOUT_FIXTURE)) });
  await page.getByRole('list', { name: 'המקומות והדרכים של היום' }).waitFor();
  await page.waitForTimeout(1500);
  await shot('3-day');
  if (info.project.name !== 'desktop') {
    await page.locator('.sheet-handle').click();
    await page.waitForTimeout(600);
    await shot('4-day-full');
  }
  await page.getByRole('button', { name: 'תיקון המקום: קפה לנדוור' }).click();
  await page.waitForTimeout(3000);
  await shot('5-this-was');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`./?panel=timeline&day=${TAKEOUT_DAY}`);
  await page.waitForTimeout(1500);
  await shot('6-dark');
});

test.describe(() => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  });

  test('install', async ({ page }, info) => {
    await stubNetwork(page);
    const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-install-${n}.png` });
    // Pretend this is the second visit, so the one-time guide comes up on its own.
    await page.addInitScript(() => localStorage.setItem('nm:visits', '1'));
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page
        .evaluate(() => {
          sessionStorage.clear();
          localStorage.removeItem('nm:installHintShown');
        })
        .catch(() => {});
      await page.goto('./#15/32.08/34.78');
      await page.getByRole('dialog', { name: 'התקנה כאפליקציה' }).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await shot(`1-sheet-${scheme}`);
      await page.getByRole('dialog').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(200);
      await shot(`2-sheet-end-${scheme}`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('./?panel=install');
    await page.waitForTimeout(800);
    await shot('3-view');
  });
});
