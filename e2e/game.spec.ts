import { expect, test, type Page } from '@playwright/test';
import { stubNetwork } from './stubs.ts';
import { adsbAreaResponse } from './flight-fixture.ts';

/**
 * "שומרי השמיים" (game mode): opening it, the captain's tutorial, a wave, losing, pausing and
 * leaving. Taps go where the game says an invader will be (window.nmGame is the test hook).
 * With SHOTS=<dir>, screenshots of each screen are saved there.
 */

const SLOW = 120_000;
const shots = process.env.SHOTS;

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  // Real flights around Tel Aviv (one in the air, one on the ground, which the game leaves out).
  await page.route('https://api.adsb.lol/v2/point/**', (r) => r.fulfill({ json: { ...adsbAreaResponse(), now: Date.now() }, headers: { 'access-control-allow-origin': '*' } }));
});

interface Hook {
  game: {
    phase: string;
    wave: number;
    score: number;
    tutorialStep: number;
    enemies: { id: number; pos: { x: number; y: number }; vel: { x: number; y: number } }[];
    flights: { id: string; real: boolean; pos: { x: number; y: number } }[];
    launchers: { pos: { x: number; y: number } }[];
    supply: { pos: { x: number; y: number }; opened: boolean } | null;
    capsules: { pos: { x: number; y: number } }[];
    arena: { w: number; h: number };
    summary: { options: string[] } | null;
    intercept(e: unknown, from: unknown, speed: number): { x: number; y: number };
    interceptorSpeed(): number;
    startWave(n: number): void;
  } | null;
  toScreen(v: { x: number; y: number }): { x: number; y: number };
}

/** Taps where the first invader will meet an interceptor from the middle tower. */
async function tapInvader(page: Page) {
  const p = await page.evaluate(() => {
    const h = (window as unknown as { nmGame: Hook }).nmGame;
    const g = h.game!;
    const e = g.enemies.find((x) => x.pos.y > -g.arena.h && Math.abs(x.pos.x) < g.arena.w);
    if (!e) return null;
    const from = g.launchers.reduce((a, b) => (Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y) < Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y) ? a : b)).pos;
    return h.toScreen(g.intercept(e, from, g.interceptorSpeed()));
  });
  if (p) await page.mouse.click(p.x, p.y);
  return !!p;
}

const state = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as { nmGame: Hook }).nmGame.game;
  return g ? { phase: g.phase, wave: g.wave, step: g.tutorialStep, score: g.score, enemies: g.enemies.length, real: g.flights.filter((f) => f.real).length, flights: g.flights.length } : null;
});

async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${test.info().project.name}-${name}.png` });
}

test('game mode: tutorial, a wave, losing, pausing and leaving', async ({ page }) => {
  test.setTimeout(SLOW);
  await page.goto('./#9/32.0/34.8');
  await page.getByRole('button', { name: 'מצב משחק: שומרי השמיים' }).click();
  await expect(page).not.toHaveURL(/panel=game/);
  await expect(page.getByRole('heading', { name: 'שומרי השמיים' })).toBeVisible();
  await expect(page.getByText('משחק דמיוני.').first()).toBeVisible();
  // The shell steps aside: no search bar or tabs while playing.
  await expect(page.locator('.top-bar')).toHaveCount(0);
  await page.waitForTimeout(800);
  await shot(page, '1-title');

  // First shift: the captain's tutorial.
  await page.getByRole('button', { name: 'התחל משמרת' }).click();
  await expect(page.getByText('אני קפטן רום')).toBeVisible();
  // The airborne real flight is in the sky; training planes fill up to four.
  await expect.poll(async () => (await state(page))?.real, { timeout: 15_000 }).toBe(1);
  expect((await state(page))?.flights).toBe(4);
  await shot(page, '2-tutorial');
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.getByText('הנה פולש ראשון')).toBeVisible();
  // Shoot the first invader, then the fast one.
  // A lucky tap can down the fast invader too before the next poll, so the step may jump to 3.
  await expect.poll(async () => (await tapInvader(page), (await state(page))!.step), { timeout: 30_000, intervals: [1500] }).toBeGreaterThanOrEqual(2);
  if ((await state(page))!.step === 2) {
    await expect(page.getByText('את הפולש המהיר הזה')).toBeVisible();
    await page.waitForTimeout(600);
    await shot(page, '3-tutorial-lead');
  }
  await expect.poll(async () => ((await state(page))!.step < 3 && (await tapInvader(page)), (await state(page))!.step), { timeout: 30_000, intervals: [1500] }).toBe(3);
  await page.getByRole('button', { name: 'הבנתי' }).click();
  await expect(page.getByText('מטוס האספקה')).toBeVisible();
  // Catch the supply plane, then its capsule.
  await expect
    .poll(
      async () => {
        const p = await page.evaluate(() => {
          const h = (window as unknown as { nmGame: Hook }).nmGame;
          const g = h.game!;
          const c = g.capsules[0];
          if (c) return h.toScreen(c.pos);
          if (g.supply && !g.supply.opened && Math.abs(g.supply.pos.x) < g.arena.w * 0.8) return h.toScreen(g.supply.pos);
          return null;
        });
        if (p) await page.mouse.click(p.x, p.y);
        return (await state(page))!.step;
      },
      { timeout: 40_000, intervals: [300] },
    )
    .toBe(5);
  await page.getByRole('button', { name: 'יאללה, מתחילים!' }).click();
  await expect(page.locator('.g-banner')).toContainText('גל 1');
  await expect(page.locator('.g-wave')).toContainText('גזרת המרכז');
  expect(await page.evaluate(() => localStorage.getItem('nm:game:tutorial'))).toBe('true');

  // A busy later wave for the picture, with a few shots in the air.
  await page.evaluate(() => (window as unknown as { nmGame: Hook }).nmGame.game!.startWave(4));
  await page.waitForTimeout(9000);
  for (let i = 0; i < 3; i++) await tapInvader(page);
  await page.waitForTimeout(450);
  await shot(page, '4-wave');

  // Pause and back.
  await page.getByRole('button', { name: 'השהיה' }).click();
  await expect(page.getByRole('heading', { name: 'הפסקה' })).toBeVisible();
  await shot(page, '5-pause');
  await page.getByRole('button', { name: 'המשך' }).click();
  await expect(page.locator('.g-count')).toBeVisible();
  await expect(page.locator('.g-count')).toHaveCount(0, { timeout: 5000 });

  // An invader reaches a flight: the shift is over.
  await page.evaluate(() => {
    const g = (window as unknown as { nmGame: Hook }).nmGame.game!;
    const f = g.flights[0];
    // (The tutorial's shield power may still be up.)
    (g as unknown as { powers: object }).powers = {};
    for (const x of g.flights as unknown as { shield: number }[]) x.shield = 0;
    const e = g.enemies[0] ?? (g as unknown as { spawn(k: string): Hook['game'] extends infer G ? (G extends { enemies: (infer E)[] } ? E : never) : never }).spawn('buzzer');
    e.pos = { x: f.pos.x, y: f.pos.y - 0.05 };
    (e as unknown as { target: string }).target = f.id;
  });
  await expect(page.getByRole('heading', { name: 'המשמרת הסתיימה' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.g-over')).toContainText('הגעת לגל 4');
  await shot(page, '6-over');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nm:game:scores') ?? '[]') as { wave: number }[]);
  expect(saved[0].wave).toBe(4);

  // Scores and badges from the menu.
  await page.getByRole('button', { name: 'תפריט' }).click();
  await page.getByRole('button', { name: 'שיאים' }).click();
  await expect(page.locator('.g-table li')).toHaveCount(1);
  await expect(page.locator('.g-badge.on').first()).toBeVisible();
  await shot(page, '7-scores');
  await page.getByRole('button', { name: 'חזרה', exact: true }).click();

  // Leaving gives the map back.
  await page.getByRole('button', { name: 'חזרה למפה' }).click();
  await expect(page).not.toHaveURL(/panel=game/);
  await expect(page.getByRole('button', { name: 'מצב משחק: שומרי השמיים' })).toBeVisible();
});

test('game mode: never opens on its own, even from an old link; a clean wave ends with an upgrade choice', async ({ page }) => {
  test.setTimeout(SLOW);
  await page.addInitScript(() => {
    localStorage.setItem('nm:game:tutorial', 'true');
    // Rookie: second chances, so a slow test machine does not lose the wave.
    localStorage.setItem('nm:game:settings', JSON.stringify({ difficulty: 'rookie' }));
  });
  await page.goto('./?panel=game');
  // The app opens on the map; only the game button starts the game.
  await expect(page.getByRole('button', { name: 'שכבות' })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByRole('heading', { name: 'שומרי השמיים' })).toHaveCount(0);
  await page.getByRole('button', { name: 'מצב משחק: שומרי השמיים' }).click();
  await page.getByRole('button', { name: 'התחל משמרת' }).click();
  await expect(page.locator('.g-banner')).toContainText('גל 1');
  // Shoot everything in wave 1, with shock waves (the space bar) for whatever gets close.
  await page.evaluate(() => ((window as unknown as { nmGame: { game: { shocks: number } } }).nmGame.game.shocks = 99));
  await expect
    .poll(
      async () => {
        await tapInvader(page);
        if ((await state(page))!.enemies > 2) await page.keyboard.press(' ');
        return (await state(page))!.phase;
      },
      { timeout: 80_000, intervals: [700] },
    )
    .toBe('clear');
  await expect(page.getByRole('heading', { name: 'גל 1 הושלם!' })).toBeVisible();
  await shot(page, '8-upgrade');
  await page.locator('.g-upgrade').first().click();
  await expect(page.locator('.g-banner')).toContainText('גל 2');
  expect((await state(page))!.score).toBeGreaterThan(0);
});
