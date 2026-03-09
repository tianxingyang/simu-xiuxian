import { describe, expect, it } from 'vitest';
import { breakthroughChance, LEVEL_COUNT, LEVEL_NAMES } from '../src/constants';

describe('Breakthrough chance curve', () => {
  it('stays within (0, 1) for each breakthrough stage', () => {
    for (let level = 0; level < LEVEL_COUNT - 1; level++) {
      const chance = breakthroughChance(level);
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThan(1);
    }
  });

  it('strictly decreases from lower to higher stages', () => {
    for (let level = 0; level < LEVEL_COUNT - 2; level++) {
      const current = breakthroughChance(level);
      const next = breakthroughChance(level + 1);
      expect(
        next,
        `expected Lv${level} ${LEVEL_NAMES[level]} -> Lv${level + 1} ${LEVEL_NAMES[level + 1]} (${next}) < ` +
        `Lv${level + 1} ${LEVEL_NAMES[level + 1]} -> Lv${level + 2} ${LEVEL_NAMES[level + 2]} (${current})`,
      ).toBeLessThan(current);
    }
  });
});
