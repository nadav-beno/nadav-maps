import { expect, test, type Page } from '@playwright/test';
import { stubNetwork } from './stubs.ts';
import { friendsWorld, PEOPLE_URL, signedIn, stubPeople } from './people-fixture.ts';

const HOME = { latitude: 32.0787, longitude: 34.7741 };
test.use({ geolocation: HOME, permissions: ['geolocation'] });

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
});

// Phones in CI draw the map in software and are slow.
const SLOW = 120_000;

async function openPeople(page: Page, extra = '') {
  await page.goto(`./?people=${PEOPLE_URL}&panel=people${extra}#14/32.08/34.78`);
  await expect(page.getByRole('heading', { name: 'אנשים', exact: true })).toBeVisible();
}

test('people: joining takes a name and an emoji, then shows my code and an invite link', async ({ page }) => {
  test.setTimeout(SLOW);
  const w = friendsWorld(false);
  await stubPeople(page, w);
  await openPeople(page);
  await expect(page.getByText('החברים שלך, על המפה')).toBeVisible();
  await page.getByLabel('איך יראו אותך החברים').fill('נדב');
  await page.getByRole('button', { name: '🦊' }).click();
  await page.getByRole('button', { name: 'יאללה, מתחילים' }).click();
  await expect(page.getByText('(אני)')).toBeVisible();
  await expect(page.getByText('המיקום שלך לא משותף עם אף אחד')).toBeVisible();
  await expect(page.getByText('עוד אין כאן אף אחד.')).toBeVisible();
  expect(w.calls.find((c) => c.fn === 'people_profile_save')?.args).toMatchObject({ p_name: 'נדב', p_emoji: '🦊' });

  await page.getByRole('button', { name: 'הוספת אדם' }).click();
  await expect(page.getByRole('button', { name: /הקוד שלך K7M2QX/ })).toContainText('K7M 2QX');
  await page.getByRole('group', { name: 'לכמה זמן לשתף' }).getByRole('button', { name: 'עד סוף היום' }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
  await page.getByRole('button', { name: 'שליחת קישור הזמנה' }).click();
  await expect(page.locator('.pp-link')).toContainText('?invite=MYINVITE0001');
  const create = w.calls.find((c) => c.fn === 'people_invite_create')!;
  expect(create.args.p_share_seconds as number).toBeGreaterThan(3500);

  // Adding by code sends a request and (by default) shares my location for the chosen time.
  await page.getByLabel('הקוד של החבר').fill('yon-789');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect.poll(() => w.calls.find((c) => c.fn === 'people_add_by_code')?.args).toMatchObject({ p_code: 'YON789', p_share: true });
  await expect(page.getByRole('heading', { name: 'אנשים', exact: true })).toBeVisible();
  await expect(page.locator('.pp-row', { hasText: 'יוני' })).toBeVisible();
});

test('people: friends live on the map and in the list, with requests, sharing and alerts', async ({ page }) => {
  test.setTimeout(SLOW);
  const w = friendsWorld();
  await stubPeople(page, w);
  await signedIn(page);
  await openPeople(page);

  // Me, then the waiting request, then people sorted: those I can see first.
  await expect(page.getByText('עמית רואה את המיקום שלך')).toBeVisible();
  const req = page.getByRole('group', { name: 'בקשה מיוני' });
  await expect(req).toContainText('מבקש/ת לראות את המיקום שלך');
  // The closest first: Noa (680 m), then Amit.
  await expect(page.locator('.pp-row').nth(0)).toContainText('נועה לוי');
  await expect(page.locator('.pp-row').nth(1)).toContainText('עמית');
  await expect(page.locator('.pp-row', { hasText: 'נועה לוי' })).toContainText('לפני 25 דק׳');
  // Bubbles on the map: emoji for Amit, the first letter for Noa (faded: 25 minutes old is past the 20-minute mark).
  await expect(page.locator('.pp-pin', { hasText: 'עמית' })).toHaveClass(/pp-live/);
  await expect(page.locator('.pp-pin', { hasText: 'נועה' })).toHaveClass(/pp-stale/);
  await expect(page.locator('.pp-pin', { hasText: 'נועה' }).locator('.pp-face')).toHaveText('נ');

  // Answer the request: share for an hour.
  await req.getByRole('button', { name: 'שיתוף' }).click();
  await expect.poll(() => w.calls.find((c) => c.fn === 'people_share')?.args.p_viewer).toBe('u-yoni');
  await expect(page.getByRole('group', { name: 'בקשה מיוני' })).toHaveCount(0);
  await expect(page.locator('.pp-row', { hasText: 'יוני' })).toContainText('רואה את המיקום שלך · עוד 60 דק׳');
  // My position reached the server once I share.
  await expect.poll(() => w.calls.some((c) => c.fn === 'people_publish')).toBe(true);

  // A friend's card: where, how far, battery, and actions.
  await page.locator('.pp-pin', { hasText: 'עמית' }).click();
  await expect(page.locator('.pp-person-name')).toHaveText('עמית');
  await expect(page.locator('.pp-person-meta')).toContainText('82%');
  await expect(page.locator('.pp-person-meta')).toContainText('ממך');
  await expect(page.getByRole('button', { name: 'ניווט' })).toBeVisible();
  await expect(page.getByText('ללא הגבלה')).toBeVisible();

  // Alert when Amit arrives at my location.
  await page.getByRole('button', { name: 'הוספת התראה' }).click();
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByText('בהגעה למיקום שלך · פעם אחת')).toBeVisible();
  expect(w.alerts[0]).toMatchObject({ subject: 'u-amit', kind: 'arrive', label: 'המיקום שלך' });

  // Amit walks to me: the alert fires once on this device, then is deleted.
  w.locations.set('u-amit', { ...w.locations.get('u-amit')!, lng: 34.7742, lat: 32.0788, at: new Date().toISOString() });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('עמית: הגעה למיקום שלך')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => w.alerts.length).toBe(0);

  // Directions to a friend open the route screen.
  await page.getByRole('button', { name: 'ניווט' }).click();
  await expect(page.locator('.directions-top, .endpoints').first()).toBeVisible();
});

test('people: an invite link adds the friend and offers to share back', async ({ page }) => {
  test.setTimeout(SLOW);
  const w = friendsWorld(false);
  await stubPeople(page, w);
  await page.goto(`./?people=${PEOPLE_URL}&invite=INVITEDANA01#14/32.08/34.78`);
  await expect(page.getByRole('heading', { name: 'דנה משתף/ת איתך מיקום' })).toBeVisible();
  await expect(page.getByText('לשעה')).toBeVisible();
  await page.getByLabel('איך יראו אותך החברים').fill('נדב');
  await page.getByRole('button', { name: 'המשך' }).click();
  await page.getByRole('group', { name: 'לכמה זמן לשתף' }).getByRole('button', { name: 'לא עכשיו' }).click();
  await page.getByRole('button', { name: 'אישור' }).click();
  await expect(page.locator('.pp-person-name')).toHaveText('דנה');
  expect(w.calls.find((c) => c.fn === 'people_invite_accept')?.args).toMatchObject({ p_token: 'INVITEDANA01', p_share: false });
  await expect(page.locator('.pp-pin', { hasText: 'דנה' })).toBeVisible();
  // Not sharing back yet: Dana's request waits on my card.
  await expect(page.getByText('דנה ביקש/ה לראות את המיקום שלך')).toBeVisible();
});

test('people: opening the app brings the friends who share with me into view', async ({ page }) => {
  test.setTimeout(SLOW);
  await stubPeople(page, friendsWorld());
  await signedIn(page);
  // The last view was zoomed in somewhere else, and the friends were hidden last time.
  await page.goto(`./?people=${PEOPLE_URL}#17/32.2/34.9`);
  const inView = (name: string) =>
    page.locator('.pp-pin', { hasText: name }).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    });
  await expect.poll(() => inView('עמית'), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => inView('נועה')).toBe(true);
});

test('people: hiding my location and a service that is not switched on yet', async ({ page }) => {
  test.setTimeout(SLOW);
  const w = friendsWorld();
  await stubPeople(page, w);
  await signedIn(page);
  await openPeople(page);
  await page.locator('.pp-me').click();
  await page.getByRole('switch', { name: /הסתרת המיקום שלי/ }).check();
  await expect.poll(() => w.calls.find((c) => c.fn === 'people_set_paused')?.args.p_paused).toBe(true);
  await page.getByRole('button', { name: 'חזרה' }).click();
  await expect(page.locator('.pp-me-line')).toHaveText('המיקום שלך מוסתר מכולם');
});

test('people: tells the owner what to switch on when anonymous sign-in is off', async ({ page }) => {
  test.setTimeout(SLOW);
  await stubPeople(page, friendsWorld(false), { anonDisabled: true });
  await openPeople(page);
  await page.getByLabel('איך יראו אותך החברים').fill('נדב');
  await page.getByRole('button', { name: 'יאללה, מתחילים' }).click();
  await expect(page.getByText('השירות עוד לא מוכן. נסו שוב מאוחר יותר.')).toBeVisible();
});

// Screenshots for review (not assertions): SHOTS=<dir> pnpm e2e people -g screens
const shots = process.env.SHOTS;
test('people: screens', async ({ page }, info) => {
  test.skip(!shots, 'set SHOTS=<dir> to capture screenshots');
  test.setTimeout(SLOW);
  const name = (n: string) => `${shots}/${info.project.name}-${n}.png`;
  const w = friendsWorld(false);
  await stubPeople(page, w);
  await openPeople(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: name('1-join') });
  await page.getByLabel('איך יראו אותך החברים').fill('נדב');
  await page.getByRole('button', { name: 'יאללה, מתחילים' }).click();
  // Now with friends.
  for (const [k, v] of friendsWorld().shares) w.shares.set(k, v);
  w.requests.add('u-yoni>u-me');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.pp-pin', { hasText: 'עמית' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: name('2-people') });
  await page.locator('.pp-pin', { hasText: 'עמית' }).click();
  await expect(page.locator('.pp-person-name')).toHaveText('עמית');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: name('3-person') });
  await page.getByRole('button', { name: 'הוספת התראה' }).click();
  await page.screenshot({ path: name('4-alert'), fullPage: false });
  await page.getByRole('button', { name: 'ביטול' }).click();
  await page.getByRole('button', { name: 'חזרה' }).click();
  await page.getByRole('button', { name: 'הוספת אדם' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: name('5-add') });
  // Dark mode, the people list.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'חזרה' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: name('6-dark') });
});
