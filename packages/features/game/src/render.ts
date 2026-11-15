import { ENEMY, type Enemy, type EnemyKind, type Flight, type Game, type GameEvent, type PowerKind, type Vec } from './engine.ts';

/**
 * Draws the game on a canvas over the map: a night tint with a radar sweep, the flights with
 * their shield rings, the invaders in neon, interceptors with light trails, blasts, sparks and
 * score pop-ups. Effects live here (the engine only says what happened).
 */

/** Arena units to screen pixels: (cx, cy) is the arena's middle, u is pixels per unit. */
export interface Xf {
  cx: number;
  cy: number;
  u: number;
}

const px = (xf: Xf, v: Vec) => [xf.cx + v.x * xf.u, xf.cy + v.y * xf.u] as const;

export const COLORS: Record<EnemyKind, string> = {
  buzzer: '#ff4d6d',
  dart: '#ff8a1f',
  zigzag: '#ff4fd8',
  armor: '#ff5a36',
  splitter: '#ffc02e',
  ghost: '#c79bff',
  jammer: '#ff38c7',
  mini: '#ff6b8b',
  boss: '#ff3355',
};
const CYAN = '#4df3ff';
const GREEN = '#46ffa0';
const GOLD = '#ffd54a';
const SHIELD = '#5ab4ff';

export const POWER_LETTER: Record<PowerKind, string> = { fast: '⚡', shield: '◎', ammo: '∞', big: '✸', homing: '⌖', slow: '⧗', life: '♥', shock: '✺' };

interface Particle {
  p: Vec;
  v: Vec;
  life: number;
  max: number;
  color: string;
  size: number;
}
interface Ring {
  p: Vec;
  r: number;
  to: number;
  life: number;
  max: number;
  color: string;
  width: number;
}
interface Pop {
  p: Vec;
  text: string;
  color: string;
  life: number;
  big: boolean;
}

export class Fx {
  particles: Particle[] = [];
  rings: Ring[] = [];
  pops: Pop[] = [];
  trails = new Map<number, Vec[]>();
  shake = 0;
  flash = 0;
  flashColor = '255,255,255';
  reduce = false;
  sweep = 0;

  burst(p: Vec, color: string, n: number, speed = 0.5, size = 2.5) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      const max = 0.4 + Math.random() * 0.5;
      this.particles.push({ p: { ...p }, v: { x: Math.cos(a) * s, y: Math.sin(a) * s }, life: max, max, color, size: size * (0.6 + Math.random() * 0.8) });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  ring(p: Vec, to: number, color: string, max = 0.5, width = 3) {
    this.rings.push({ p: { ...p }, r: 0, to, life: max, max, color, width });
  }

  pop(p: Vec, text: string, color = '#fff', big = false) {
    this.pops.push({ p: { ...p }, text, color, life: big ? 1.4 : 0.9, big });
  }

  kick(amount: number, flash = 0, color = '255,255,255') {
    this.shake = Math.max(this.shake, this.reduce ? amount * 0.3 : amount);
    if (!this.reduce && flash > this.flash) {
      this.flash = flash;
      this.flashColor = color;
    }
  }

  on(e: GameEvent) {
    switch (e.type) {
      case 'blast':
        this.burst(e.pos, CYAN, 10, 0.35, 2);
        break;
      case 'kill': {
        const c = COLORS[e.kind];
        this.burst(e.pos, c, e.kind === 'boss' ? 120 : 26, e.kind === 'boss' ? 0.9 : 0.55, e.kind === 'boss' ? 4 : 2.6);
        this.ring(e.pos, e.kind === 'boss' ? 0.6 : 0.12, c, 0.45, 2);
        const label = `+${e.points.toLocaleString('he-IL')}${e.multi > 1 ? ` ×${e.multi}` : ''}`;
        this.pop({ x: e.pos.x, y: e.pos.y - 0.04 }, label, e.multi > 1 || e.close ? GOLD : '#fff', e.multi > 1 || e.kind === 'boss');
        if (e.close) this.pop({ x: e.pos.x, y: e.pos.y + 0.05 }, 'על הקשקש!', GREEN);
        this.kick(e.kind === 'boss' ? 16 : e.multi > 2 ? 9 : 4, e.kind === 'boss' ? 0.6 : e.multi > 2 ? 0.25 : 0);
        break;
      }
      case 'hurt':
        this.burst(e.pos, '#fff', 8, 0.4, 2);
        this.kick(2);
        break;
      case 'saved':
        this.ring(e.pos, 0.25, e.by === 'chance' ? GOLD : SHIELD, 0.7, 4);
        this.burst(e.pos, e.by === 'chance' ? GOLD : SHIELD, 30, 0.5, 2.5);
        this.pop({ x: e.pos.x, y: e.pos.y - 0.07 }, e.by === 'chance' ? 'הזדמנות שנייה!' : 'המגן ספג!', e.by === 'chance' ? GOLD : SHIELD, true);
        this.kick(10, 0.35, e.by === 'chance' ? '255,213,74' : '90,180,255');
        break;
      case 'over':
        // The flight's shield ring shatters into green shards (never a crash).
        this.ring(e.pos, 0.35, GREEN, 1.2, 5);
        this.burst(e.pos, GREEN, 70, 0.45, 3);
        this.kick(14, 0.5, '255,60,90');
        break;
      case 'drop':
        this.burst(e.pos, GOLD, 16, 0.3, 2);
        break;
      case 'power':
        this.ring(e.pos, 0.2, GOLD, 0.6, 3);
        this.burst(e.pos, GOLD, 24, 0.45, 2.5);
        break;
      case 'shock':
        this.ring({ x: 0, y: 0 }, 3, CYAN, 1.1, 10);
        this.kick(18, 0.7, '77,243,255');
        break;
      case 'split':
        this.burst(e.pos, COLORS.splitter, 18, 0.5, 2);
        break;
      case 'boss':
        this.kick(6, 0.2, '255,51,85');
        break;
      case 'spawn':
        // A gate opens where it comes in.
        this.ring(e.pos, e.kind === 'boss' ? 0.4 : 0.09, COLORS[e.kind], 0.6, 2);
        this.burst(e.pos, COLORS[e.kind], e.kind === 'boss' ? 40 : 8, 0.25, 2);
        break;
    }
  }

  step(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.p.x += p.v.x * dt;
      p.p.y += p.v.y * dt;
      p.v.x *= 0.96;
      p.v.y *= 0.96;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      r.r = r.to * (1 - Math.pow(r.life / r.max, 2));
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const p of this.pops) {
      p.life -= dt;
      p.p.y -= dt * 0.06;
    }
    this.pops = this.pops.filter((p) => p.life > 0);
    this.shake *= Math.pow(0.02, dt);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.sweep = (this.sweep + dt * 0.9) % (Math.PI * 2);
  }
}

// ---------- shapes ----------

function glow(c: CanvasRenderingContext2D, color: string, width: number, draw: () => void) {
  c.strokeStyle = color;
  c.globalAlpha = 0.25;
  c.lineWidth = width * 3.2;
  c.beginPath();
  draw();
  c.stroke();
  c.globalAlpha = 1;
  c.lineWidth = width;
  c.beginPath();
  draw();
  c.stroke();
}

function poly(c: CanvasRenderingContext2D, x: number, y: number, r: number, n: number, rot: number) {
  for (let i = 0; i <= n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const X = x + Math.cos(a) * r;
    const Y = y + Math.sin(a) * r;
    if (i === 0) c.moveTo(X, Y);
    else c.lineTo(X, Y);
  }
}

function plane(c: CanvasRenderingContext2D, x: number, y: number, s: number, headingDeg: number) {
  c.save();
  c.translate(x, y);
  c.rotate((headingDeg * Math.PI) / 180);
  c.beginPath();
  c.moveTo(0, -s);
  c.lineTo(s * 0.16, -s * 0.45);
  c.lineTo(s * 0.95, s * 0.1);
  c.lineTo(s * 0.95, s * 0.28);
  c.lineTo(s * 0.16, s * 0.05);
  c.lineTo(s * 0.12, s * 0.65);
  c.lineTo(s * 0.4, s * 0.85);
  c.lineTo(s * 0.4, s);
  c.lineTo(0, s * 0.88);
  c.lineTo(-s * 0.4, s);
  c.lineTo(-s * 0.4, s * 0.85);
  c.lineTo(-s * 0.12, s * 0.65);
  c.lineTo(-s * 0.16, s * 0.05);
  c.lineTo(-s * 0.95, s * 0.28);
  c.lineTo(-s * 0.95, s * 0.1);
  c.lineTo(-s * 0.16, -s * 0.45);
  c.closePath();
  c.fill();
  c.restore();
}

function threatColor(t: number) {
  if (t > 0.66) return '#ff4d4d';
  if (t > 0.33) return '#ffd54a';
  return GREEN;
}

function drawFlight(c: CanvasRenderingContext2D, xf: Xf, f: Flight, time: number) {
  const [x, y] = px(xf, f.pos);
  const ringR = Math.max(13, 0.045 * xf.u);
  const col = f.real ? threatColor(f.threat) : '#9ad7ff';
  c.globalCompositeOperation = 'lighter';
  const pulse = 1 + Math.sin(time * (f.threat > 0.66 ? 12 : 3)) * 0.08;
  c.setLineDash(f.real ? [] : [4, 4]);
  glow(c, col, 1.6, () => c.arc(x, y, ringR * pulse, 0, Math.PI * 2));
  c.setLineDash([]);
  if (f.shield > 0) {
    c.fillStyle = 'rgba(90,180,255,0.16)';
    c.beginPath();
    c.arc(x, y, ringR * 1.45, 0, Math.PI * 2);
    c.fill();
    glow(c, SHIELD, 1.4, () => c.arc(x, y, ringR * 1.45, 0, Math.PI * 2));
  }
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = f.real ? '#eafff3' : '#d8efff';
  plane(c, x, y, 7.5, f.heading);
  if (!f.real) {
    c.font = '600 10px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(154,215,255,0.85)';
    c.fillText('אימון', x, y + ringR + 11);
  }
}

function drawEnemy(c: CanvasRenderingContext2D, xf: Xf, e: Enemy, time: number) {
  const [x, y] = px(xf, e.pos);
  const color = COLORS[e.kind];
  const s = Math.max(e.kind === 'mini' ? 7 : 10, ENEMY[e.kind].r * xf.u * 1.4);
  const rot = Math.atan2(e.vel.y, e.vel.x);
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = color;
  switch (e.kind) {
    case 'buzzer':
    case 'mini':
      glow(c, color, 2, () => poly(c, x, y, s, 3, time * 4 + e.id));
      break;
    case 'dart': {
      // A long arrow with a trail behind it.
      const dx = Math.cos(rot), dy = Math.sin(rot);
      c.globalAlpha = 0.35;
      c.lineWidth = 3;
      c.strokeStyle = color;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - dx * s * 4, y - dy * s * 4);
      c.stroke();
      c.globalAlpha = 1;
      glow(c, color, 2, () => {
        c.moveTo(x + dx * s * 1.4, y + dy * s * 1.4);
        c.lineTo(x - dx * s - dy * s * 0.6, y - dy * s + dx * s * 0.6);
        c.lineTo(x - dx * s * 0.4, y - dy * s * 0.4);
        c.lineTo(x - dx * s + dy * s * 0.6, y - dy * s - dx * s * 0.6);
        c.closePath();
      });
      break;
    }
    case 'zigzag':
      c.globalAlpha = 0.6 + Math.sin(time * 14) * 0.4;
      glow(c, color, 2, () => poly(c, x, y, s, 4, 0));
      c.globalAlpha = 1;
      break;
    case 'armor':
      glow(c, color, 2.6, () => poly(c, x, y, s * 1.1, 6, time));
      glow(c, color, 1.4, () => c.arc(x, y, s * 1.55, 0, ((Math.PI * 2) * e.hp) / e.maxHp));
      break;
    case 'splitter':
      glow(c, color, 2, () => c.arc(x, y, s, 0, Math.PI * 2));
      glow(c, color, 1.2, () => {
        c.moveTo(x - s * 0.6, y - s * 0.2);
        c.lineTo(x, y + s * 0.15);
        c.lineTo(x + s * 0.5, y - s * 0.5);
        c.moveTo(x, y + s * 0.15);
        c.lineTo(x + s * 0.1, y + s * 0.8);
      });
      break;
    case 'ghost':
      c.setLineDash([3, 3]);
      c.globalAlpha = e.visible ? 0.9 : 0;
      glow(c, color, 1.6, () => poly(c, x, y, s, 5, time * 1.5));
      c.setLineDash([]);
      c.globalAlpha = 1;
      break;
    case 'jammer': {
      glow(c, color, 2, () => c.arc(x, y, s * 0.8, 0, Math.PI * 2));
      glow(c, color, 1.5, () => {
        c.moveTo(x, y - s * 0.8);
        c.lineTo(x, y - s * 1.8);
      });
      for (let i = 0; i < 3; i++) {
        const k = ((time * 0.8 + i / 3) % 1);
        c.globalAlpha = 1 - k;
        c.lineWidth = 1.2;
        c.strokeStyle = color;
        c.beginPath();
        c.arc(x, y, s + k * 0.32 * xf.u, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
      break;
    }
    case 'boss': {
      const w = 0.17 * xf.u, h = 0.07 * xf.u;
      c.fillStyle = 'rgba(255,51,85,0.12)';
      c.beginPath();
      c.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
      c.fill();
      glow(c, color, 3, () => c.ellipse(x, y, w, h, 0, 0, Math.PI * 2));
      glow(c, color, 2, () => c.ellipse(x, y - h * 0.6, w * 0.45, h * 0.6, 0, Math.PI, Math.PI * 2));
      for (const wp of e.weak ?? []) {
        const X = x + wp.dx * xf.u, Y = y + wp.dy * xf.u;
        const r = Math.max(6, 0.03 * xf.u);
        if (wp.hp <= 0) {
          c.fillStyle = 'rgba(80,80,80,0.6)';
          c.beginPath();
          c.arc(X, Y, r * 0.7, 0, Math.PI * 2);
          c.fill();
          continue;
        }
        c.fillStyle = wp.hp > 1 ? GOLD : '#fff';
        c.globalAlpha = 0.7 + Math.sin(time * 6 + wp.dx * 30) * 0.3;
        c.beginPath();
        c.arc(X, Y, r * 0.7, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        glow(c, GOLD, 1.4, () => c.arc(X, Y, r, 0, Math.PI * 2));
      }
      break;
    }
  }
  c.globalCompositeOperation = 'source-over';
}

function drawLauncher(c: CanvasRenderingContext2D, xf: Xf, pos: Vec, ammo: number, max: number, unlimited: boolean, preferred: boolean) {
  const [x, y] = px(xf, pos);
  c.globalCompositeOperation = 'lighter';
  glow(c, preferred ? GOLD : CYAN, 2, () => {
    c.moveTo(x - 12, y + 8);
    c.lineTo(x - 5, y - 12);
    c.lineTo(x + 5, y - 12);
    c.lineTo(x + 12, y + 8);
    c.closePath();
  });
  c.globalCompositeOperation = 'source-over';
  const n = max;
  const gap = 6;
  for (let i = 0; i < n; i++) {
    const X = x - ((n - 1) * gap) / 2 + i * gap;
    c.fillStyle = unlimited ? GOLD : i < ammo ? CYAN : 'rgba(77,243,255,0.18)';
    c.fillRect(X - 2, y + 14, 4, 7);
  }
}

// ---------- the frame ----------

export interface DrawOpts {
  preferred: number | null;
  /** Tutorial step 2: show where to aim. */
  showLead: boolean;
  hideEntities: boolean;
}

export function drawBackdrop(c: CanvasRenderingContext2D, w: number, h: number, xf: Xf, fx: Fx) {
  c.fillStyle = 'rgba(3,8,22,0.62)';
  c.fillRect(0, 0, w, h);
  // Radar rings and cross.
  c.strokeStyle = 'rgba(77,243,255,0.10)';
  c.lineWidth = 1;
  for (let r = 0.5; r < 4; r += 0.5) {
    c.beginPath();
    c.arc(xf.cx, xf.cy, r * xf.u, 0, Math.PI * 2);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(0, xf.cy);
  c.lineTo(w, xf.cy);
  c.moveTo(xf.cx, 0);
  c.lineTo(xf.cx, h);
  c.stroke();
  // The sweep.
  const anyC = c as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient };
  if (anyC.createConicGradient) {
    const g = anyC.createConicGradient(fx.sweep, xf.cx, xf.cy);
    g.addColorStop(0, 'rgba(77,243,255,0.16)');
    g.addColorStop(0.08, 'rgba(77,243,255,0)');
    g.addColorStop(1, 'rgba(77,243,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
}

export function drawFlights(c: CanvasRenderingContext2D, xf: Xf, flights: Flight[], time: number) {
  for (const f of flights) drawFlight(c, xf, f, time);
}

export function drawGame(c: CanvasRenderingContext2D, w: number, h: number, xf: Xf, g: Game, fx: Fx, time: number, o: DrawOpts) {
  c.save();
  if (fx.shake > 0.3) c.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  drawBackdrop(c, w, h, xf, fx);
  if (!o.hideEntities) {
    // Jamming clouds.
    for (const e of g.enemies) {
      if (e.kind !== 'jammer') continue;
      const [x, y] = px(xf, e.pos);
      const r = 0.32 * xf.u;
      c.fillStyle = 'rgba(255,56,199,0.07)';
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,56,199,0.25)';
      c.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * r;
        const X = x + Math.cos(a) * d, Y = y + Math.sin(a) * d;
        c.beginPath();
        c.moveTo(X - 5, Y);
        c.lineTo(X + 5, Y);
        c.stroke();
      }
    }
    // Who is going for whom.
    c.setLineDash([3, 6]);
    for (const e of g.enemies) {
      if (!e.visible || e.kind === 'boss') continue;
      const t = g.flightById(e.target);
      if (!t) continue;
      const [x1, y1] = px(xf, e.pos);
      const [x2, y2] = px(xf, t.pos);
      c.strokeStyle = `rgba(255,77,109,${0.18 + t.threat * 0.45})`;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    }
    c.setLineDash([]);
    drawFlights(c, xf, g.flights, time);
    const unlimited = (g.powers.ammo ?? 0) > 0;
    g.launchers.forEach((l, i) => drawLauncher(c, xf, l.pos, l.ammo, l.max, unlimited, o.preferred === i));
    // Interceptors with light trails.
    const alive = new Set<number>();
    c.globalCompositeOperation = 'lighter';
    for (const m of g.interceptors) {
      alive.add(m.id);
      const trail = fx.trails.get(m.id) ?? [];
      trail.push({ ...m.pos });
      if (trail.length > 18) trail.shift();
      fx.trails.set(m.id, trail);
      c.strokeStyle = CYAN;
      for (let i = 1; i < trail.length; i++) {
        const [ax, ay] = px(xf, trail[i - 1]);
        const [bx, by] = px(xf, trail[i]);
        c.globalAlpha = i / trail.length;
        c.lineWidth = 1 + (2 * i) / trail.length;
        c.beginPath();
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
        c.stroke();
      }
      c.globalAlpha = 1;
      const [x, y] = px(xf, m.pos);
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x, y, 2.6, 0, Math.PI * 2);
      c.fill();
      // Where it will burst.
      const [tx, ty] = px(xf, m.target);
      c.strokeStyle = 'rgba(77,243,255,0.5)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(tx - 5, ty - 5);
      c.lineTo(tx + 5, ty + 5);
      c.moveTo(tx + 5, ty - 5);
      c.lineTo(tx - 5, ty + 5);
      c.stroke();
    }
    for (const id of [...fx.trails.keys()]) if (!alive.has(id)) fx.trails.delete(id);
    c.globalCompositeOperation = 'source-over';
    for (const e of g.enemies) if (e.visible || e.kind === 'ghost') drawEnemy(c, xf, e, time);
    // Tutorial: the meeting point for the fast one.
    if (o.showLead) {
      for (const e of g.enemies) {
        const from = g.launchers[1]?.pos ?? { x: 0, y: g.arena.h * 0.86 };
        const at = g.intercept(e, from, g.interceptorSpeed());
        const [x, y] = px(xf, at);
        const [ex, ey] = px(xf, e.pos);
        c.setLineDash([4, 4]);
        c.strokeStyle = 'rgba(255,213,74,0.8)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(ex, ey);
        c.lineTo(x, y);
        c.stroke();
        c.setLineDash([]);
        const r = 16 + Math.sin(time * 6) * 3;
        glow(c, GOLD, 2, () => c.arc(x, y, r, 0, Math.PI * 2));
      }
    }
    // Supply plane and capsules.
    if (g.supply) {
      const [x, y] = px(xf, g.supply.pos);
      c.globalCompositeOperation = 'lighter';
      glow(c, GOLD, 1.5, () => c.arc(x, y, 20 + Math.sin(time * 5) * 2, 0, Math.PI * 2));
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = GOLD;
      plane(c, x, y, 12, g.supply.vel.x > 0 ? 90 : 270);
    }
    for (const cap of g.capsules) {
      const [x, y] = px(xf, cap.pos);
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y - 22, 14, Math.PI, Math.PI * 2);
      c.moveTo(x - 14, y - 22);
      c.lineTo(x - 4, y - 8);
      c.moveTo(x + 14, y - 22);
      c.lineTo(x + 4, y - 8);
      c.stroke();
      c.globalCompositeOperation = 'lighter';
      const blink = cap.left < 1.5 ? (Math.sin(time * 20) > 0 ? 1 : 0.3) : 1;
      c.globalAlpha = blink;
      glow(c, GOLD, 2, () => c.arc(x, y, 11, 0, Math.PI * 2));
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#fff';
      c.font = '700 13px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(POWER_LETTER[cap.kind], x, y + 1);
      c.textBaseline = 'alphabetic';
    }
    // Blasts.
    c.globalCompositeOperation = 'lighter';
    for (const b of g.blasts) {
      const [x, y] = px(xf, b.pos);
      const r = Math.max(2, b.r * xf.u);
      const fade = b.t > 0.4 ? Math.max(0, 1 - (b.t - 0.4) / 0.25) : 1;
      const grad = c.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`);
      grad.addColorStop(0.5, `rgba(120,240,255,${0.45 * fade})`);
      grad.addColorStop(1, 'rgba(77,243,255,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = fade;
      c.strokeStyle = CYAN;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }
  }
  // Effects.
  for (const r of fx.rings) {
    const [x, y] = px(xf, r.p);
    c.globalAlpha = Math.max(0, r.life / r.max);
    c.strokeStyle = r.color;
    c.lineWidth = r.width;
    c.beginPath();
    c.arc(x, y, r.r * xf.u, 0, Math.PI * 2);
    c.stroke();
  }
  for (const p of fx.particles) {
    const [x, y] = px(xf, p.p);
    c.globalAlpha = Math.max(0, p.life / p.max);
    c.fillStyle = p.color;
    c.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.textAlign = 'center';
  for (const p of fx.pops) {
    const [x, y] = px(xf, p.p);
    c.globalAlpha = Math.min(1, p.life * 2);
    c.font = `800 ${p.big ? 19 : 14}px system-ui, sans-serif`;
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.strokeText(p.text, x, y);
    c.fillStyle = p.color;
    c.fillText(p.text, x, y);
  }
  c.globalAlpha = 1;
  if (!o.hideEntities) drawArrows(c, w, h, xf, g);
  c.restore();
  if (fx.flash > 0) {
    c.fillStyle = `rgba(${fx.flashColor},${fx.flash * 0.35})`;
    c.fillRect(0, 0, w, h);
  }
}

/** Red arrows at the screen's edge for invaders still outside it. */
function drawArrows(c: CanvasRenderingContext2D, w: number, h: number, xf: Xf, g: Game) {
  const m = 18;
  for (const e of g.enemies) {
    if (!e.visible) continue;
    const [x, y] = px(xf, e.pos);
    if (x > 0 && x < w && y > 0 && y < h) continue;
    const X = Math.max(m, Math.min(w - m, x));
    const Y = Math.max(m + 60, Math.min(h - m, y));
    const a = Math.atan2(y - Y, x - X);
    c.save();
    c.translate(X, Y);
    c.rotate(a);
    c.fillStyle = COLORS[e.kind];
    c.globalAlpha = 0.6 + Math.sin(performance.now() / 120) * 0.3;
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(-6, -7);
    c.lineTo(-6, 7);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.globalAlpha = 1;
}
