/**
 * "שומרי השמיים": the game's rules, with no map, DOM or clock in it, so it can be unit tested
 * and the daily challenge plays the same for everyone (one seed per day).
 *
 * Coordinates are arena units: (0,0) is the middle of the sector, +y points down (south), and
 * 1 unit is the sector's radius. The view converts them to map positions. The arena is the
 * visible part of the map: x in [-w, w], y in [-h, h], so at least one of w, h is about 1.
 * Every speed is in units per second, so the game plays the same at any zoom or screen size.
 */

export interface Vec {
  x: number;
  y: number;
}

export type EnemyKind = 'buzzer' | 'dart' | 'zigzag' | 'armor' | 'splitter' | 'ghost' | 'jammer' | 'mini' | 'boss';
export type PowerKind = 'fast' | 'shield' | 'ammo' | 'big' | 'homing' | 'slow' | 'life' | 'shock';
export type UpgradeKind = 'speed' | 'blast' | 'launcher' | 'reload' | 'guard' | 'supply' | 'capacity';
export type Difficulty = 'rookie' | 'normal' | 'expert';
export type Phase = 'tutorial' | 'intro' | 'play' | 'clear' | 'over';

export interface Flight {
  id: string;
  pos: Vec;
  vel: Vec;
  /** Degrees, 0 = north. */
  heading: number;
  /** A real flight in the air now, or a made-up training plane. */
  real: boolean;
  /** Seconds of shield left. */
  shield: number;
  /** 0 (safe) to 1 (an invader is about to reach it). */
  threat: number;
}

export interface WeakPoint {
  dx: number;
  dy: number;
  hp: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pos: Vec;
  vel: Vec;
  hp: number;
  maxHp: number;
  speed: number;
  target: string | null;
  /** Seconds alive. */
  t: number;
  visible: boolean;
  /** Boss only. */
  weak?: WeakPoint[];
  /** Jammer only: seconds spent hovering. */
  hover?: number;
}

export interface Interceptor {
  id: number;
  from: Vec;
  pos: Vec;
  target: Vec;
  speed: number;
  /** Enemy id it locks on to (homing power). */
  lock: number | null;
}

export interface Blast {
  id: number;
  pos: Vec;
  r: number;
  maxR: number;
  t: number;
  hit: number[];
  kills: number;
  /** Opened the supply plane or picked up a capsule: never a miss. */
  useful: boolean;
}

export interface Supply {
  pos: Vec;
  vel: Vec;
  opened: boolean;
}

export interface Capsule {
  id: number;
  pos: Vec;
  kind: PowerKind;
  /** Seconds left before it is gone. */
  left: number;
}

export interface Launcher {
  pos: Vec;
  ammo: number;
  max: number;
  /** Seconds until the next round is loaded. */
  reload: number;
}

export type GameEvent =
  | { type: 'launch'; from: Vec; to: Vec }
  | { type: 'dry' }
  | { type: 'blast'; pos: Vec; r: number }
  | { type: 'kill'; pos: Vec; kind: EnemyKind; points: number; mult: number; multi: number; close: boolean }
  | { type: 'hurt'; pos: Vec; kind: EnemyKind }
  | { type: 'miss' }
  | { type: 'combo'; mult: number }
  | { type: 'saved'; pos: Vec; by: 'shield' | 'guard' | 'chance' }
  | { type: 'over'; pos: Vec; kind: EnemyKind }
  | { type: 'wave'; wave: number; sector: number; boss: boolean; newKinds: EnemyKind[] }
  | { type: 'clear'; summary: WaveSummary }
  | { type: 'supply' }
  | { type: 'drop'; pos: Vec }
  | { type: 'power'; kind: PowerKind; pos: Vec }
  | { type: 'shock' }
  | { type: 'split'; pos: Vec }
  | { type: 'boss'; pos: Vec }
  | { type: 'tutorial'; step: number }
  | { type: 'retry' }
  | { type: 'spawn'; pos: Vec; kind: EnemyKind };

export interface WaveSummary {
  wave: number;
  points: number;
  kills: number;
  shots: number;
  accuracy: number;
  ammoBonus: number;
  perfect: boolean;
  options: UpgradeKind[];
}

export interface Stats {
  kills: number;
  shots: number;
  hits: number;
  maxMult: number;
  perfectWaves: number;
  bossKills: number;
  multiKills: number;
  tripleKills: number;
  closeSaves: number;
  powerups: number;
  shockKills: number;
  wave: number;
  /** Kills by kind. */
  byKind: Partial<Record<EnemyKind, number>>;
}

// ---------- tuning (all the numbers to balance in one place) ----------

export const ENEMY: Record<EnemyKind, { speed: number; hp: number; points: number; r: number; from: number; turn: number }> = {
  buzzer: { speed: 0.085, hp: 1, points: 100, r: 0.035, from: 1, turn: 2.5 },
  dart: { speed: 0.2, hp: 1, points: 200, r: 0.03, from: 3, turn: 0.9 },
  zigzag: { speed: 0.1, hp: 1, points: 150, r: 0.035, from: 4, turn: 2.5 },
  armor: { speed: 0.06, hp: 3, points: 400, r: 0.05, from: 6, turn: 1.5 },
  splitter: { speed: 0.08, hp: 1, points: 250, r: 0.045, from: 8, turn: 2 },
  ghost: { speed: 0.11, hp: 1, points: 200, r: 0.035, from: 10, turn: 2 },
  jammer: { speed: 0.065, hp: 2, points: 300, r: 0.045, from: 12, turn: 2 },
  mini: { speed: 0.12, hp: 1, points: 50, r: 0.025, from: 99, turn: 3 },
  boss: { speed: 0.03, hp: 1, points: 5000, r: 0.16, from: 5, turn: 1 },
};
const WEAK_POINTS = 500;
const WEAK_R = 0.04;
const FLIGHT_R = 0.045;
const INTERCEPTOR_SPEED = 0.95;
const BLAST_R = 0.12;
const BLAST_GROW = 0.22;
const BLAST_HOLD = 0.18;
const BLAST_FADE = 0.25;
const COMBO_S = 2;
const AMMO = 6;
const RELOAD_S = 1.6;
const SUPPLY_SPEED = 0.28;
const CAPSULE_S = 5;
const CAPSULE_FALL = 0.06;
const JAM_R = 0.32;
const TAP_R = 0.09;
const MAX_CHANCES = 3;
const TRAINING_MIN = 4;

export const POWER_S: Record<PowerKind, number> = { fast: 15, shield: 20, ammo: 12, big: 15, homing: 15, slow: 10, life: 0, shock: 0 };
const POWER_WEIGHT: Record<PowerKind, number> = { fast: 3, shield: 3, ammo: 3, big: 2, homing: 2, slow: 2, life: 1, shock: 1 };
export const UPGRADES: UpgradeKind[] = ['speed', 'blast', 'launcher', 'reload', 'guard', 'supply', 'capacity'];
/** Upgrades that can be taken only once. */
const ONCE: UpgradeKind[] = ['launcher'];

export const WAVES_PER_SECTOR = 5;
/** 0 center, 1 north, 2 Jerusalem, 3 south, 4 all of Israel (from wave 21 on). */
export const sectorOf = (wave: number) => Math.min(4, Math.floor((wave - 1) / WAVES_PER_SECTOR));
export const isBossWave = (wave: number) => wave % WAVES_PER_SECTOR === 0;

// ---------- random ----------

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One seed per calendar day (in the player's time zone), for the daily challenge. */
export function dailySeed(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function pick<T>(r: () => number, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let x = r() * total;
  for (const i of items) {
    x -= weight(i);
    if (x <= 0) return i;
  }
  return items[items.length - 1];
}

// ---------- waves ----------

export interface Spawn {
  at: number;
  kind: EnemyKind;
}

export interface WavePlan {
  wave: number;
  boss: boolean;
  spawns: Spawn[];
  /** Enemy speed multiplier for this wave. */
  speed: number;
}

const REGULAR: EnemyKind[] = ['buzzer', 'dart', 'zigzag', 'armor', 'splitter', 'ghost', 'jammer'];
export const kindsFor = (wave: number) => REGULAR.filter((k) => ENEMY[k].from <= wave);

/** How many invaders a wave has: more every wave, with a breather in the middle of each sector. */
export function waveCount(wave: number): number {
  const n = Math.min(40, Math.round(4 + wave * 2.2));
  return wave % WAVES_PER_SECTOR === 3 ? Math.round(n * 0.6) : n;
}

export function planWave(wave: number, r: () => number, difficulty: Difficulty = 'normal'): WavePlan {
  const boss = isBossWave(wave);
  const count = boss ? Math.round(waveCount(wave) * 0.4) : waveCount(wave);
  const kinds = kindsFor(wave);
  const duration = 14 + count * 1.25;
  const spawns: Spawn[] = [];
  let at = 1.2;
  while (spawns.length < count) {
    // Groups grow from 1 to 3 at once.
    const group = 1 + Math.floor(r() * Math.min(3, 1 + wave / 6));
    for (let i = 0; i < group && spawns.length < count; i++) {
      // Newer kinds show up more, so each new one gets noticed.
      const kind = pick(r, kinds, (k) => 1 + (ENEMY[k].from >= wave - 2 ? 1.5 : 0) + (k === 'buzzer' ? 1 : 0));
      spawns.push({ at: at + i * 0.35, kind });
    }
    at += (duration / count) * group * (0.6 + r() * 0.8);
  }
  if (boss) spawns.unshift({ at: 0.5, kind: 'boss' });
  const speed = (1 + Math.min(1, (wave - 1) * 0.045)) * (difficulty === 'rookie' ? 0.75 : 1);
  return { wave, boss, spawns, speed };
}

// ---------- the game ----------

export interface GameOptions {
  seed: number;
  difficulty?: Difficulty;
  tutorial?: boolean;
  /** Snap taps to where an invader will be: on by default, never in expert. */
  aimAssist?: boolean;
}

export interface FlightInput {
  id: string;
  pos: Vec;
  vel: Vec;
  heading: number;
}

const len = (v: Vec) => Math.hypot(v.x, v.y);
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
const norm = (v: Vec): Vec => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};

export class Game {
  readonly difficulty: Difficulty;
  readonly aimAssist: boolean;
  phase: Phase;
  /** Seconds of play, paused time excluded. */
  time = 0;
  wave = 0;
  score = 0;
  chances: number;
  arena = { w: 1, h: 1.6 };
  flights: Flight[] = [];
  enemies: Enemy[] = [];
  interceptors: Interceptor[] = [];
  blasts: Blast[] = [];
  supply: Supply | null = null;
  capsules: Capsule[] = [];
  launchers: Launcher[] = [];
  /** Seconds left of each timed power. */
  powers: Partial<Record<PowerKind, number>> = {};
  shocks = 0;
  guard = 0;
  upgrades: UpgradeKind[] = [];
  chain = 0;
  mult = 1;
  lastKill = -99;
  tutorialStep = 0;
  /** Where the hit that ended the game happened. */
  endedAt: Vec | null = null;
  summary: WaveSummary | null = null;
  stats: Stats = { kills: 0, shots: 0, hits: 0, maxMult: 1, perfectWaves: 0, bossKills: 0, multiKills: 0, tripleKills: 0, closeSaves: 0, powerups: 0, shockKills: 0, wave: 0, byKind: {} };

  private r: () => number;
  private events: GameEvent[] = [];
  private plan: WavePlan | null = null;
  private spawnIdx = 0;
  private waveT = 0;
  private wavePoints = 0;
  private waveKills = 0;
  private waveShots = 0;
  private waveMisses = 0;
  private supplyAt: number[] = [];
  private nextId = 1;
  private real: FlightInput[] = [];
  private bossSpawnT = 0;
  private preferred: number | null = null;
  private introLeft = 0;

  constructor(opts: GameOptions) {
    this.r = rng(opts.seed);
    this.difficulty = opts.difficulty ?? 'normal';
    this.aimAssist = this.difficulty !== 'expert' && opts.aimAssist !== false;
    this.chances = this.difficulty === 'rookie' ? 3 : 0;
    this.placeLaunchers();
    if (opts.tutorial) {
      this.phase = 'tutorial';
      this.tutorialStep = 0;
      this.emit({ type: 'tutorial', step: 0 });
    } else {
      this.phase = 'intro';
      this.startWave(1);
    }
  }

  drain(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  // ----- setup from the view -----

  setArena(w: number, h: number) {
    this.arena = { w, h };
    this.placeLaunchers();
  }

  private placeLaunchers() {
    const { w, h } = this.arena;
    const y = h * 0.86;
    const spots: Vec[] = [{ x: -w * 0.62, y: y - 0.03 }, { x: 0, y }, { x: w * 0.62, y: y - 0.03 }];
    if (this.upgrades.includes('launcher')) spots.push({ x: 0, y: -h * 0.05 });
    const max = AMMO + 2 * this.count('capacity');
    this.launchers = spots.map((pos, i) => {
      const old = this.launchers[i];
      return { pos, max, ammo: old ? Math.min(max, old.ammo + (max - old.max)) : max, reload: old?.reload ?? 0 };
    });
  }

  /** Real flights in the arena now; training planes make up the rest. */
  setFlights(list: FlightInput[]) {
    this.real = list;
    const byId = new Map(this.flights.map((f) => [f.id, f]));
    const real = list.map((f) => {
      const old = byId.get(f.id);
      return { id: f.id, pos: { ...f.pos }, vel: { ...f.vel }, heading: f.heading, real: true, shield: old?.shield ?? 0, threat: old?.threat ?? 0 };
    });
    this.flights = [...real, ...this.flights.filter((f) => !f.real)];
    this.fillTraining();
  }

  private fillTraining() {
    const inside = (f: Flight) => Math.abs(f.pos.x) < this.arena.w * 0.95 && Math.abs(f.pos.y) < this.arena.h * 0.8;
    const real = this.flights.filter((f) => f.real && inside(f)).length;
    let training = this.flights.filter((f) => !f.real);
    // Too many: drop the extra training planes (real ones came back into view).
    while (real + training.length > TRAINING_MIN && training.length) training = training.slice(1);
    this.flights = [...this.flights.filter((f) => f.real), ...training];
    while (real + training.length < TRAINING_MIN) {
      const f = this.trainingPlane(training.length === 0 && real === 0);
      training.push(f);
      this.flights.push(f);
    }
  }

  /** A made-up plane crossing the arena slowly, inside the part that is safe from the launchers. */
  private trainingPlane(middle: boolean): Flight {
    const { w, h } = this.arena;
    const fromLeft = this.r() < 0.5;
    const y = (this.r() * 1.2 - 0.75) * h * 0.8;
    const x = middle ? (this.r() - 0.5) * w : fromLeft ? -w * 1.05 : w * 1.05;
    const speed = 0.03 + this.r() * 0.02;
    const vel = { x: fromLeft ? speed : -speed, y: (this.r() - 0.5) * 0.01 };
    return { id: `t${this.nextId++}`, pos: { x, y }, vel, heading: fromLeft ? 90 : 270, real: false, shield: 0, threat: 0 };
  }

  // ----- player input -----

  /** A tap or click at a point: pick up a capsule, open the supply plane, or fire. */
  tap(p: Vec, launcher?: number) {
    if (this.phase !== 'play' && !(this.phase === 'tutorial' && this.tutorialWantsTap())) return;
    for (const c of this.capsules) {
      if (dist(c.pos, p) < TAP_R * 1.3) return this.collect(c);
    }
    if (this.supply && !this.supply.opened && dist(this.supply.pos, p) < TAP_R * 1.4) return this.openSupply();
    this.fire(p, launcher ?? this.preferred ?? undefined);
  }

  /** Keyboard 1-4: fire from this launcher until changed. */
  prefer(launcher: number | null) {
    this.preferred = launcher !== null && launcher < this.launchers.length ? launcher : null;
  }

  private fire(p: Vec, which?: number) {
    const unlimited = (this.powers.ammo ?? 0) > 0;
    const ready = this.launchers.map((l, i) => ({ l, i })).filter(({ l }) => unlimited || l.ammo > 0);
    if (!ready.length) return this.emit({ type: 'dry' });
    const chosen = which !== undefined && ready.some((x) => x.i === which) ? ready.find((x) => x.i === which)! : ready.reduce((a, b) => (dist(a.l.pos, p) <= dist(b.l.pos, p) ? a : b));
    const from = chosen.l.pos;
    const speed = this.interceptorSpeed();
    const { point, lock } = this.aim(p, from, speed);
    if (!unlimited) chosen.l.ammo--;
    this.interceptors.push({ id: this.nextId++, from: { ...from }, pos: { ...from }, target: point, speed, lock });
    this.stats.shots++;
    this.waveShots++;
    this.emit({ type: 'launch', from, to: point });
  }

  interceptorSpeed() {
    return INTERCEPTOR_SPEED * (1 + 0.15 * this.count('speed')) * ((this.powers.fast ?? 0) > 0 ? 2 : 1);
  }

  blastRadius() {
    const tutorial = this.phase === 'tutorial' ? 1.6 : 1;
    return BLAST_R * (1 + 0.15 * this.count('blast')) * ((this.powers.big ?? 0) > 0 ? 2 : 1) * tutorial;
  }

  /** Where an interceptor from `from` meets an enemy flying on as it is now. */
  intercept(e: Enemy, from: Vec, speed: number): Vec {
    let t = dist(from, e.pos) / speed;
    let p = e.pos;
    for (let i = 0; i < 4; i++) {
      p = add(e.pos, mul(e.vel, t));
      t = dist(from, p) / speed;
    }
    return p;
  }

  /** Aim assist: a tap close to where an invader is going (or, for rookies, where it is) snaps to the meeting point. */
  private aim(p: Vec, from: Vec, speed: number): { point: Vec; lock: number | null } {
    const homing = (this.powers.homing ?? 0) > 0;
    const radius = homing ? 0.3 : this.difficulty === 'rookie' ? 0.18 : 0.08;
    if (!this.aimAssist && !homing) return { point: p, lock: null };
    let best: { e: Enemy; d: number; at: Vec } | null = null;
    for (const e of this.enemies) {
      if (e.kind === 'boss') continue;
      const at = this.intercept(e, from, speed);
      const d = Math.min(dist(p, at), this.difficulty === 'rookie' || homing ? dist(p, e.pos) : Infinity);
      if (d < radius && (!best || d < best.d)) best = { e, d, at };
    }
    if (!best) return { point: p, lock: null };
    return { point: best.at, lock: homing ? best.e.id : null };
  }

  useShock() {
    if (this.phase !== 'play' || this.shocks <= 0) return;
    this.shocks--;
    this.emit({ type: 'shock' });
    for (const e of [...this.enemies]) {
      if (e.kind === 'boss') {
        for (const w of e.weak ?? []) if (w.hp > 0) w.hp--;
        this.emit({ type: 'hurt', pos: e.pos, kind: 'boss' });
        if ((e.weak ?? []).every((w) => w.hp <= 0)) this.kill(e, null, false);
        continue;
      }
      this.stats.shockKills++;
      this.kill(e, null, false);
    }
  }

  chooseUpgrade(k: UpgradeKind) {
    if (this.phase !== 'clear' || !this.summary?.options.includes(k)) return;
    this.upgrades.push(k);
    if (k === 'guard') this.guard++;
    this.placeLaunchers();
    this.summary = null;
    this.startWave(this.wave + 1);
  }

  private count(k: UpgradeKind) {
    return this.upgrades.filter((u) => u === k).length;
  }

  // ----- tutorial -----

  /** Steps: 0 meet the flights, 1 first invader, 2 lead the target, 3 ammo, 4 supply plane, 5 the rule. */
  private tutorialWantsTap() {
    return this.tutorialStep === 1 || this.tutorialStep === 2 || this.tutorialStep === 4;
  }

  /** "המשך" on a tutorial card with nothing to do. */
  tutorialNext() {
    if (this.phase !== 'tutorial') return;
    if (this.tutorialStep === 0 || this.tutorialStep === 3 || this.tutorialStep === 5) this.advanceTutorial();
  }

  skipTutorial() {
    if (this.phase !== 'tutorial') return;
    this.enemies = [];
    this.interceptors = [];
    this.supply = null;
    this.capsules = [];
    this.startWave(1);
  }

  private advanceTutorial() {
    this.tutorialStep++;
    if (this.tutorialStep > 5) return this.skipTutorial();
    this.emit({ type: 'tutorial', step: this.tutorialStep });
    this.tutorialSetup();
  }

  private tutorialSetup() {
    const s = this.tutorialStep;
    if (s === 1) this.spawn('buzzer', 0.6);
    if (s === 2) this.spawn('dart', 0.7);
    if (s === 3) for (const l of this.launchers) l.ammo = Math.max(1, l.max - 2);
    if (s === 4) this.launchSupply('shield');
  }

  // ----- waves -----

  private startWave(n: number) {
    this.wave = n;
    this.stats.wave = n;
    this.phase = 'intro';
    this.introLeft = 2.6;
    this.plan = planWave(n, this.r, this.difficulty);
    this.spawnIdx = 0;
    this.waveT = 0;
    this.wavePoints = 0;
    this.waveKills = 0;
    this.waveShots = 0;
    this.waveMisses = 0;
    this.bossSpawnT = 0;
    const supplies = 1 + this.count('supply');
    const last = this.plan.spawns[this.plan.spawns.length - 1]?.at ?? 20;
    this.supplyAt = Array.from({ length: supplies }, (_, i) => last * (0.25 + (0.5 * (i + this.r())) / supplies)).sort((a, b) => a - b);
    for (const l of this.launchers) l.ammo = l.max;
    const prevKinds = n > 1 ? kindsFor(n - 1) : [];
    const newKinds: EnemyKind[] = kindsFor(n).filter((k) => !prevKinds.includes(k));
    if (this.plan.boss) newKinds.push('boss');
    this.emit({ type: 'wave', wave: n, sector: sectorOf(n), boss: this.plan.boss, newKinds: n > 1 || this.plan.boss ? newKinds : [] });
  }

  private endWave() {
    const ammoLeft = this.launchers.reduce((s, l) => s + l.ammo, 0);
    const ammoBonus = ammoLeft * 20;
    const perfect = this.waveMisses === 0 && this.waveShots > 0;
    const bonus = ammoBonus + (perfect ? 2000 : 0);
    this.score += bonus * this.diffMult();
    this.wavePoints += bonus * this.diffMult();
    if (perfect) this.stats.perfectWaves++;
    const options = this.upgradeOptions();
    this.summary = {
      wave: this.wave,
      points: this.wavePoints,
      kills: this.waveKills,
      shots: this.waveShots,
      accuracy: this.waveShots ? (this.waveShots - this.waveMisses) / this.waveShots : 1,
      ammoBonus,
      perfect,
      options,
    };
    this.phase = 'clear';
    this.interceptors = [];
    this.supply = null;
    this.capsules = [];
    this.emit({ type: 'clear', summary: this.summary });
  }

  private upgradeOptions(): UpgradeKind[] {
    const pool = UPGRADES.filter((u) => !(ONCE.includes(u) && this.upgrades.includes(u)));
    const out: UpgradeKind[] = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(this.r() * pool.length), 1)[0]);
    return out;
  }

  private diffMult() {
    return this.difficulty === 'expert' ? 2 : 1;
  }

  // ----- spawning -----

  private spawn(kind: EnemyKind, speedMult = this.plan?.speed ?? 1, at?: Vec): Enemy {
    const { w, h } = this.arena;
    let pos: Vec;
    if (at) pos = { ...at };
    else if (kind === 'boss') pos = { x: 0, y: -h - 0.2 };
    else {
      // From a gate at the top or the sides (never the launchers' bottom edge).
      const side = this.r();
      if (side < 0.5) pos = { x: (this.r() * 2 - 1) * w * 0.9, y: -h - 0.06 };
      else pos = { x: (side < 0.75 ? -1 : 1) * (w + 0.06), y: (this.r() * 1.2 - 1) * h };
    }
    const spec = ENEMY[kind];
    const hp = kind === 'boss' ? 1 : spec.hp;
    const e: Enemy = { id: this.nextId++, kind, pos, vel: { x: 0, y: 0 }, hp, maxHp: hp, speed: spec.speed * speedMult, target: null, t: 0, visible: true };
    if (kind === 'boss') {
      const n = Math.min(8, 3 + sectorOf(this.wave));
      e.weak = Array.from({ length: n }, (_, i) => {
        const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, n - 1));
        return { dx: Math.cos(a) * 0.13 * (i % 2 ? 1 : 0.7), dy: Math.sin(a) * 0.07 - 0.02, hp: 2 };
      });
      this.emit({ type: 'boss', pos });
    }
    e.target = this.nearestFlight(e.pos)?.id ?? null;
    const t = this.flightById(e.target);
    if (t) e.vel = mul(norm(sub(t.pos, e.pos)), e.speed);
    this.enemies.push(e);
    if (!at) this.emit({ type: 'spawn', pos, kind });
    return e;
  }

  private launchSupply(kind?: PowerKind) {
    const { w, h } = this.arena;
    const fromLeft = this.r() < 0.5;
    const y = -h * (0.35 + this.r() * 0.35);
    this.supply = { pos: { x: fromLeft ? -w - 0.1 : w + 0.1, y }, vel: { x: fromLeft ? SUPPLY_SPEED : -SUPPLY_SPEED, y: 0 }, opened: false };
    this.forcedDrop = kind ?? null;
    this.emit({ type: 'supply' });
  }

  private forcedDrop: PowerKind | null = null;

  private openSupply() {
    if (!this.supply || this.supply.opened) return;
    this.supply.opened = true;
    const kinds = (Object.keys(POWER_WEIGHT) as PowerKind[]).filter((k) => !(k === 'life' && (this.difficulty === 'expert' || this.chances >= MAX_CHANCES)));
    const kind = this.forcedDrop ?? pick(this.r, kinds, (k) => POWER_WEIGHT[k]);
    this.capsules.push({ id: this.nextId++, pos: { ...this.supply.pos }, kind, left: CAPSULE_S });
    this.emit({ type: 'drop', pos: this.supply.pos });
  }

  private collect(c: Capsule) {
    this.capsules = this.capsules.filter((x) => x !== c);
    this.stats.powerups++;
    if (c.kind === 'life') this.chances = Math.min(MAX_CHANCES, this.chances + 1);
    else if (c.kind === 'shock') this.shocks = Math.min(2, this.shocks + 1);
    else this.powers[c.kind] = POWER_S[c.kind];
    if (c.kind === 'ammo') for (const l of this.launchers) l.ammo = l.max;
    this.emit({ type: 'power', kind: c.kind, pos: c.pos });
    if (this.phase === 'tutorial' && this.tutorialStep === 4) this.advanceTutorial();
  }

  // ----- helpers -----

  flightById(id: string | null): Flight | undefined {
    return id ? this.flights.find((f) => f.id === id) : undefined;
  }

  private nearestFlight(p: Vec): Flight | undefined {
    let best: Flight | undefined;
    let bd = Infinity;
    for (const f of this.flights) {
      const d = dist(f.pos, p);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  // ----- the clock -----

  step(dtRaw: number) {
    const dt = Math.min(0.05, Math.max(0, dtRaw));
    if (this.phase === 'over' || this.phase === 'clear') return;
    this.time += dt;
    if (this.phase === 'intro') {
      this.introLeft -= dt;
      this.moveFlights(dt);
      if (this.introLeft <= 0) this.phase = 'play';
      return;
    }
    for (const k of Object.keys(this.powers) as PowerKind[]) {
      this.powers[k] = Math.max(0, (this.powers[k] ?? 0) - dt);
      if (!this.powers[k]) delete this.powers[k];
    }
    this.reload(dt);
    this.moveFlights(dt);
    if (this.phase === 'play') this.spawnDue(dt);
    this.moveEnemies(dt);
    this.moveInterceptors(dt);
    this.updateBlasts(dt);
    this.moveSupply(dt);
    if (this.time - this.lastKill > COMBO_S && this.chain) {
      this.chain = 0;
      this.mult = 1;
    }
    if (this.phase === 'play' && this.plan && this.spawnIdx >= this.plan.spawns.length && !this.enemies.length && !this.blasts.length) this.endWave();
  }

  private reload(dt: number) {
    const every = RELOAD_S * Math.pow(0.8, this.count('reload'));
    for (const l of this.launchers) {
      if (l.ammo >= l.max) {
        l.reload = every;
        continue;
      }
      l.reload -= dt;
      if (l.reload <= 0) {
        l.ammo++;
        l.reload = every;
      }
    }
  }

  private moveFlights(dt: number) {
    const shieldAll = (this.powers.shield ?? 0) > 0;
    for (const f of this.flights) {
      f.pos = add(f.pos, mul(f.vel, dt));
      f.shield = shieldAll ? Math.max(f.shield, this.powers.shield!) : Math.max(0, f.shield - dt);
      f.threat = 0;
    }
    // Training planes that flew off go away; fillTraining sends new ones.
    const { w, h } = this.arena;
    const before = this.flights.length;
    this.flights = this.flights.filter((f) => f.real || (Math.abs(f.pos.x) < w + 0.2 && Math.abs(f.pos.y) < h + 0.2));
    if (this.flights.length !== before || this.flights.length < TRAINING_MIN) this.fillTraining();
  }

  private spawnDue(dt: number) {
    if (!this.plan) return;
    this.waveT += dt;
    while (this.spawnIdx < this.plan.spawns.length && this.plan.spawns[this.spawnIdx].at <= this.waveT) {
      this.spawn(this.plan.spawns[this.spawnIdx].kind);
      this.spawnIdx++;
    }
    if (this.supplyAt.length && this.waveT >= this.supplyAt[0] && !this.supply) {
      this.supplyAt.shift();
      this.launchSupply();
    }
  }

  private moveEnemies(dt: number) {
    const slow = (this.powers.slow ?? 0) > 0 ? 0.5 : 1;
    const jammers = this.enemies.filter((e) => e.kind === 'jammer');
    for (const e of [...this.enemies]) {
      e.t += dt;
      let target = this.flightById(e.target);
      if (!target || (e.kind !== 'dart' && e.t % 3 < dt)) {
        target = this.nearestFlight(e.pos);
        e.target = target?.id ?? null;
      }
      const spec = ENEMY[e.kind];
      if (target) {
        const to = sub(add(target.pos, mul(target.vel, 1)), e.pos);
        const d = len(to);
        let want = mul(norm(to), e.speed);
        if (e.kind === 'zigzag') {
          const perp = { x: -want.y, y: want.x };
          want = add(want, mul(perp, Math.cos(e.t * 3.2) * 1.4));
        }
        if (e.kind === 'jammer') {
          // Hovers at a distance and jams, then goes in.
          if (d < 0.45 && (e.hover ?? 0) < 10) {
            e.hover = (e.hover ?? 0) + dt;
            want = mul(want, 0.05);
          }
        }
        if (e.kind === 'boss') {
          // Drops down into view first, then creeps towards the flights.
          want = e.pos.y < -this.arena.h * 0.55 ? { x: 0, y: e.speed * 3 } : want;
        }
        // Turn towards the wanted velocity at the kind's turn rate (darts barely turn).
        const k = Math.min(1, spec.turn * dt);
        e.vel = e.kind === 'zigzag' ? want : add(mul(e.vel, 1 - k), mul(want, k));
        if (e.kind !== 'zigzag' && len(e.vel) > 0) e.vel = mul(norm(e.vel), e.speed * (e.kind === 'boss' && e.pos.y < -this.arena.h * 0.55 ? 3 : 1));
        target.threat = Math.max(target.threat, Math.max(0, 1 - d / 0.6));
      }
      e.pos = add(e.pos, mul(e.vel, dt * slow));
      // Visibility: ghosts flicker, jammers hide what is near them.
      const near = target ? dist(target.pos, e.pos) < 0.35 : false;
      e.visible = e.kind === 'ghost' ? near || Math.sin(e.t * 2.6) > -0.1 : true;
      if (e.kind !== 'jammer' && e.kind !== 'boss' && !near && jammers.some((j) => j !== e && dist(j.pos, e.pos) < JAM_R)) e.visible = false;
      if (e.kind === 'boss') this.bossSpawns(e, dt);
      // Flew far out (missed its target): retarget, or go away when nothing is left.
      if (Math.abs(e.pos.x) > this.arena.w + 0.6 || Math.abs(e.pos.y) > this.arena.h + 0.6) {
        if (e.kind === 'dart') {
          e.target = this.nearestFlight(e.pos)?.id ?? null;
          const t = this.flightById(e.target);
          if (t) e.vel = mul(norm(sub(t.pos, e.pos)), e.speed);
          else this.enemies = this.enemies.filter((x) => x !== e);
        }
      }
      if (target && dist(target.pos, e.pos) < FLIGHT_R + spec.r * (e.kind === 'boss' ? 0.6 : 0.5)) this.reach(e, target);
    }
  }

  private bossSpawns(e: Enemy, dt: number) {
    if (e.pos.y < -this.arena.h * 0.6) return;
    this.bossSpawnT += dt;
    const every = Math.max(1.4, 3 - 0.25 * sectorOf(this.wave));
    if (this.bossSpawnT >= every) {
      this.bossSpawnT = 0;
      this.spawn('mini', this.plan?.speed ?? 1, add(e.pos, { x: (this.r() - 0.5) * 0.2, y: 0.08 }));
    }
  }

  /** An invader got to a flight. */
  private reach(e: Enemy, f: Flight) {
    this.enemies = this.enemies.filter((x) => x !== e);
    if (this.phase === 'tutorial') {
      // In the tutorial nobody loses: the invader comes back for another try.
      this.emit({ type: 'retry' });
      this.spawn(e.kind, e.kind === 'dart' ? 0.7 : 0.6);
      return;
    }
    if (f.shield > 0) {
      // A shield from the power stays up until the power runs out; any other takes one hit.
      if (!((this.powers.shield ?? 0) > 0)) f.shield = 0;
      return this.emit({ type: 'saved', pos: f.pos, by: 'shield' });
    }
    if (this.guard > 0) {
      this.guard--;
      f.shield = 3;
      return this.emit({ type: 'saved', pos: f.pos, by: 'guard' });
    }
    if (this.chances > 0) {
      this.chances--;
      f.shield = 3;
      // The invaders right next to it go too, so the second chance is a real one.
      for (const x of [...this.enemies]) if (x.kind !== 'boss' && dist(x.pos, f.pos) < 0.2) this.enemies = this.enemies.filter((y) => y !== x);
      return this.emit({ type: 'saved', pos: f.pos, by: 'chance' });
    }
    this.phase = 'over';
    this.endedAt = { ...f.pos };
    this.emit({ type: 'over', pos: f.pos, kind: e.kind });
  }

  private moveInterceptors(dt: number) {
    for (const m of [...this.interceptors]) {
      if (m.lock !== null) {
        const e = this.enemies.find((x) => x.id === m.lock);
        if (e) m.target = this.intercept(e, m.pos, m.speed);
      }
      const to = sub(m.target, m.pos);
      const d = len(to);
      if (d <= m.speed * dt) {
        this.interceptors = this.interceptors.filter((x) => x !== m);
        this.blast(m.target);
      } else m.pos = add(m.pos, mul(norm(to), m.speed * dt));
    }
  }

  private blast(at: Vec) {
    const b: Blast = { id: this.nextId++, pos: { ...at }, r: 0, maxR: this.blastRadius(), t: 0, hit: [], kills: 0, useful: false };
    this.blasts.push(b);
    this.emit({ type: 'blast', pos: at, r: b.maxR });
  }

  private updateBlasts(dt: number) {
    for (const b of [...this.blasts]) {
      b.t += dt;
      b.r = b.t < BLAST_GROW ? (b.t / BLAST_GROW) * b.maxR : b.maxR;
      if (b.t <= BLAST_GROW + BLAST_HOLD) {
        for (const e of [...this.enemies]) {
          if (b.hit.includes(e.id)) continue;
          if (e.kind === 'boss') {
            let any = false;
            for (const w of e.weak ?? []) {
              if (w.hp > 0 && dist(b.pos, { x: e.pos.x + w.dx, y: e.pos.y + w.dy }) < b.r + WEAK_R) {
                w.hp--;
                any = true;
                if (w.hp === 0) this.addPoints(WEAK_POINTS, b, { x: e.pos.x + w.dx, y: e.pos.y + w.dy }, 'boss', false);
              }
            }
            if (any) {
              b.hit.push(e.id);
              b.useful = true;
              this.stats.hits++;
              this.emit({ type: 'hurt', pos: e.pos, kind: 'boss' });
              if ((e.weak ?? []).every((w) => w.hp <= 0)) this.kill(e, b, false);
            }
            continue;
          }
          if (dist(b.pos, e.pos) < b.r + ENEMY[e.kind].r) {
            b.hit.push(e.id);
            this.stats.hits++;
            e.hp--;
            if (e.hp > 0) {
              b.useful = true;
              e.speed *= 0.8;
              this.emit({ type: 'hurt', pos: e.pos, kind: e.kind });
            } else {
              const target = this.flightById(e.target);
              const close = !!target && dist(target.pos, e.pos) < 0.22;
              this.kill(e, b, close);
            }
          }
        }
        if (this.supply && !this.supply.opened && dist(this.supply.pos, b.pos) < b.r + 0.05) {
          b.useful = true;
          this.openSupply();
        }
        for (const c of [...this.capsules]) {
          if (dist(c.pos, b.pos) < b.r + 0.04) {
            b.useful = true;
            this.collect(c);
          }
        }
      }
      if (b.t >= BLAST_GROW + BLAST_HOLD + BLAST_FADE) {
        this.blasts = this.blasts.filter((x) => x !== b);
        if (!b.kills && !b.useful) {
          this.waveMisses++;
          if (this.chain) this.emit({ type: 'miss' });
          this.chain = 0;
          this.mult = 1;
        }
      }
    }
  }

  private kill(e: Enemy, b: Blast | null, close: boolean) {
    if (!this.enemies.includes(e)) return;
    this.enemies = this.enemies.filter((x) => x !== e);
    this.stats.kills++;
    this.waveKills++;
    this.stats.byKind[e.kind] = (this.stats.byKind[e.kind] ?? 0) + 1;
    if (e.kind === 'boss') {
      this.stats.bossKills++;
      // Its leftovers go with it.
      for (const m of this.enemies.filter((x) => x.kind === 'mini')) this.kill(m, null, false);
    }
    if (close) this.stats.closeSaves++;
    if (e.kind === 'splitter') {
      this.emit({ type: 'split', pos: e.pos });
      for (let i = 0; i < 3; i++) {
        const m = this.spawn('mini', this.plan?.speed ?? 1, add(e.pos, { x: (i - 1) * 0.05, y: 0.02 }));
        const a = (i - 1) * 0.9;
        m.vel = { x: Math.sin(a) * m.speed, y: Math.cos(a) * m.speed };
      }
    }
    this.addPoints(ENEMY[e.kind].points, b, e.pos, e.kind, close);
    if (this.phase === 'tutorial' && (this.tutorialStep === 1 || this.tutorialStep === 2)) this.advanceTutorial();
  }

  private addPoints(base: number, b: Blast | null, pos: Vec, kind: EnemyKind, close: boolean) {
    this.chain++;
    this.lastKill = this.time;
    const mult = Math.min(5, 1 + 0.5 * (this.chain - 1));
    if (mult > this.mult) this.emit({ type: 'combo', mult });
    this.mult = mult;
    this.stats.maxMult = Math.max(this.stats.maxMult, mult);
    let multi = 1;
    if (b) {
      b.kills++;
      multi = b.kills >= 3 ? 3 : b.kills === 2 ? 2 : 1;
      if (b.kills === 2) this.stats.multiKills++;
      if (b.kills === 3) this.stats.tripleKills++;
    }
    const points = Math.round((base * mult * multi + (close ? 300 : 0)) * this.diffMult());
    if (this.phase !== 'tutorial') {
      this.score += points;
      this.wavePoints += points;
    }
    this.emit({ type: 'kill', pos: { ...pos }, kind, points, mult, multi, close });
  }

  private moveSupply(dt: number) {
    const { w, h } = this.arena;
    if (this.supply) {
      this.supply.pos = add(this.supply.pos, mul(this.supply.vel, dt));
      if (Math.abs(this.supply.pos.x) > w + 0.2) {
        const missed = !this.supply.opened;
        this.supply = null;
        // The tutorial waits until the player catches one.
        if (missed && this.phase === 'tutorial' && this.tutorialStep === 4) this.launchSupply('shield');
      }
    }
    for (const c of [...this.capsules]) {
      c.left -= dt;
      c.pos = { x: c.pos.x, y: Math.min(h * 0.7, c.pos.y + CAPSULE_FALL * dt) };
      if (c.left <= 0) {
        this.capsules = this.capsules.filter((x) => x !== c);
        if (this.phase === 'tutorial' && this.tutorialStep === 4) this.launchSupply('shield');
      }
    }
  }

  /** Seconds left of the wave's intro banner. */
  get intro() {
    return Math.max(0, this.introLeft);
  }

  /** How many invaders are still to come this wave (for the HUD). */
  get remaining() {
    return (this.plan ? this.plan.spawns.length - this.spawnIdx : 0) + this.enemies.length;
  }

  /** The real flights the game was last given, for tests. */
  get realFlights() {
    return this.real;
  }
}
