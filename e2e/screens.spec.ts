import { test } from '@playwright/test';
import { stubNetwork } from './stubs.ts';

// Screenshots for visual review (not assertions). Run: SHOTS=dir pnpm e2e screens
const dir = process.env.SHOTS;
test.skip(!dir, 'set SHOTS=<dir> to capture screenshots');

test('screens', async ({ page }, info) => {
  await stubNetwork(page);
  const shot = (n: string) => page.screenshot({ path: `${dir}/${info.project.name}-${n}.png` });
  await page.goto('./#13/32.08/34.78');
  await page.waitForTimeout(800);
  await shot('1-home');
  await page.getByRole('searchbox').fill('קפה');
  await page.waitForTimeout(600);
  await shot('2-suggest');
  await page.getByRole('option').filter({ hasText: 'עזריאלי' }).click();
  await page.waitForTimeout(1200);
  await shot('3-place');
  await page.getByRole('button', { name: 'מסלול' }).first().click();
  await page.waitForTimeout(300);
  await page.goto('./?route=34.7741,32.0787;34.7918,32.0745&mode=car');
  await page.waitForTimeout(1500);
  await shot('4-directions');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await shot('5-menu');
  await page.getByRole('button', { name: 'הגדרות' }).click();
  await shot('6-settings');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./#13/32.08/34.78');
  await page.waitForTimeout(800);
  await shot('7-dark');
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
