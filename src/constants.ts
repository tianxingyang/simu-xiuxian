export const LEVEL_NAMES = [
  '炼气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘',
] as const;

export const LEVEL_COUNT = LEVEL_NAMES.length;
export const MORTAL_MAX_AGE = 60;
export const YEARLY_NEW = 1000;
export const ABSORB_RATE = 0.1;
export const MAX_EVENTS = 1000;
export const MAX_TREND_POINTS = 2000;
export const EVENTS_PER_TICK = 50;

export function threshold(level: number): number {
  return level >= 1 ? 10 ** level : Infinity;
}

export function lifespanBonus(level: number): number {
  if (level <= 0) return 0;
  if (level === 1) return 100;
  return 8 * 10 ** level;
}

export function round1(v: number): number {
  return Math.round(v * 10) / 10;
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
