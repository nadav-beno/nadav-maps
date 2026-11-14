import { expect, test } from '@playwright/test';
import { stubNetwork } from './stubs.ts';

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

const cors = { 'access-control-allow-origin': '*' };
const nowS = () => Math.round(Date.now() / 1000);

/** Ships off Haifa, as our relay sends them (see packages/tools/src/ships-relay.ts ShipRow). */
function relayShips() {
  const t = nowS() - 20;
  return [
    [428000001, 34.95, 32.85, 12.4, 95, 96, 0, t, 'ZIM SAMMY', 71, 260, 32, 11.5, 'ILHFA', '12-01T06:30', 9876543, '4XZS'],
    [538000002, 34.98, 32.83, 0, null, 120, 1, t - 600, 'BLUE TANKER', 80, 180, 30, 9.8, 'ILASH', null, 9123456, 'V7AB'],
    [248000003, 34.99, 32.82, 0.1, 10, 12, 5, t - 300, 'AQUA FERRY', 60, 120, 20, 5.1, 'CYLMS', null, null, '9HAF'],
    [428000004, 34.9, 32.9, 5.2, 300, null, 7, t, 'DAG 7', 30, 18, 6, null, null, null, null, null],
    [428000005, 34.97, 32.86, 6, 200, 200, 8, t, 'SHALOM', 36, 12, 4, null, null, null, null, null],
  ];
}

test('live ships: the boat button shows ships by kind, a tap opens the ship card with destination, flag and track', async ({ page }) => {
  test.setTimeout(60_000);
  const bodies: Record<string, unknown>[] = [];
  await page.route('https://relay.test/ships', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'content-type' } });
    const body = r.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (body.track) return r.fulfill({ json: { track: [[34.8, 32.83, nowS() - 3600], [34.9, 32.84, nowS() - 1800]] }, headers: cors });
    return r.fulfill({ json: { ships: relayShips(), at: nowS(), live: true }, headers: cors });
  });
  await page.route('https://query.wikidata.org/**', (r) =>
    r.fulfill({
      json: { results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { value: 'Zim Sammy' }, inception: { value: '2015-05-01T00:00:00Z' }, builderLabel: { value: 'Hyundai Heavy Industries' }, gt: { value: '94000' } }] } },
      headers: cors,
    }),
  );
  await page.goto('./?shipsrelay=https://relay.test/ships#11/32.85/34.95');
  await page.getByRole('button', { name: 'ספינות בזמן אמת' }).click();
  await expect(page.locator('.live-status')).toContainText('5 ספינות במפה', { timeout: 15_000 });
  await expect(page.locator('.live-status')).toContainText('3 בתנועה');
  await expect(page).toHaveURL(/panel=ships/);
  // Only the map area went out, as a box in the body.
  expect((bodies.find((b) => b.box)!.box as number[]).length).toBe(4);
  // Every ship is drawn in its kind's colour: a hull under way, a dot when stopped.
  const icons = () =>
    page.evaluate(() =>
      [...new Map((window as unknown as { map: { querySourceFeatures(s: string): { properties: { m: number; i: string } }[] } }).map.querySourceFeatures('live-ships').map((f) => [f.properties.m, f.properties.i])).values()].sort(),
    );
  await expect.poll(icons, { timeout: 15_000 }).toEqual(['ship-big-cargo', 'ship-dot-passenger', 'ship-dot-tanker', 'ship-hull-fishing', 'ship-hull-pleasure']);
  // The legend hides a kind with one tap.
  await page.getByRole('button', { name: 'מכליות' }).click();
  await expect(page.locator('.live-status')).toContainText('4 ספינות במפה');
  await page.getByRole('button', { name: 'רק בתנועה' }).click();
  await expect(page.locator('.live-status')).toContainText('3 ספינות במפה');
  await page.getByRole('button', { name: 'הצגת הכול' }).click();
  // Find a ship by name and open its card.
  await page.getByRole('textbox', { name: 'חיפוש ספינה' }).fill('zim');
  await page.getByRole('button', { name: /ZIM SAMMY/ }).click();
  await expect(page.locator('.live-callsign')).toHaveText('ZIM SAMMY');
  await expect(page.locator('.ship-sub')).toContainText('ישראל');
  await expect(page.locator('.ship-sub')).toContainText('ספינת משא');
  await expect(page.locator('.flight-dest')).toContainText('חיפה');
  await expect(page.locator('.flight-grid')).toContainText('12.4');
  await expect(page.locator('.flight-grid')).toContainText('260×32');
  // What Wikidata knows by IMO.
  await expect(page.getByRole('region', { name: 'על הספינה' })).toContainText('2015');
  await expect(page.getByRole('region', { name: 'על הספינה' })).toContainText('Hyundai Heavy Industries');
  await expect(page.getByRole('region', { name: 'מזהים' })).toContainText('9876543');
  // Its track was asked for by MMSI and is drawn.
  await expect.poll(() => bodies.some((b) => b.track === 428000001)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { map: { querySourceFeatures(s: string): { properties: { kind: string } }[] } }).map.querySourceFeatures('live-ships-selected').map((f) => f.properties.kind).sort()))
    .toEqual(expect.arrayContaining(['ahead', 'ship', 'trail']));
  await expect(page).toHaveURL(/ship=428000001/);
  // Save it: it shows under "my ships".
  await page.getByRole('button', { name: 'שמירת הספינה' }).click();
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.getByRole('region', { name: 'הספינות שלי' })).toContainText('ZIM SAMMY');
  // The boat button hides the ships again.
  await page.getByRole('button', { name: 'הסתרת הספינות' }).click();
  await expect(page).not.toHaveURL(/panel=ships/);
});

test('live ships without the worldwide source say so outside the Baltic', async ({ page }) => {
  await page.goto('./?panel=ships#10/32.85/34.95');
  await expect(page.locator('.live-note')).toContainText('רק בים הבלטי', { timeout: 15_000 });
});
