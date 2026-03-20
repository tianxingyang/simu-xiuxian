export const TERRAIN_SAFETY_FACTOR: readonly number[] = [
  0, 1.2, 1.1, 1.0, 0.8, 0.5,
] as const;

export const SPIRITUAL_ENERGY_AWAKENING_FACTOR: readonly number[] = [
  0, 0.5, 0.8, 1.0, 1.5, 2.5,
] as const;

export const SPIRITUAL_ENERGY_BREAKTHROUGH_FACTOR: readonly number[] = [
  0, 0.7, 0.85, 1.0, 1.2, 1.5,
] as const;

export const TERRAIN_DANGER_ENCOUNTER_FACTOR: readonly number[] = [
  0, 0.6, 0.8, 1.0, 1.3, 1.6,
] as const;

export const TERRAIN_DANGER_EVASION_ADJUST: readonly number[] = [
  0, 0.05, 0.025, 0, -0.05, -0.1,
] as const;
