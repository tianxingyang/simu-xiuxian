import type { Cultivator } from './types';

export const LEVEL_NAMES = [
  '炼气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘',
] as const;

export const LEVEL_COUNT = LEVEL_NAMES.length;
export const MORTAL_MAX_AGE = 60;
export const YEARLY_NEW = 1000;
export const LOOT_BASE_RATE = 0.05;
export const LOOT_VARIABLE_RATE = 0.1;
export const LUCK_MEAN = 1.0;
export const LUCK_STDDEV = 0.3;
export const LUCK_MIN = 0;
export const LUCK_MAX = 2.5;
export const MAX_EVENTS = 1000;
export const MAX_TREND_POINTS = 2000;
export const EVENTS_PER_TICK = 50;

export const COURAGE_TROUGH = 0.3;
export const COURAGE_YOUNG_AMP = 0.1;
export const COURAGE_OLD_AMP = 0.3;
export const COURAGE_MEAN = 0.5;
export const COURAGE_STDDEV = 0.15;
export const EVASION_SENSITIVITY = 0.5;
export const EVASION_PENALTY = 0.05;

export const DEFEAT_DEATH_BASE = 0.40;
export const DEFEAT_DEATH_DECAY = 0.72;
export const DEFEAT_GAP_SEVERITY = 0.3;
export const DEFEAT_MAX_DEATH = 0.95;
export const DEFEAT_DEMOTION_W = 0.1;
export const DEFEAT_INJURY_W = 2.9;
export const DEFEAT_CULT_LOSS_W = 2.0;
export const DEFEAT_LIGHT_INJURY_W = 4.0;
export const DEFEAT_MERIDIAN_W = 1.0;
export const DEFEAT_CULT_LOSS_RATE = 0.3;
export const INJURY_DURATION = 5;
export const INJURY_GROWTH_RATE = 0.5;
export const LIGHT_INJURY_DURATION = 2;
export const LIGHT_INJURY_GROWTH_RATE = 0.7;
export const MERIDIAN_DAMAGE_DURATION = 10;
export const MERIDIAN_COMBAT_PENALTY = 0.3;
export const LIFESPAN_DECAY_RATE = 0.2;

export const BREAKTHROUGH_A = 0.6;
export const BREAKTHROUGH_B = 0.15;
export const BREAKTHROUGH_COOLDOWN = 3;
export const BREAKTHROUGH_CULT_LOSS_RATE = 0.2;
export const BREAKTHROUGH_NOTHING_W = 5.0;
export const BREAKTHROUGH_CULT_LOSS_W = 2.0;
export const BREAKTHROUGH_INJURY_W = 2.0;

export const SUSTAINABLE_MAX_AGE = [
  60, 100, 900, 8_900, 88_900, 888_900, 8_888_900, 88_888_900,
] as const;

export const THRESHOLDS: readonly number[] = [Infinity, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];

export function threshold(level: number): number {
  return THRESHOLDS[level];
}

export function lifespanBonus(level: number): number {
  if (level <= 0) return 0;
  if (level === 1) return 100;
  return 8 * 10 ** level;
}

export function breakthroughChance(level: number): number {
  return Math.exp(-(BREAKTHROUGH_A + BREAKTHROUGH_B * (2 * level + 1)));
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function effectiveCourage(c: Cultivator): number {
  const t = c.age / c.maxAge;
  const boost = t < COURAGE_TROUGH
    ? COURAGE_YOUNG_AMP * (1 - t / COURAGE_TROUGH) ** 2
    : COURAGE_OLD_AMP * ((t - COURAGE_TROUGH) / (1 - COURAGE_TROUGH)) ** 2;
  return round2(Math.min(1, c.courage + boost));
}

export const LEVEL_COLORS = [
  '#555',    // Lv0 炼气
  '#7fb069', // Lv1 筑基
  '#5ab0c4', // Lv2 结丹
  '#6c8cff', // Lv3 元婴
  '#a67bff', // Lv4 化神
  '#ff9b4e', // Lv5 炼虚
  '#ff5c5c', // Lv6 合体
  '#ffd700', // Lv7 大乘
] as const;
