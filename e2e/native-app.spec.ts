import { expect, test, type Page } from '@playwright/test';
import { stubNetwork } from './stubs.ts';
import { friendsWorld, PEOPLE_URL, signedIn, stubPeople } from './people-fixture.ts';

/**
 * The iPhone app (apps/mobile) loads the site inside a native shell. Here we fake the shell's
 * bridge (window.webkit.messageHandlers.bridge + the BackgroundGeolocation plugin header) and
 * check that location comes from the native plugin, and keeps running in the background while
 * sharing with friends.
 */
type NativeCall = { method: string; options: Record<string, unknown>; id?: string };

async function fakeNativeShell(page: Page) {
  await page.addInitScript(() => {
    const calls: { method: string; options: Record<string, unknown>; id?: string }[] = [];
    const live = new Map<string, (fix: unknown, err?: unknown) => void>();
    let n = 0;
    const fix = () => ({ latitude: 32.0787, longitude: 34.7741, accuracy: 8, altitude: null, altitudeAccuracy: null, bearing: 90, speed: 1.2, time: Date.now() });
    (window as unknown as { nmNative: unknown }).nmNative = { calls, live, push: () => live.forEach((cb) => cb(fix())) };
    (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { bridge: { postMessage() {} } } };
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      PluginHeaders: [
        {
          name: 'BackgroundGeolocation',
          methods: [
            { name: 'addWatcher', rtype: 'callback' },
            { name: 'removeWatcher', rtype: 'promise' },
            { name: 'openSettings', rtype: 'promise' },
          ],
        },
      ],
      nativeCallback(_plugin: string, method: string, options: Record<string, unknown>, cb: (fix: unknown) => void) {
        const id = `w${++n}`;
        calls.push({ method, options, id });
        live.set(id, cb);
        setTimeout(() => live.get(id)?.(fix()), 50);
        return id;
      },
      nativePromise(_plugin: string, method: string, options: Record<string, unknown>) {
        calls.push({ method, options });
        if (method === 'removeWatcher') live.delete(options.id as string);
        return Promise.resolve();
      },
    };
  });
}

const nativeCalls = (page: Page) => page.evaluate(() => (window as unknown as { nmNative: { calls: NativeCall[] } }).nmNative.calls.map((c) => ({ ...c })));
const liveWatchers = (page: Page) => page.evaluate(() => (window as unknown as { nmNative: { live: Map<string, unknown> } }).nmNative.live.size);

async function hide(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { value: h, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  await fakeNativeShell(page);
});

test('iPhone app: my location comes from the native location manager and stops in the background', async ({ page }) => {
  await page.goto('./#14/32.08/34.78');
  await page.getByRole('button', { name: 'הצגת המיקום שלי' }).click();
  await expect(page.getByRole('button', { name: /המפה עוקבת אחריך|מרכוז על המיקום שלי/ })).toBeVisible();
  const [watch] = await nativeCalls(page);
  expect(watch).toMatchObject({ method: 'addWatcher', options: { requestPermissions: true, stale: false } });
  // Not sharing with anyone: foreground only, so iOS shows no background location pill.
  expect(watch.options.backgroundMessage).toBeUndefined();

  await hide(page, true);
  await expect.poll(() => liveWatchers(page)).toBe(0);
  await hide(page, false);
  await expect.poll(() => liveWatchers(page)).toBe(1);
});

test('iPhone app: while friends see me, location keeps running in the background and reaches them', async ({ page }) => {
  test.setTimeout(120_000);
  const w = friendsWorld();
  await stubPeople(page, w);
  await signedIn(page);
  await page.goto(`./?people=${PEOPLE_URL}&panel=people#14/32.08/34.78`);
  await expect(page.getByText('עמית רואה את המיקום שלך')).toBeVisible();
  await page.getByRole('button', { name: 'הצגת המיקום שלי' }).click();

  // Sharing switches the watcher to background mode (a message is what turns it on natively).
  await expect
    .poll(async () => (await nativeCalls(page)).filter((c) => c.method === 'addWatcher').at(-1)?.options.backgroundMessage)
    .toBe('המיקום שלך משותף עם חברים');
  await expect.poll(() => w.calls.some((c) => c.fn === 'people_publish')).toBe(true);

  // The app goes to the background: GPS keeps running and new fixes are still published.
  await hide(page, true);
  await page.waitForTimeout(300);
  expect(await liveWatchers(page)).toBe(1);
  const before = w.calls.filter((c) => c.fn === 'people_publish').length;
  await page.evaluate(() => {
    const n = (window as unknown as { nmNative: { push: () => void } }).nmNative;
    // Far enough and late enough for the publisher's 25 m / 8 s throttle.
    const now = Date.now;
    Date.now = () => now() + 70_000;
    n.push();
  });
  await expect.poll(() => w.calls.filter((c) => c.fn === 'people_publish').length).toBeGreaterThan(before);
});

test('iPhone app: the permissions screen opens the app settings', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'הרשאות מיקום ותנועה' }).click();
  await expect(page.getByText('הרשאת המיקום של האפליקציה')).toBeVisible();
  await page.getByRole('button', { name: 'פתיחת ההגדרות' }).click();
  await expect.poll(async () => (await nativeCalls(page)).some((c) => c.method === 'openSettings')).toBe(true);
});
