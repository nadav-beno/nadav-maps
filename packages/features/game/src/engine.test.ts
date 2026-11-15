import { describe, expect, it } from 'vitest';
import { dailySeed, ENEMY, Game, isBossWave, kindsFor, planWave, rng, sectorOf, waveCount, type GameEvent } from './engine.ts';

const flight = (id: string, x: number, y: number) => ({ id, pos: { x, y }, vel: { x: 0, y: 0 }, heading: 0 });

function run(g: Game, seconds: number, each?: (g: Game) => void): GameEvent[] {
  const out: GameEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    g.step(1 / 60);
    each?.(g);
    out.push(...g.drain());
  }
  return out;
}

/** Plays like a perfect player: fires at each invader's meeting point once. */
function autopilot(g: Game) {
  const aimed = new Set<number>();
  return (game: Game) => {
    for (const e of game.enemies) {
      if (aimed.has(e.id) || e.pos.y < -game.arena.h) continue;
      aimed.add(e.id);
      const from = game.launchers.reduce((a, b) => (Math.hypot(a.pos.x - e.pos.x, a.pos.y - e.pos.y) < Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y) ? a : b)).pos;
      game.tap(game.intercept(e, from, game.interceptorSpeed()));
    }
    void g;
  };
}

describe('waves', () => {
  it('is the same plan for the same seed (the daily challenge)', () => {
    expect(planWave(7, rng(42))).toEqual(planWave(7, rng(42)));
    expect(planWave(7, rng(42))).not.toEqual(planWave(7, rng(43)));
  });

  it('grows harder, with a breather in the middle of each sector', () => {
    expect(waveCount(1)).toBe(6);
    expect(waveCount(2)).toBeGreaterThan(waveCount(1));
    expect(waveCount(3)).toBeLessThan(waveCount(2));
    expect(waveCount(40)).toBe(40);
    expect(planWave(12, rng(1)).speed).toBeGreaterThan(planWave(1, rng(1)).speed);
  });

  it('brings new invaders in on their wave', () => {
    expect(kindsFor(1)).toEqual(['buzzer']);
    expect(kindsFor(4)).toEqual(['buzzer', 'dart', 'zigzag']);
    expect(kindsFor(12)).toContain('jammer');
    const kinds = new Set(planWave(4, rng(3)).spawns.map((s) => s.kind));
    expect([...kinds].every((k) => ENEMY[k].from <= 4)).toBe(true);
  });

  it('has a boss every fifth wave and a new sector after it', () => {
    expect(isBossWave(5)).toBe(true);
    expect(planWave(5, rng(1)).spawns[0].kind).toBe('boss');
    expect(planWave(4, rng(1)).spawns.some((s) => s.kind === 'boss')).toBe(false);
    expect([1, 5, 6, 10, 11, 16, 21, 40].map(sectorOf)).toEqual([0, 0, 1, 1, 2, 3, 4, 4]);
  });

  it('gives one seed per day', () => {
    expect(dailySeed(new Date(2026, 10, 15))).toBe(20261115);
  });
});

describe('game', () => {
  it('fills the sky with training planes when there are few real flights', () => {
    const g = new Game({ seed: 1 });
    g.setFlights([]);
    expect(g.flights.length).toBe(4);
    expect(g.flights.every((f) => !f.real)).toBe(true);
    g.setFlights([flight('a', 0, 0), flight('b', 0.2, 0), flight('c', -0.2, 0), flight('d', 0, 0.2), flight('e', 0.3, 0.3)]);
    expect(g.flights.filter((f) => !f.real).length).toBe(0);
  });

  it('ends the shift when an invader reaches a flight', () => {
    const g = new Game({ seed: 2 });
    g.setFlights([flight('a', 0, 0), flight('b', 0.5, 0), flight('c', -0.5, 0), flight('d', 0, 0.5)]);
    const events = run(g, 120);
    expect(g.phase).toBe('over');
    expect(events.some((e) => e.type === 'over')).toBe(true);
    expect(g.endedAt).not.toBeNull();
  });

  it('a second chance saves the flight once', () => {
    const g = new Game({ seed: 2, difficulty: 'rookie' });
    expect(g.chances).toBe(3);
    g.setFlights([flight('a', 0, 0)]);
    const events = run(g, 45);
    expect(events.some((e) => e.type === 'saved' && e.by === 'chance')).toBe(true);
    expect(g.chances).toBeLessThan(3);
  });

  it('a perfect player clears waves, scores and gets an upgrade choice', () => {
    const g = new Game({ seed: 5 });
    g.setFlights([flight('a', 0, 0.2), flight('b', 0.4, 0.3), flight('c', -0.4, 0.3), flight('d', 0, 0.5)]);
    const events = run(g, 60, autopilot(g));
    expect(g.phase).toBe('clear');
    expect(g.score).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'kill').length).toBe(waveCount(1));
    expect(g.summary?.options.length).toBe(3);
    g.chooseUpgrade(g.summary!.options[0]);
    expect(g.wave).toBe(2);
    expect(g.upgrades.length).toBe(1);
  });

  it('runs out of ammo, then reloads', () => {
    const g = new Game({ seed: 1 });
    g.setFlights([flight('a', 0, 0)]);
    run(g, 3);
    const total = g.launchers.reduce((s, l) => s + l.ammo, 0);
    for (let i = 0; i < total; i++) g.tap({ x: 0.9, y: -1.2 });
    g.tap({ x: 0.9, y: -1.2 });
    expect(g.drain().some((e) => e.type === 'dry')).toBe(true);
    run(g, 2);
    expect(g.launchers.some((l) => l.ammo > 0)).toBe(true);
  });

  it('a miss resets the combo', () => {
    const g = new Game({ seed: 1 });
    g.setFlights([flight('a', 0, 0)]);
    run(g, 3);
    g.chain = 3;
    g.lastKill = g.time;
    g.tap({ x: 0.9, y: -1.4 });
    run(g, 3);
    expect(g.chain).toBe(0);
  });

  it('the tutorial walks through its steps and starts wave 1', () => {
    const g = new Game({ seed: 9, tutorial: true });
    g.setFlights([flight('a', 0, 0.2), flight('b', 0.4, 0.3), flight('c', -0.4, 0.3), flight('d', 0, 0.5)]);
    expect(g.phase).toBe('tutorial');
    g.tutorialNext();
    expect(g.tutorialStep).toBe(1);
    run(g, 30, autopilot(g));
    expect(g.tutorialStep).toBe(3);
    g.tutorialNext();
    expect(g.tutorialStep).toBe(4);
    // Catch the supply plane's capsule.
    run(g, 30, (game) => {
      if (game.supply && !game.supply.opened && Math.abs(game.supply.pos.x) < game.arena.w * 0.8) game.tap(game.supply.pos);
      for (const c of game.capsules) game.tap(c.pos);
    });
    expect(g.tutorialStep).toBe(5);
    g.tutorialNext();
    expect(g.phase).toBe('intro');
    expect(g.wave).toBe(1);
  });

  it('nobody loses in the tutorial', () => {
    const g = new Game({ seed: 9, tutorial: true });
    g.setFlights([flight('a', 0, 0)]);
    g.tutorialNext();
    const events = run(g, 60);
    expect(g.phase).toBe('tutorial');
    expect(events.some((e) => e.type === 'retry')).toBe(true);
  });

  it('the shock wave clears the screen', () => {
    const g = new Game({ seed: 4 });
    g.setFlights([flight('a', 0, 0.5)]);
    run(g, 8);
    expect(g.enemies.length).toBeGreaterThan(0);
    g.shocks = 1;
    g.useShock();
    expect(g.enemies.length).toBe(0);
    expect(g.shocks).toBe(0);
  });

  it('the shield power absorbs hits', () => {
    const g = new Game({ seed: 2 });
    g.setFlights([flight('a', 0, 0)]);
    g.powers.shield = 999;
    const events = run(g, 20);
    expect(g.phase).not.toBe('over');
    expect(events.some((e) => e.type === 'saved' && e.by === 'shield')).toBe(true);
  });

  it('expert scores double and has no aim assist', () => {
    const g = new Game({ seed: 1, difficulty: 'expert' });
    expect(g.aimAssist).toBe(false);
    expect(g.chances).toBe(0);
  });
});
