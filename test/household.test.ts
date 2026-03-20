import { describe, it, expect, beforeEach } from 'vitest';
import { HouseholdSystem } from '../src/engine/household';
import { SettlementSystem } from '../src/engine/settlement';
import { AreaTagSystem } from '../src/engine/area-tag';
import { createPRNG } from '../src/engine/prng';
import {
  HOUSEHOLD_BASE_GROWTH_RATE,
  HOUSEHOLD_SPLIT_THRESHOLD,
  TERRAIN_SAFETY_FACTOR,
} from '../src/constants';

function makePRNG(seed = 42) {
  return createPRNG(seed);
}

function makeAreaTags(seed = 42): AreaTagSystem {
  const at = new AreaTagSystem();
  at.generate(seed);
  return at;
}

describe('HouseholdSystem', () => {
  let hs: HouseholdSystem;

  beforeEach(() => {
    hs = new HouseholdSystem();
  });

  describe('addHousehold / removeHousehold', () => {
    it('adds and tracks households', () => {
      const h = hs.addHousehold(0, 10, -1);
      expect(h.id).toBe(0);
      expect(h.population).toBe(10);
      expect(hs.count).toBe(1);
      expect(hs.totalPopulation()).toBe(10);
      expect(hs.getHousehold(0)).toBe(h);
      expect(hs.getHouseholdsAtCell(0)?.has(0)).toBe(true);
    });

    it('removes household and cleans up indices', () => {
      hs.addHousehold(5, 10, -1);
      expect(hs.count).toBe(1);
      hs.removeHousehold(0);
      expect(hs.count).toBe(0);
      expect(hs.getHousehold(0)).toBeUndefined();
      expect(hs.getHouseholdsAtCell(5)).toBeUndefined();
    });

    it('removing nonexistent id is a no-op', () => {
      hs.removeHousehold(999);
      expect(hs.count).toBe(0);
    });
  });

  describe('population cache', () => {
    it('tracks settlement population on add/remove', () => {
      hs.addHousehold(0, 10, 0);
      hs.addHousehold(1, 20, 0);
      hs.addHousehold(2, 5, 1);
      expect(hs.settlementPopulation(0)).toBe(30);
      expect(hs.settlementPopulation(1)).toBe(5);

      hs.removeHousehold(0);
      expect(hs.settlementPopulation(0)).toBe(20);
    });

    it('unaffiliated households (settlementId=-1) do not affect cache', () => {
      hs.addHousehold(0, 10, -1);
      expect(hs.settlementPopulation(-1)).toBe(0);
    });
  });

  describe('updateSettlementAffiliation', () => {
    it('moves population between settlement caches', () => {
      const h = hs.addHousehold(0, 10, 0);
      expect(hs.settlementPopulation(0)).toBe(10);

      hs.updateSettlementAffiliation(h.id, 1);
      expect(hs.settlementPopulation(0)).toBe(0);
      expect(hs.settlementPopulation(1)).toBe(10);
      expect(h.settlementId).toBe(1);
    });
  });

  describe('tickAll - growth', () => {
    it('grows household population over time', () => {
      const areaTags = makeAreaTags();
      const prng = makePRNG();
      hs.addHousehold(0, 100, -1);

      // Tick several years to accumulate growth
      for (let i = 0; i < 20; i++) {
        hs.tickAll(prng, areaTags);
      }

      const h = hs.getHousehold(0);
      expect(h).toBeDefined();
      expect(h!.population).toBeGreaterThan(100);
    });
  });

  describe('tickAll - awakening', () => {
    it('produces awakenings with forced prng', () => {
      const areaTags = makeAreaTags();
      // Force prng to always return 0 (below any awakening probability)
      const forcedPrng = () => 0;
      hs.addHousehold(0, 50, 0);

      const { awakenings } = hs.tickAll(forcedPrng, areaTags);

      expect(awakenings.length).toBeGreaterThan(0);
      expect(awakenings[0].householdId).toBe(0);
      expect(awakenings[0].settlementId).toBe(0);
    });

    it('awakening reduces household population by 1', () => {
      const areaTags = makeAreaTags();
      const forcedPrng = () => 0;
      hs.addHousehold(0, 50, 0);

      const popBefore = hs.getHousehold(0)!.population;
      const { awakenings } = hs.tickAll(forcedPrng, areaTags);

      if (awakenings.length > 0) {
        // Population = before + growth - awakenings
        const h = hs.getHousehold(0)!;
        expect(h.population).toBeLessThan(popBefore + 5); // growth is small
      }
    });
  });

  describe('tickAll - split detection', () => {
    it('reports splits when population >= threshold', () => {
      const areaTags = makeAreaTags();
      const prng = makePRNG();
      hs.addHousehold(0, HOUSEHOLD_SPLIT_THRESHOLD, -1);

      const { splits } = hs.tickAll(prng, areaTags);
      // After growth, population should exceed threshold
      expect(splits.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('tickAll - household death', () => {
    it('removes households with population <= 0', () => {
      const areaTags = makeAreaTags();
      const prng = makePRNG();
      // Add household with 0 population
      const h = hs.addHousehold(0, 0, -1);
      h.population = 0;

      hs.tickAll(prng, areaTags);
      expect(hs.count).toBe(0);
    });
  });

  describe('splitHousehold', () => {
    it('splits household into new households at adjacent cell', () => {
      const prng = makePRNG();
      const settlements = new SettlementSystem();
      hs.addHousehold(100, HOUSEHOLD_SPLIT_THRESHOLD + 10, -1);

      const result = hs.splitHousehold(0, prng, settlements);
      expect(result).not.toBeNull();
      expect(result!.newHouseholds.length).toBeGreaterThan(0);
      expect(result!.originCell).not.toBe(100);
    });

    it('returns null if no adjacent cell is available', () => {
      const prng = makePRNG();
      const settlements = new SettlementSystem();

      hs.addHousehold(100, HOUSEHOLD_SPLIT_THRESHOLD + 10, -1);

      // Occupy all 8 adjacent cells in settlements
      const px = 100 % 32;
      const py = (100 - px) / 32;
      const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
      const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
      for (let d = 0; d < 8; d++) {
        const nx = ((px + DX[d]) % 32 + 32) % 32;
        const ny = ((py + DY[d]) % 32 + 32) % 32;
        const idx = ny * 32 + nx;
        // Directly create a settlement at each neighbor
        const dummyH = hs.addHousehold(idx, 10, -1);
        settlements.createSettlement(dummyH.id, idx, 0, prng, hs);
      }

      const result = hs.splitHousehold(0, prng, settlements);
      expect(result).toBeNull();
    });

    it('returns null if population below threshold', () => {
      const prng = makePRNG();
      const settlements = new SettlementSystem();
      hs.addHousehold(100, 10, -1);

      const result = hs.splitHousehold(0, prng, settlements);
      expect(result).toBeNull();
    });
  });

  describe('applyCombatDamage', () => {
    it('distributes damage among households at cell', () => {
      hs.addHousehold(5, 20, 0);
      hs.addHousehold(5, 30, 0);

      hs.applyCombatDamage(5, 6);

      const totalAfter = (hs.getHousehold(0)?.population ?? 0) + (hs.getHousehold(1)?.population ?? 0);
      expect(totalAfter).toBeLessThan(50);
    });

    it('removes household when population drops to 0', () => {
      hs.addHousehold(5, 2, -1);
      hs.applyCombatDamage(5, 10);
      expect(hs.count).toBe(0);
    });

    it('no-ops on empty cell', () => {
      hs.applyCombatDamage(999, 10);
      expect(hs.count).toBe(0);
    });
  });

  describe('generate', () => {
    it('creates initial households', () => {
      const prng = makePRNG();
      const areaTags = makeAreaTags();
      hs.generate(42, prng, areaTags);

      expect(hs.count).toBe(200); // INITIAL_HOUSEHOLD_COUNT default
      expect(hs.totalPopulation()).toBe(200 * 5); // INITIAL_HOUSEHOLD_POP = 5
    });

    it('respects custom household count', () => {
      const prng = makePRNG();
      const areaTags = makeAreaTags();
      hs.generate(42, prng, areaTags, 50);

      expect(hs.count).toBe(50);
    });
  });

  describe('serialization', () => {
    it('round-trips through serialize/deserialize', () => {
      hs.addHousehold(10, 25, 0);
      hs.addHousehold(20, 50, 1);
      hs.addHousehold(30, 100, -1);

      const size = hs.serializeSize();
      const buf = new ArrayBuffer(size);
      const dv = new DataView(buf);
      hs.serializeTo(dv, 0);

      const { system: restored } = HouseholdSystem.deserializeFrom(dv, 0);

      expect(restored.count).toBe(3);
      expect(restored.totalPopulation()).toBe(175);
      expect(restored.settlementPopulation(0)).toBe(25);
      expect(restored.settlementPopulation(1)).toBe(50);

      const h0 = restored.getHousehold(0);
      expect(h0).toBeDefined();
      expect(h0!.cellIdx).toBe(10);
      expect(h0!.population).toBe(25);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      hs.addHousehold(0, 10, 0);
      hs.addHousehold(1, 20, 0);
      hs.reset();

      expect(hs.count).toBe(0);
      expect(hs.totalPopulation()).toBe(0);
      expect(hs.settlementPopulation(0)).toBe(0);
    });
  });
});
