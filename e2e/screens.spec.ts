import { test } from '@playwright/test';
import { stubNetwork } from './stubs.ts';

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
