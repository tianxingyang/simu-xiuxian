import { describe, it, expect, beforeEach } from 'vitest';
import { SettlementSystem } from '../src/engine/settlement';
import { HouseholdSystem } from '../src/engine/household';
import { createPRNG } from '../src/engine/prng';
import {
  SETTLEMENT_VILLAGE_MIN,
  SETTLEMENT_TOWN_MIN,
  SETTLEMENT_CITY_MIN,
  SETTLEMENT_EXPAND_THRESHOLD,
} from '../src/constants';

function makePRNG(seed = 42) {
  return createPRNG(seed);
}

describe('SettlementSystem', () => {
  let ss: SettlementSystem;
  let hs: HouseholdSystem;

  beforeEach(() => {
    ss = new SettlementSystem();
    hs = new HouseholdSystem();
  });

  describe('createSettlement', () => {
    it('creates settlement and affiliates households', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(100, 30, -1);

      const s = ss.createSettlement(h.id, 100, 1, prng, hs);

      expect(s.id).toBe(0);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.cells).toEqual([100]);
      expect(s.originHouseholdId).toBe(h.id);
      expect(s.foundedYear).toBe(1);
      expect(ss.count).toBe(1);

      // Household should now be affiliated
      expect(h.settlementId).toBe(s.id);
    });
  });

  describe('isCellOccupied / getSettlementsAtCell', () => {
    it('tracks cell occupancy', () => {
      const prng = makePRNG();
      expect(ss.isCellOccupied(100)).toBe(false);

      const h = hs.addHousehold(100, 10, -1);
      ss.createSettlement(h.id, 100, 1, prng, hs);

      expect(ss.isCellOccupied(100)).toBe(true);
      const set = ss.getSettlementsAtCell(100);
      expect(set?.size).toBe(1);
    });

    it('supports multiple settlements per cell', () => {
      const prng = makePRNG();
      const h1 = hs.addHousehold(100, 10, -1);
      const h2 = hs.addHousehold(100, 10, -1);

      ss.createSettlement(h1.id, 100, 1, prng, hs);
      // Force second household back to unaffiliated for second settlement
      hs.updateSettlementAffiliation(h2.id, -1);
      ss.createSettlement(h2.id, 100, 2, prng, hs);

      const set = ss.getSettlementsAtCell(100);
      expect(set?.size).toBe(2);
    });
  });

  describe('getType', () => {
    it('classifies hamlet (< 200)', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(0, 50, -1);
      ss.createSettlement(h.id, 0, 1, prng, hs);

      expect(ss.getType(0, hs)).toBe('hamlet');
    });

    it('classifies village (200-999)', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(0, SETTLEMENT_VILLAGE_MIN, -1);
      ss.createSettlement(h.id, 0, 1, prng, hs);

      expect(ss.getType(0, hs)).toBe('village');
    });

    it('classifies town (1000-4999)', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(0, SETTLEMENT_TOWN_MIN, -1);
      ss.createSettlement(h.id, 0, 1, prng, hs);

      expect(ss.getType(0, hs)).toBe('town');
    });

    it('classifies city (5000+)', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(0, SETTLEMENT_CITY_MIN, -1);
      ss.createSettlement(h.id, 0, 1, prng, hs);

      expect(ss.getType(0, hs)).toBe('city');
    });
  });

  describe('tryExpand', () => {
    it('expands when population exceeds threshold per cell', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(100, SETTLEMENT_EXPAND_THRESHOLD + 1, -1);
      ss.createSettlement(h.id, 100, 1, prng, hs);

      const expanded = ss.tryExpand(0, prng, hs);
      expect(expanded).toBe(true);

      const s = ss.getSettlement(0);
      expect(s!.cells.length).toBe(2);
    });

    it('does not expand if population below threshold', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(100, 10, -1);
      ss.createSettlement(h.id, 100, 1, prng, hs);

      const expanded = ss.tryExpand(0, prng, hs);
      expect(expanded).toBe(false);
    });

    it('does not expand if all neighbors occupied', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(100, SETTLEMENT_EXPAND_THRESHOLD + 1, -1);
      ss.createSettlement(h.id, 100, 1, prng, hs);

      // Occupy all adjacent cells
      const px = 100 % 32;
      const py = (100 - px) / 32;
      const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
      const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
      for (let d = 0; d < 8; d++) {
        const nx = ((px + DX[d]) % 32 + 32) % 32;
        const ny = ((py + DY[d]) % 32 + 32) % 32;
        const idx = ny * 32 + nx;
        const dh = hs.addHousehold(idx, 10, -1);
        ss.createSettlement(dh.id, idx, 1, prng, hs);
      }

      const expanded = ss.tryExpand(0, prng, hs);
      expect(expanded).toBe(false);
    });
  });

  describe('pruneDestroyed', () => {
    it('removes settlements with zero population', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(100, 10, -1);
      ss.createSettlement(h.id, 100, 1, prng, hs);
      expect(ss.count).toBe(1);

      // Remove all households -> settlement has 0 pop
      hs.removeHousehold(h.id);
      ss.pruneDestroyed(hs);

      expect(ss.count).toBe(0);
      expect(ss.isCellOccupied(100)).toBe(false);
    });

    it('keeps settlements with population', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(100, 10, -1);
      ss.createSettlement(h.id, 100, 1, prng, hs);

      ss.pruneDestroyed(hs);
      expect(ss.count).toBe(1);
    });
  });

  describe('typeCounts', () => {
    it('counts settlement types correctly', () => {
      const prng = makePRNG();
      const h1 = hs.addHousehold(0, 50, -1);
      const h2 = hs.addHousehold(10, SETTLEMENT_VILLAGE_MIN, -1);
      ss.createSettlement(h1.id, 0, 1, prng, hs);
      ss.createSettlement(h2.id, 10, 1, prng, hs);

      const counts = ss.getTypeCounts();
      expect(counts.hamlet).toBe(1);
      expect(counts.village).toBe(1);
      expect(counts.town).toBe(0);
      expect(counts.city).toBe(0);
    });
  });

  describe('serialization', () => {
    it('round-trips through serialize/deserialize', () => {
      const prng = makePRNG();
      const h1 = hs.addHousehold(50, 20, -1);
      const h2 = hs.addHousehold(100, 30, -1);
      ss.createSettlement(h1.id, 50, 10, prng, hs);
      ss.createSettlement(h2.id, 100, 20, prng, hs);

      const size = ss.serializeSize();
      const buf = Buffer.alloc(size);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      ss.serializeTo(dv, 0, buf);

      const { system: restored } = SettlementSystem.deserializeFrom(dv, 0, buf);

      expect(restored.count).toBe(2);

      const s0 = restored.getSettlement(0);
      expect(s0).toBeDefined();
      expect(s0!.name.length).toBeGreaterThan(0);
      expect(s0!.cells).toEqual([50]);
      expect(s0!.foundedYear).toBe(10);

      const s1 = restored.getSettlement(1);
      expect(s1).toBeDefined();
      expect(s1!.cells).toEqual([100]);
      expect(s1!.foundedYear).toBe(20);

      // Cell index rebuilt correctly
      expect(restored.isCellOccupied(50)).toBe(true);
      expect(restored.isCellOccupied(100)).toBe(true);
      expect(restored.isCellOccupied(0)).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      const prng = makePRNG();
      const h = hs.addHousehold(100, 10, -1);
      ss.createSettlement(h.id, 100, 1, prng, hs);
      ss.reset();

      expect(ss.count).toBe(0);
      expect(ss.isCellOccupied(100)).toBe(false);
      const counts = ss.getTypeCounts();
      expect(counts.hamlet).toBe(0);
    });
  });
});
