import type { Difficulty, Stats } from './engine.ts';

/**
 * What the game remembers on this device: settings, the best scores, lifetime totals and
 * badges. Pure helpers over plain objects; game.tsx reads and writes them with load/save
 * (and nothing is saved in incognito).
 */

export interface Settings {
  sfx: number;
  music: number;
  muted: boolean;
  vibration: boolean;
  difficulty: Difficulty;
  aimAssist: boolean;
  reduceFlashes: boolean;
  /** Play over made-up planes only, never real flights. */
  fictionalOnly: boolean;
  name: string;
}

export const DEFAULT_SETTINGS: Settings = { sfx: 0.8, music: 0.5, muted: false, vibration: true, difficulty: 'normal', aimAssist: true, reduceFlashes: false, fictionalOnly: false, name: 'שומר' };

export interface Score {
  score: number;
  wave: number;
  name: string;
  difficulty: Difficulty;
  daily: boolean;
  /** Epoch ms. */
  at: number;
}

export function addScore(list: Score[], s: Score, keep = 10): { list: Score[]; rank: number | null } {
  const next = [...list, s].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, keep);
  const rank = next.indexOf(s);
  return { list: next, rank: rank === -1 ? null : rank + 1 };
}

export interface Lifetime {
  games: number;
  kills: number;
  bossKills: number;
  bestWave: number;
}

export const NEW_LIFETIME: Lifetime = { games: 0, kills: 0, bossKills: 0, bestWave: 0 };

export function addLifetime(l: Lifetime, s: Stats): Lifetime {
  return { games: l.games + 1, kills: l.kills + s.kills, bossKills: l.bossKills + s.bossKills, bestWave: Math.max(l.bestWave, s.wave) };
}

export interface Badge {
  id: string;
  title: string;
  hint: string;
  icon: string;
  earned: (s: Stats, score: number, life: Lifetime, extra: { daily: boolean; tutorial: boolean }) => boolean;
}

export const BADGES: Badge[] = [
  { id: 'tutorial', title: 'שומר מוסמך', hint: 'סיימת את ההדרכה של קפטן רום', icon: 'school', earned: (_s, _p, _l, x) => x.tutorial },
  { id: 'first', title: 'יירוט ראשון', hint: 'יירטת פולש ראשון', icon: 'check', earned: (s) => s.kills >= 1 },
  { id: 'k100', title: '100 יירוטים', hint: '100 יירוטים בסך הכול', icon: 'military_tech', earned: (_s, _p, l) => l.kills >= 100 },
  { id: 'k1000', title: 'אלף יירוטים', hint: '1,000 יירוטים בסך הכול', icon: 'workspace_premium', earned: (_s, _p, l) => l.kills >= 1000 },
  { id: 'double', title: 'כפול', hint: 'שני פולשים בפיצוץ אחד', icon: 'stars', earned: (s) => s.multiKills >= 1 },
  { id: 'triple', title: 'שלושה בפיצוץ אחד', hint: 'שלושה פולשים בפיצוץ אחד', icon: 'stars', earned: (s) => s.tripleKills >= 1 },
  { id: 'combo5', title: 'קומבו ×5', hint: 'הגעת למכפיל הכי גבוה', icon: 'bolt', earned: (s) => s.maxMult >= 5 },
  { id: 'perfect', title: 'גל מושלם', hint: 'גל שלם בלי אף פספוס', icon: 'verified', earned: (s) => s.perfectWaves >= 1 },
  { id: 'close', title: 'על הקשקש', hint: 'יירוט ממש ליד טיסה', icon: 'favorite', earned: (s) => s.closeSaves >= 1 },
  { id: 'boss', title: 'מפיל ספינות', hint: 'הפלת ספינת אם', icon: 'rocket_launch', earned: (s) => s.bossKills >= 1 },
  { id: 'w10', title: 'גל 10', hint: 'הגעת לגל 10', icon: 'flag', earned: (s) => s.wave >= 10 },
  { id: 'w20', title: 'גל 20', hint: 'הגעת לגל 20', icon: 'flag', earned: (s) => s.wave >= 20 },
  { id: 'israel', title: 'כל ישראל', hint: 'הגעת לגזרת כל ישראל (גל 21)', icon: 'map', earned: (s) => s.wave >= 21 },
  { id: 's10k', title: '10,000 נקודות', hint: '10,000 נקודות במשמרת אחת', icon: 'sports_score', earned: (_s, p) => p >= 10_000 },
  { id: 's50k', title: '50,000 נקודות', hint: '50,000 נקודות במשמרת אחת', icon: 'sports_score', earned: (_s, p) => p >= 50_000 },
  { id: 'collector', title: 'אספן', hint: '5 בונוסים במשמרת אחת', icon: 'stars', earned: (s) => s.powerups >= 5 },
  { id: 'shock', title: 'גל הלם', hint: '5 פולשים בגל הלם אחד או יותר', icon: 'radar', earned: (s) => s.shockKills >= 5 },
  { id: 'daily', title: 'אתגר יומי', hint: 'שיחקת באתגר היומי', icon: 'calendar_month', earned: (_s, _p, _l, x) => x.daily },
];

/** Badges earned now that were not earned before. */
export function newBadges(have: string[], s: Stats, score: number, life: Lifetime, extra: { daily: boolean; tutorial: boolean }): Badge[] {
  return BADGES.filter((b) => !have.includes(b.id) && b.earned(s, score, life, extra));
}
