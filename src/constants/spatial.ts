export const MAP_SIZE = 32;
export const MAP_MASK = MAP_SIZE - 1;
export const ENCOUNTER_RADIUS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 16] as const;
export const WANDER_BASE_PROB = 0.15;
export const WANDER_LEVEL_BONUS = 0.03;
export const BREAKTHROUGH_MOVE: readonly [number, number] = [2, 4];
