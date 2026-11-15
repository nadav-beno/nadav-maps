import { computed, effect, signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { MercatorCoordinate, type Map as MapLibreMap } from 'maplibre-gl';
import { back, currentView, Icon, immersive, incognito, load, open, providers, save, toast, type FeatureContext } from '@nm/core/app';
import { liveFlights, tools, type AircraftPosition } from '@nm/tools';
import { dailySeed, Game, sectorOf, type EnemyKind, type FlightInput, type GameEvent, type PowerKind, type Stats, type UpgradeKind, type Vec, type WaveSummary } from './engine.ts';
import { drawBackdrop, drawFlights, drawGame, Fx, type Xf } from './render.ts';
import { buzz, music, musicIntensity, resume, setVibration, setVolumes, sfx, suspend, unlock } from './sound.ts';
import { CaptainFace, NEW_KIND, POWER_ICON, POWER_NAME, RETRY, SECTORS, TIPS, TUTORIAL, UPGRADE_TEXT, WAVE_LINES } from './captain.tsx';
import { addLifetime, addScore, BADGES, DEFAULT_SETTINGS, NEW_LIFETIME, newBadges, type Badge, type Lifetime, type Score, type Settings } from './progress.ts';

/**
 * "שומרי השמיים": an arcade game over the real flights above Israel. Fictional invaders go for
 * the flights; the player taps to send interceptors. The map stays underneath (camera locked),
 * the game is drawn on a canvas over it, and the shell's chrome is hidden (immersive).
 */

export const GAME_VIEW = 'game';

/** The sectors: middle and radius (m). The arena's unit is the radius. */
const SECTOR_GEO: { c: [number, number]; r: number }[] = [
  { c: [34.86, 32.03], r: 30_000 },
  { c: [35.12, 32.82], r: 36_000 },
  { c: [35.02, 31.79], r: 28_000 },
  { c: [34.88, 30.55], r: 100_000 },
  { c: [35.0, 31.45], r: 200_000 },
];

/** The game plays in the middle band of a tall phone screen. */
const MAX_W = 1.9;
const MAX_H = 1.45;
const FEED_MS = 10_000;

type Screen = 'title' | 'play' | 'pause' | 'settings' | 'scores' | 'over';
type Mode = 'normal' | 'daily' | 'tutorial';

const KEYS = { settings: 'game:settings', scores: 'game:scores', life: 'game:life', badges: 'game:badges', tutorial: 'game:tutorial', daily: 'game:daily' };

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(KEYS.settings, {}) });
const scores = signal<Score[]>(load<Score[]>(KEYS.scores, []));
const lifetime = signal<Lifetime>({ ...NEW_LIFETIME, ...load<Partial<Lifetime>>(KEYS.life, {}) });
const badges = signal<string[]>(load<string[]>(KEYS.badges, []));
const daily = signal<{ seed: number; best: number }>(load(KEYS.daily, { seed: 0, best: 0 }));

export const screen = signal<Screen>('title');
const settingsBack = signal<Screen>('title');
const countdown = signal(0);

interface Hud {
  phase: Game['phase'];
  wave: number;
  sector: number;
  score: number;
  mult: number;
  chances: number;
  guard: number;
  shocks: number;
  powers: [PowerKind, number][];
  remaining: number;
  intro: number;
  boss: boolean;
  tutorialStep: number;
  summary: WaveSummary | null;
  daily: boolean;
  realFlights: number;
}
export const hud = signal<Hud | null>(null);

interface Captain {
  text: string;
  mood: 'smile' | 'wow' | 'sad';
  until: number;
}
const captain = signal<Captain | null>(null);

interface Over {
  score: number;
  wave: number;
  best: number;
  record: boolean;
  rank: number | null;
  stats: Stats;
  badges: Badge[];
  tip: string;
  saved: boolean;
  daily: boolean;
}
export const over = signal<Over | null>(null);

export const isGameOn = computed(() => currentView.value.kind === GAME_VIEW);

export function openGame() {
  if (isGameOn.peek()) return;
  // Never in the URL: the app always opens on the map, and the game starts only from its button.
  open({ kind: GAME_VIEW, props: {} });
}

// ---------- the controller ----------

let map: MapLibreMap;
let game: Game | null = null;
let mode: Mode = 'normal';
const fx = new Fx();
let raf = 0;
let last = 0;
let hudAt = 0;
let sector = 0;
let moving = false;
let mc0 = new MercatorCoordinate(0.5, 0.5, 0);
let uM = 1;
let feedTimer: ReturnType<typeof setTimeout> | undefined;
let feed: { list: AircraftPosition[]; at: number } = { list: [], at: 0 };
let saved: { center: [number, number]; zoom: number; bearing: number; pitch: number; handlers: string[] } | null = null;
let overTimer: ReturnType<typeof setTimeout> | undefined;
let canvasEl: HTMLCanvasElement | null = null;

export function setupGame(ctx: FeatureContext) {
  map = ctx.map;
  // For the e2e tests and debugging, like window.map.
  (window as unknown as { nmGame: unknown }).nmGame = {
    get game() {
      return game;
    },
    toScreen(v: Vec) {
      const xf = xform();
      return { x: xf.cx + v.x * xf.u, y: xf.cy + v.y * xf.u };
    },
  };
  effect(() => {
    if (isGameOn.value) enter();
    else leave();
  });
  effect(() => {
    const s = settings.value;
    setVolumes(s.sfx, s.music, s.muted);
    setVibration(s.vibration);
    fx.reduce = s.reduceFlashes;
  });
}

function saveSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.peek(), ...patch };
  save(KEYS.settings, settings.peek());
}

const HANDLERS = ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'] as const;

function enter() {
  if (saved) return;
  const c = map.getCenter();
  saved = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), handlers: [] };
  for (const h of HANDLERS) {
    const handler = map[h] as { isEnabled(): boolean; disable(): void } | undefined;
    if (handler?.isEnabled()) {
      saved.handlers.push(h);
      handler.disable();
    }
  }
  immersive.value = true;
  document.documentElement.classList.add('in-game');
  screen.value = 'title';
  over.value = null;
  game = null;
  hud.value = null;
  goSector(0, true);
  // Opened from a link: the shell may still move the camera while the map loads.
  if (!map.loaded()) map.once('load', () => saved && !moving && goSector(sector, true));
  void refreshFeed();
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('blur', onBlur);
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function leave() {
  if (!saved) return;
  cancelAnimationFrame(raf);
  clearTimeout(feedTimer);
  clearTimeout(overTimer);
  music(false);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onHidden);
  window.removeEventListener('blur', onBlur);
  for (const h of saved.handlers) (map[h as (typeof HANDLERS)[number]] as { enable(): void }).enable();
  map.jumpTo({ center: saved.center, zoom: saved.zoom, bearing: saved.bearing, pitch: saved.pitch });
  saved = null;
  game = null;
  hud.value = null;
  captain.value = null;
  immersive.value = false;
  document.documentElement.classList.remove('in-game');
}

export function exitGame() {
  sfx.click();
  if (isGameOn.peek()) back();
}

// ----- geometry: arena units <-> map -----

function setSector(i: number) {
  sector = i;
  const g = SECTOR_GEO[i];
  mc0 = MercatorCoordinate.fromLngLat({ lng: g.c[0], lat: g.c[1] });
  uM = mc0.meterInMercatorCoordinateUnits() * g.r;
}

function toUnits(lng: number, lat: number): Vec {
  const m = MercatorCoordinate.fromLngLat({ lng, lat });
  return { x: (m.x - mc0.x) / uM, y: (m.y - mc0.y) / uM };
}

function toLngLat(v: Vec): [number, number] {
  const ll = new MercatorCoordinate(mc0.x + v.x * uM, mc0.y + v.y * uM, 0).toLngLat();
  return [ll.lng, ll.lat];
}

function xform(): Xf {
  const box = map.getContainer().getBoundingClientRect();
  const p0 = map.project(toLngLat({ x: 0, y: 0 }));
  const p1 = map.project(toLngLat({ x: 1, y: 0 }));
  return { cx: p0.x + box.left, cy: p0.y + box.top, u: Math.max(1, p1.x - p0.x) };
}

function goSector(i: number, now: boolean) {
  setSector(i);
  const a = toLngLat({ x: -1, y: -1 });
  const b = toLngLat({ x: 1, y: 1 });
  moving = true;
  const done = () => {
    moving = false;
    fitArena();
  };
  map.stop();
  map.fitBounds([[a[0], b[1]], [b[0], a[1]]], { padding: { top: 70, bottom: 30, left: 12, right: 12 }, bearing: 0, pitch: 0, duration: now ? 0 : 1400 });
  if (now) done();
  else map.once('moveend', done);
}

function fitArena() {
  if (!game) return;
  const xf = xform();
  const box = map.getContainer().getBoundingClientRect();
  const w = Math.min(xf.cx - box.left, box.right - xf.cx) / xf.u;
  // Room for the score at the top and the power-ups and shock button under the towers.
  const h = Math.min(xf.cy - box.top - 70, box.bottom - xf.cy - 84) / xf.u;
  game.setArena(Math.min(MAX_W, Math.max(0.6, w)), Math.min(MAX_H, Math.max(0.6, h)));
}

function onResize() {
  if (moving) return;
  goSector(sector, true);
}

// ----- real flights -----

async function refreshFeed() {
  clearTimeout(feedTimer);
  if (!saved) return;
  feedTimer = setTimeout(() => void refreshFeed(), FEED_MS);
  if (settings.peek().fictionalOnly || !providers.peek().flightsUrl) {
    feed = { list: [], at: Date.now() };
    pushFlights();
    return;
  }
  const a = toLngLat({ x: -MAX_W - 0.3, y: -MAX_H - 0.3 });
  const b = toLngLat({ x: MAX_W + 0.3, y: MAX_H + 0.3 });
  const at = sector;
  try {
    const res = await tools().call(liveFlights, { bbox: [a[0], b[1], b[0], a[1]] }, { cache: false });
    if (at !== sector || !saved) return;
    feed = { list: res.aircraft.filter((x) => !x.onGround), at: Date.now() };
  } catch {
    // No feed: training planes keep the game going.
    feed = { list: [], at: Date.now() };
  }
  pushFlights();
}

/** The feed as the engine wants it, moved on to now along each aircraft's track. */
function flightsNow(): FlightInput[] {
  const g = SECTOR_GEO[sector];
  const out: FlightInput[] = [];
  for (const a of feed.list) {
    const ms = (a.groundSpeedKmh ?? 0) / 3.6;
    const trk = ((a.track ?? 0) * Math.PI) / 180;
    const vel = { x: (ms * Math.sin(trk)) / g.r, y: (-ms * Math.cos(trk)) / g.r };
    const age = (a.ageS ?? 0) + (Date.now() - feed.at) / 1000;
    const p = toUnits(a.lngLat[0], a.lngLat[1]);
    const pos = { x: p.x + vel.x * age, y: p.y + vel.y * age };
    if (Math.abs(pos.x) > MAX_W + 0.5 || Math.abs(pos.y) > MAX_H + 0.5) continue;
    out.push({ id: a.hex, pos, vel, heading: a.track ?? 0 });
  }
  return out;
}

function pushFlights() {
  game?.setFlights(flightsNow());
}

// ----- starting and the loop -----

export function startShift(m: Mode) {
  unlock();
  sfx.click();
  mode = m;
  const s = settings.peek();
  const seed = m === 'daily' ? dailySeed(new Date()) : Math.floor(Math.random() * 2 ** 31);
  const tutorial = m === 'tutorial' || (m === 'normal' && !load<boolean>(KEYS.tutorial, false));
  game = new Game({ seed, difficulty: m === 'daily' ? 'normal' : s.difficulty, tutorial, aimAssist: s.aimAssist });
  fx.particles = [];
  fx.pops = [];
  fx.rings = [];
  over.value = null;
  captain.value = null;
  clearTimeout(overTimer);
  goSector(0, sector === 0);
  pushFlights();
  screen.value = 'play';
  music(s.music > 0 && !s.muted);
  handle(game.drain());
  updateHud(true);
}

function frame(t: number) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  const c = canvasEl?.getContext('2d');
  const running = screen.value === 'play' && !moving && countdown.peek() <= 0;
  if (game && running) {
    game.step(dt);
    handle(game.drain());
  }
  fx.step(dt);
  if (captain.peek() && captain.peek()!.until < Date.now()) captain.value = null;
  if (!c || !canvasEl) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  if (canvasEl.width !== Math.round(W * dpr) || canvasEl.height !== Math.round(H * dpr)) {
    canvasEl.width = Math.round(W * dpr);
    canvasEl.height = Math.round(H * dpr);
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const xf = xform();
  const time = t / 1000;
  if (game) drawGame(c, W, H, xf, game, fx, time, { preferred: preferred, showLead: game.phase === 'tutorial' && game.tutorialStep === 2, hideEntities: moving });
  else {
    // Title screen: the real sky, calm.
    drawBackdrop(c, W, H, xf, fx);
    drawFlights(
      c,
      xf,
      flightsNow().map((f) => ({ ...f, real: true, shield: 0, threat: 0 })),
      time,
    );
  }
  if (t - hudAt > 120) updateHud(false);
}

let preferred: number | null = null;

function updateHud(force: boolean) {
  hudAt = performance.now();
  if (!game) return;
  const g = game;
  const next: Hud = {
    phase: g.phase,
    wave: g.wave,
    sector: sectorOf(Math.max(1, g.wave)),
    score: g.score,
    mult: g.mult,
    chances: g.chances,
    guard: g.guard,
    shocks: g.shocks,
    powers: (Object.entries(g.powers) as [PowerKind, number][]).filter(([, v]) => v > 0),
    remaining: g.remaining,
    intro: g.intro,
    boss: g.wave > 0 && g.wave % 5 === 0,
    tutorialStep: g.tutorialStep,
    summary: g.summary,
    daily: mode === 'daily',
    realFlights: g.flights.filter((f) => f.real).length,
  };
  const prev = hud.peek();
  if (force || !prev || JSON.stringify(prev) !== JSON.stringify(next)) hud.value = next;
  musicIntensity(Math.min(1, g.enemies.length / 12), next.boss);
}

function say(text: string, mood: Captain['mood'] = 'smile', ms = 4200) {
  captain.value = { text, mood, until: Date.now() + ms };
}

function handle(events: GameEvent[]) {
  for (const e of events) {
    fx.on(e);
    switch (e.type) {
      case 'launch':
        sfx.launch();
        break;
      case 'dry':
        sfx.dry();
        fx.pop({ x: 0, y: (game?.arena.h ?? 1) * 0.6 }, 'אין מיירטים, רגע של טעינה', '#ffd54a');
        break;
      case 'blast':
        sfx.blast();
        break;
      case 'kill':
        sfx.kill(e.mult);
        buzz(e.kind === 'boss' ? [60, 40, 120] : 12);
        if (e.kind === 'boss') say('ספינת האם נפלה! אתה אגדה, שומר!', 'wow');
        else if (e.multi === 3) say('שלושה בפיצוץ אחד! וואו!', 'wow', 2500);
        break;
      case 'hurt':
        sfx.hurt();
        break;
      case 'combo':
        sfx.combo(e.mult);
        if (e.mult === 3) say('קומבו ×3! תמשיך ככה!', 'wow', 2400);
        if (e.mult === 5) say('×5! בלתי ייאמן!', 'wow', 2400);
        break;
      case 'saved':
        sfx.saved();
        buzz([30, 30, 60]);
        if (e.by === 'chance') say('הזדמנות שנייה! הפעם זה עבר בשלום. תתרכז!', 'wow');
        break;
      case 'over':
        onOver(e.pos, e.kind);
        break;
      case 'wave':
        onWave(e.wave, e.sector, e.boss, e.newKinds);
        break;
      case 'clear':
        sfx.clear();
        say(e.summary.perfect ? 'גל מושלם! אף פספוס!' : 'כל הטיסות ניצלו! בחר שדרוג.', 'smile', 3500);
        break;
      case 'supply':
        sfx.supply();
        break;
      case 'drop':
        sfx.drop();
        break;
      case 'power':
        sfx.power();
        buzz(20);
        fx.pop({ x: e.pos.x, y: e.pos.y - 0.08 }, POWER_NAME[e.kind], '#ffd54a', true);
        break;
      case 'shock':
        sfx.shock();
        buzz([80, 40, 160]);
        break;
      case 'boss':
        sfx.boss();
        buzz([100, 60, 100]);
        break;
      case 'tutorial':
        if (e.step === 5) {
          if (!incognito.peek()) save(KEYS.tutorial, true);
        }
        break;
      case 'retry':
        fx.pop({ x: 0, y: 0 }, RETRY[Math.floor(Math.random() * RETRY.length)], '#ffd54a', true);
        break;
      case 'spawn':
        if (e.kind === 'dart' || e.kind === 'boss') sfx.warn();
        break;
    }
  }
  if (events.length) updateHud(false);
}

let lastSector = 0;
function onWave(wave: number, sec: number, boss: boolean, newKinds: EnemyKind[]) {
  sfx.wave();
  if (wave === 1) lastSector = 0;
  if (sec !== lastSector) {
    lastSector = sec;
    feed = { list: [], at: Date.now() };
    goSector(sec, false);
    void refreshFeed();
    say(`עוברים ל${SECTORS[sec]}! הטיסות שם צריכות אותנו.`, 'smile', 4000);
    return;
  }
  const first = newKinds.find((k) => NEW_KIND[k]);
  if (boss) say(NEW_KIND.boss!, 'wow', 5000);
  else if (first) say(NEW_KIND[first]!, 'smile', 5000);
  else if (wave === 1) say('גל ראשון! זמזמים איטיים, התחממות.', 'smile', 3500);
  else say(WAVE_LINES[wave % WAVE_LINES.length], 'smile', 3000);
}

function onOver(pos: Vec, kind: EnemyKind) {
  sfx.over();
  buzz([200, 80, 300]);
  music(false);
  const g = game!;
  // A slow push in on where it happened, then the results.
  const ll = toLngLat(pos);
  map.easeTo({ center: ll, zoom: map.getZoom() + 0.6, duration: 1600 });
  const isDaily = mode === 'daily';
  const keep = !incognito.peek();
  const entry: Score = { score: g.score, wave: g.wave, name: settings.peek().name || 'שומר', difficulty: g.difficulty, daily: isDaily, at: Date.now() };
  const before = scores.peek()[0]?.score ?? 0;
  const { list, rank } = addScore(scores.peek(), entry);
  const life = addLifetime(lifetime.peek(), g.stats);
  const earned = newBadges(badges.peek(), g.stats, g.score, life, { daily: isDaily, tutorial: load<boolean>(KEYS.tutorial, false) });
  const seed = dailySeed(new Date());
  const prevDaily = daily.peek().seed === seed ? daily.peek().best : 0;
  const best = isDaily ? Math.max(prevDaily, g.score) : Math.max(before, g.score);
  const record = g.score > 0 && g.score > (isDaily ? prevDaily : before);
  if (keep) {
    scores.value = list;
    lifetime.value = life;
    badges.value = [...badges.peek(), ...earned.map((b) => b.id)];
    save(KEYS.scores, list);
    save(KEYS.life, life);
    save(KEYS.badges, badges.peek());
    if (isDaily) {
      daily.value = { seed, best };
      save(KEYS.daily, daily.peek());
    }
  }
  over.value = { score: g.score, wave: g.wave, best, record, rank: keep ? rank : null, stats: g.stats, badges: earned, tip: TIPS[kind], saved: keep, daily: isDaily };
  clearTimeout(overTimer);
  overTimer = setTimeout(() => {
    if (saved) screen.value = 'over';
  }, 1900);
}

// ----- input -----

function onKey(e: KeyboardEvent) {
  if (!saved) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' || k === 'p') {
    e.preventDefault();
    if (screen.peek() === 'play') pause();
    else if (screen.peek() === 'pause') unpause();
    return;
  }
  if (k === 'm') {
    saveSettings({ muted: !settings.peek().muted });
    return;
  }
  if (screen.peek() !== 'play' || !game) return;
  if (k === ' ') {
    e.preventDefault();
    useShock();
  }
  if (['1', '2', '3', '4'].includes(k)) {
    const i = Number(k) - 1;
    preferred = preferred === i ? null : i;
    game.prefer(preferred);
  }
}

export function useShock() {
  game?.useShock();
  if (game) handle(game.drain());
}

function onHidden() {
  if (document.visibilityState === 'hidden') {
    if (screen.peek() === 'play' && game && game.phase !== 'over') pause();
    suspend();
  } else resume();
}

function onBlur() {
  if (screen.peek() === 'play' && game && game.phase !== 'over' && game.phase !== 'clear') pause();
}

export function pause() {
  if (screen.peek() !== 'play') return;
  screen.value = 'pause';
  music(false);
}

export function unpause() {
  sfx.click();
  screen.value = 'play';
  countdown.value = 3;
  const tick = () => {
    countdown.value--;
    if (countdown.peek() > 0) setTimeout(tick, 700);
    else {
      const s = settings.peek();
      music(s.music > 0 && !s.muted);
    }
  };
  setTimeout(tick, 700);
}

function tapAt(e: PointerEvent) {
  if (!game || screen.peek() !== 'play' || countdown.peek() > 0) return;
  unlock();
  const xf = xform();
  game.tap({ x: (e.clientX - xf.cx) / xf.u, y: (e.clientY - xf.cy) / xf.u });
  handle(game.drain());
}

function choose(k: UpgradeKind) {
  sfx.click();
  game?.chooseUpgrade(k);
  if (game) handle(game.drain());
  updateHud(true);
}

function tutorialNext() {
  sfx.click();
  game?.tutorialNext();
  if (game) handle(game.drain());
  updateHud(true);
}

function skipTutorial() {
  sfx.click();
  if (!incognito.peek()) save(KEYS.tutorial, true);
  game?.skipTutorial();
  if (game) handle(game.drain());
  updateHud(true);
}

// ----- sharing a result -----

async function share(o: Over) {
  sfx.click();
  const url = `${location.origin}${location.pathname}`;
  const text = `הצלתי טיסות ב"שומרי השמיים": ${o.score.toLocaleString('he-IL')} נקודות, הגעתי לגל ${o.wave}. נסה לעקוף אותי!`;
  const blob = await scoreImage(o);
  const file = blob ? new File([blob], 'shomrei-hashamaim.png', { type: 'image/png' }) : null;
  try {
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], text, url });
    if (navigator.share) return await navigator.share({ text, url });
  } catch {
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('הקישור הועתק');
  } catch {
    toast(text);
  }
}

function scoreImage(o: Over): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1080;
  const x = c.getContext('2d');
  if (!x) return Promise.resolve(null);
  const g = x.createLinearGradient(0, 0, 0, 1080);
  g.addColorStop(0, '#071430');
  g.addColorStop(1, '#14062a');
  x.fillStyle = g;
  x.fillRect(0, 0, 1080, 1080);
  x.strokeStyle = 'rgba(77,243,255,0.25)';
  for (let r = 120; r < 900; r += 120) {
    x.beginPath();
    x.arc(540, 560, r, 0, Math.PI * 2);
    x.stroke();
  }
  x.textAlign = 'center';
  x.direction = 'rtl';
  x.fillStyle = '#4df3ff';
  x.font = '800 92px system-ui, sans-serif';
  x.fillText('שומרי השמיים', 540, 230);
  x.fillStyle = '#fff';
  x.font = '900 190px system-ui, sans-serif';
  x.fillText(o.score.toLocaleString('he-IL'), 540, 560);
  x.font = '600 56px system-ui, sans-serif';
  x.fillText(`נקודות · גל ${o.wave}`, 540, 660);
  x.fillStyle = '#ffd54a';
  x.font = '700 44px system-ui, sans-serif';
  x.fillText(`${o.stats.kills} יירוטים · קומבו ×${o.stats.maxMult}`, 540, 760);
  x.fillStyle = 'rgba(255,255,255,0.6)';
  x.font = '500 34px system-ui, sans-serif';
  x.fillText('משחק דמיוני במפות נדב', 540, 960);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

// ---------- UI ----------

export function GameButton() {
  return (
    <button class="ctrl game-ctrl" aria-label="מצב משחק: שומרי השמיים" title="מצב משחק: שומרי השמיים" onClick={openGame}>
      <Icon name="sports_esports" size={22} />
    </button>
  );
}

/** The shell's sheet is hidden while playing; everything is in the overlay. */
export function GameView() {
  return null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('he-IL');

function Bubble({ text, mood, children }: { text: string; mood: Captain['mood']; children?: preact.ComponentChildren }) {
  return (
    <div class="g-captain" role="status">
      <CaptainFace mood={mood} />
      <div class="g-bubble">
        <div class="g-bubble-name">קפטן רום</div>
        <p>{text}</p>
        {children}
      </div>
    </div>
  );
}

function TopHud({ h }: { h: Hud }) {
  const best = Math.max(scores.value[0]?.score ?? 0, h.score);
  return (
    <div class="g-top">
      <button class="g-icon" aria-label="השהיה" onClick={() => (sfx.click(), pause())}>
        <Icon name="pause" size={22} />
      </button>
      <div class="g-wave">
        {h.phase === 'tutorial' ? (
          <b>אימון</b>
        ) : (
          <>
            <b>גל {h.wave}</b>
            <span>{SECTORS[h.sector]}</span>
          </>
        )}
      </div>
      <div class="g-score">
        <b>{fmt(h.score)}</b>
        {h.mult > 1 && <span class={`g-mult m${Math.floor(h.mult)}`}>×{h.mult}</span>}
        <small>{h.daily ? 'אתגר יומי' : `שיא ${fmt(best)}`}</small>
      </div>
      <div class="g-lives" aria-label={`הזדמנויות שניות: ${h.chances}`}>
        {Array.from({ length: h.chances }, (_, i) => (
          <span key={i} class="g-life">
            <Icon name="favorite" size={16} />
          </span>
        ))}
        {h.guard > 0 && (
          <span class="g-guard" title="מגן שומר">
            <Icon name="shield" size={16} />
            {h.guard > 1 ? h.guard : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function BottomHud({ h }: { h: Hud }) {
  return (
    <div class="g-bottom">
      <div class="g-powers">
        {h.powers.map(([k, v]) => (
          <span key={k} class="g-power" title={POWER_NAME[k]}>
            <Icon name={POWER_ICON[k]} size={18} />
            {Math.ceil(v)}
          </span>
        ))}
      </div>
      {h.shocks > 0 && (
        <button class="g-shock" onClick={useShock} aria-label="גל הלם (רווח)">
          <Icon name="radar" size={20} />
          גל הלם{h.shocks > 1 ? ` ×${h.shocks}` : ''}
        </button>
      )}
    </div>
  );
}

function Intro({ h }: { h: Hud }) {
  if (h.phase !== 'intro') return null;
  return (
    <div class="g-banner" aria-live="polite">
      <div class="g-banner-sector">{SECTORS[h.sector]}</div>
      <div class="g-banner-wave">גל {h.wave}</div>
      {h.boss && <div class="g-banner-boss">ספינת אם!</div>}
    </div>
  );
}

function Clear({ h }: { h: Hud }) {
  const s = h.summary;
  if (h.phase !== 'clear' || !s) return null;
  return (
    <div class="g-center">
    <div class="g-card g-clear">
      <h2>גל {s.wave} הושלם!</h2>
      <div class="g-stats">
        <div>
          <b>{fmt(s.points)}</b>נקודות
        </div>
        <div>
          <b>{s.kills}</b>יירוטים
        </div>
        <div>
          <b>{Math.round(s.accuracy * 100)}%</b>דיוק
        </div>
      </div>
      {s.perfect && <div class="g-perfect">גל מושלם! +2,000</div>}
      {s.ammoBonus > 0 && <div class="muted small">בונוס תחמושת שנשארה: +{fmt(s.ammoBonus)}</div>}
      <h3>בחר שדרוג</h3>
      <div class="g-upgrades">
        {s.options.map((k) => (
          <button key={k} class="g-upgrade" onClick={() => choose(k)}>
            <Icon name={UPGRADE_TEXT[k].icon} size={26} />
            <b>{UPGRADE_TEXT[k].title}</b>
            <span>{UPGRADE_TEXT[k].text}</span>
          </button>
        ))}
      </div>
    </div>
    </div>
  );
}

function Title() {
  const best = scores.value[0]?.score ?? 0;
  const todaySeed = dailySeed(new Date());
  const d = daily.value.seed === todaySeed ? daily.value.best : 0;
  return (
    <div class="g-screen g-title">
      <div class="g-logo">
        <Icon name="shield" size={40} />
        <h1>שומרי השמיים</h1>
        <p>הטיסות אמיתיות. הפולשים לא.</p>
      </div>
      <Bubble text="השמיים מעל ישראל מלאים בטיסות אמיתיות, ופולשים דמיוניים בדרך אליהן. מוכן למשמרת?" mood="smile" />
      <div class="g-menu">
        <button class="g-btn primary" onClick={() => startShift('normal')}>
          <Icon name="play_arrow" /> התחל משמרת
        </button>
        <button class="g-btn" onClick={() => startShift('daily')}>
          <Icon name="calendar_month" /> אתגר יומי{d ? ` · שיא היום ${fmt(d)}` : ''}
        </button>
        <div class="g-row">
          <button class="g-btn small" onClick={() => startShift('tutorial')}>
            <Icon name="help" /> איך משחקים
          </button>
          <button class="g-btn small" onClick={() => (sfx.click(), (screen.value = 'scores'))}>
            <Icon name="military_tech" /> שיאים
          </button>
          <button class="g-btn small" onClick={() => (sfx.click(), (settingsBack.value = 'title'), (screen.value = 'settings'))}>
            <Icon name="settings" /> הגדרות
          </button>
        </div>
        {best > 0 && <div class="g-best">השיא שלך: {fmt(best)}</div>}
        <button class="g-link" onClick={exitGame}>
          <Icon name="close" size={18} /> חזרה למפה
        </button>
      </div>
      <p class="g-disclaimer">משחק דמיוני. האויבים, הנשק והקרבות לא אמיתיים, והמשחק רק קורא את מיקומי הטיסות. {incognito.value ? 'בגלישה בסתר התוצאות לא נשמרות.' : ''}</p>
    </div>
  );
}

function Pause() {
  return (
    <div class="g-screen g-dim">
      <div class="g-card">
        <h2>הפסקה</h2>
        <div class="g-menu">
          <button class="g-btn primary" onClick={unpause}>
            <Icon name="play_arrow" /> המשך
          </button>
          <button class="g-btn" onClick={() => startShift(mode === 'daily' ? 'daily' : 'normal')}>
            <Icon name="replay" /> משמרת חדשה
          </button>
          <button class="g-btn" onClick={() => (sfx.click(), (settingsBack.value = 'pause'), (screen.value = 'settings'))}>
            <Icon name="settings" /> הגדרות
          </button>
          <button class="g-btn" onClick={exitGame}>
            <Icon name="close" /> יציאה למפה
          </button>
        </div>
        <p class="g-disclaimer">משחק דמיוני. מקשים: P השהיה, רווח גל הלם, M השתקה, 1-4 בחירת מגדל.</p>
      </div>
    </div>
  );
}

function Range({ label, value, onInput }: { label: string; value: number; onInput: (v: number) => void }) {
  return (
    <label class="g-set">
      <span>{label}</span>
      <input type="range" min="0" max="1" step="0.05" value={value} onInput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))} />
    </label>
  );
}

function Toggle({ label, hint, on, set }: { label: string; hint?: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label class="g-set">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={on} onChange={(e) => set((e.currentTarget as HTMLInputElement).checked)} />
    </label>
  );
}

function SettingsScreen() {
  const s = settings.value;
  return (
    <div class="g-screen g-dim">
      <div class="g-card g-settings">
        <h2>הגדרות</h2>
        <label class="g-set">
          <span>הכינוי שלך</span>
          <input type="text" maxLength={16} value={s.name} onInput={(e) => saveSettings({ name: (e.currentTarget as HTMLInputElement).value })} />
        </label>
        <Range label="אפקטים" value={s.sfx} onInput={(v) => saveSettings({ sfx: v })} />
        <Range label="מוזיקה" value={s.music} onInput={(v) => saveSettings({ music: v })} />
        <Toggle label="השתקה" on={s.muted} set={(v) => saveSettings({ muted: v })} />
        <Toggle label="רטט" hint="באנדרואיד. אייפון לא תומך ברטט מאתר." on={s.vibration} set={(v) => saveSettings({ vibration: v })} />
        <div class="g-set">
          <span>רמת קושי</span>
          <div class="g-seg" role="radiogroup">
            {(
              [
                ['rookie', 'טירון'],
                ['normal', 'רגיל'],
                ['expert', 'מומחה'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={s.difficulty === k} class={s.difficulty === k ? 'on' : ''} onClick={() => saveSettings({ difficulty: k })}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <p class="muted small">טירון: 3 הזדמנויות שניות, פולשים איטיים. רגיל: נפסלים בפגיעה הראשונה. מומחה: בלי סיוע ובלי חיים, ניקוד כפול. הקושי חל מהמשמרת הבאה.</p>
        <Toggle label="סיוע בכיוון" hint="נגיעה ליד פולש נצמדת לנקודת המפגש" on={s.aimAssist} set={(v) => saveSettings({ aimAssist: v })} />
        <Toggle label="הפחתת הבזקים" hint="פחות רעד והבזקים" on={s.reduceFlashes} set={(v) => saveSettings({ reduceFlashes: v })} />
        <Toggle label="מטוסים דמיוניים בלבד" hint="בלי טיסות אמיתיות" on={s.fictionalOnly} set={(v) => (saveSettings({ fictionalOnly: v }), void refreshFeed())} />
        <button class="g-btn primary" onClick={() => (sfx.click(), (screen.value = settingsBack.peek()))}>
          סיום
        </button>
      </div>
    </div>
  );
}

function Scores() {
  const list = scores.value;
  const have = badges.value;
  const life = lifetime.value;
  return (
    <div class="g-screen g-dim">
      <div class="g-card g-scores">
        <h2>שיאים</h2>
        {list.length ? (
          <ol class="g-table">
            {list.map((s, i) => (
              <li key={s.at}>
                <span class="g-rank">{i + 1}</span>
                <span class="g-name">{s.name}</span>
                <span class="muted small">
                  גל {s.wave}
                  {s.daily ? ' · יומי' : s.difficulty !== 'normal' ? ` · ${s.difficulty === 'rookie' ? 'טירון' : 'מומחה'}` : ''}
                </span>
                <b>{fmt(s.score)}</b>
              </li>
            ))}
          </ol>
        ) : (
          <p class="muted">עוד אין שיאים. המשמרת הראשונה מחכה לך!</p>
        )}
        <p class="muted small">
          {life.games} משמרות · {fmt(life.kills)} יירוטים · {life.bossKills} ספינות אם · גל הכי רחוק {life.bestWave}
        </p>
        <h3>
          הישגים {have.length}/{BADGES.length}
        </h3>
        <div class="g-badges">
          {BADGES.map((b) => (
            <div key={b.id} class={`g-badge ${have.includes(b.id) ? 'on' : ''}`} title={b.hint}>
              <Icon name={b.icon} size={22} />
              <b>{b.title}</b>
              <span>{b.hint}</span>
            </div>
          ))}
        </div>
        <p class="muted small">השיאים נשמרים רק במכשיר הזה.</p>
        <button class="g-btn primary" onClick={() => (sfx.click(), (screen.value = 'title'))}>
          חזרה
        </button>
      </div>
    </div>
  );
}

function OverScreen() {
  const o = over.value;
  if (!o) return null;
  return (
    <div class="g-screen g-dim">
      <div class="g-card g-over">
        <h2>המשמרת הסתיימה</h2>
        {o.record && <div class="g-record">שיא חדש!</div>}
        <div class="g-final">{fmt(o.score)}</div>
        <div class="muted">
          הגעת לגל {o.wave} · {o.daily ? 'שיא היום' : 'השיא שלך'} {fmt(o.best)}
          {o.rank ? ` · מקום ${o.rank} בטבלה` : ''}
        </div>
        <div class="g-stats">
          <div>
            <b>{o.stats.kills}</b>יירוטים
          </div>
          <div>
            <b>{o.stats.shots ? Math.round((o.stats.hits / o.stats.shots) * 100) : 0}%</b>דיוק
          </div>
          <div>
            <b>×{o.stats.maxMult}</b>קומבו
          </div>
        </div>
        {o.badges.length > 0 && (
          <div class="g-new-badges">
            {o.badges.map((b) => (
              <span key={b.id} class="g-badge on">
                <Icon name={b.icon} size={18} />
                <b>{b.title}</b>
              </span>
            ))}
          </div>
        )}
        <Bubble text={o.tip} mood="sad" />
        {!o.saved && <p class="muted small">גלישה בסתר: התוצאה לא נשמרה.</p>}
        <div class="g-menu">
          <button class="g-btn primary" onClick={() => startShift(o.daily ? 'daily' : 'normal')}>
            <Icon name="replay" /> משמרת חדשה
          </button>
          <div class="g-row">
            <button class="g-btn small" onClick={() => void share(o)}>
              <Icon name="share" /> שתף
            </button>
            <button class="g-btn small" onClick={() => (sfx.click(), (game = null), (hud.value = null), (screen.value = 'title'), goSector(0, false))}>
              <Icon name="home" /> תפריט
            </button>
            <button class="g-btn small" onClick={exitGame}>
              <Icon name="close" /> יציאה
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);
  const on = isGameOn.value;
  useEffect(() => {
    canvasEl = ref.current;
    return () => {
      if (canvasEl === ref.current) canvasEl = null;
    };
  });
  if (!on) return null;
  const sc = screen.value;
  const h = hud.value;
  const cap = captain.value;
  const tut = h && h.phase === 'tutorial' ? TUTORIAL[h.tutorialStep] : null;
  return (
    <div class="g-root" dir="rtl">
      <canvas ref={ref} class="g-canvas" onPointerDown={tapAt} aria-label="זירת המשחק: נגיעה משגרת מיירט" />
      {sc !== 'title' && h && (
        <>
          <TopHud h={h} />
          {sc === 'play' && <BottomHud h={h} />}
          {sc === 'play' && <Intro h={h} />}
          {sc === 'play' && <Clear h={h} />}
          {sc === 'play' && tut && <Bubble text={tut.text} mood="smile" />}
          {sc === 'play' && tut && (
            // Below the towers, where nothing needs a tap (the bubble lets taps through to the sky).
            <div class="g-tut-actions">
              {tut.next && (
                <button class="g-btn primary small" onClick={tutorialNext}>
                  {tut.next}
                </button>
              )}
              <button class="g-link" onClick={skipTutorial}>
                דלג על ההדרכה
              </button>
            </div>
          )}
          {sc === 'play' && !tut && cap && h.phase !== 'clear' && <Bubble text={cap.text} mood={cap.mood} />}
          {sc === 'play' && countdown.value > 0 && <div class="g-count">{countdown.value}</div>}
        </>
      )}
      {sc === 'title' && <Title />}
      {sc === 'pause' && <Pause />}
      {sc === 'settings' && <SettingsScreen />}
      {sc === 'scores' && <Scores />}
      {sc === 'over' && <OverScreen />}
    </div>
  );
}
