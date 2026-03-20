import type { Household } from '../types';
import type { PRNG } from './prng';
import type { AreaTagSystem } from './area-tag';
import type { SettlementSystem } from './settlement';
import {
  BASE_AWAKENING_RATE,
  getRegionCode,
  HOUSEHOLD_BASE_GROWTH_RATE,
  HOUSEHOLD_SPLIT_COUNT,
  HOUSEHOLD_SPLIT_POP,
  HOUSEHOLD_SPLIT_THRESHOLD,
  INITIAL_HOUSEHOLD_COUNT,
  INITIAL_HOUSEHOLD_POP,
  MAP_SIZE,
  SPIRITUAL_ENERGY_AWAKENING_FACTOR,
  TERRAIN_SAFETY_FACTOR,
} from '../constants';

const CELLS = MAP_SIZE * MAP_SIZE;

export interface AwakeningResult {
  householdId: number;
  settlementId: number;
  cellIdx: number;
}

export interface SplitResult {
  parentId: number;
  parentSettlementId: number;
  parentCellIdx: number;
  totalPopulation: number;
}

export class HouseholdSystem {
  private households = new Map<number, Household>();
  private nextId = 0;
  /** Map from cellIdx -> set of household ids at that cell */
  private cellIndex = new Map<number, Set<number>>();
  /** Cached total population per settlement (settlementId -> totalPop) */
  private populationCache = new Map<number, number>();

  get count(): number {
    return this.households.size;
  }

  totalPopulation(): number {
    let sum = 0;
    for (const h of this.households.values()) sum += h.population;
    return sum;
  }

  getHousehold(id: number): Household | undefined {
    return this.households.get(id);
  }

  getHouseholdsAtCell(cellIdx: number): Set<number> | undefined {
    return this.cellIndex.get(cellIdx);
  }

  allHouseholds(): IterableIterator<Household> {
    return this.households.values();
  }

  generate(_seed: number, prng: PRNG, areaTags: AreaTagSystem, householdCount?: number): void {
    // Build weight table: prefer low terrainDanger, exclude ocean ('~')
    const weights = new Float64Array(CELLS);
    let totalWeight = 0;
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const idx = y * MAP_SIZE + x;
        if (getRegionCode(x, y) === '~') continue;
        const td = areaTags.getTerrainDanger(x, y);
        const w = TERRAIN_SAFETY_FACTOR[td];
        weights[idx] = w;
        totalWeight += w;
      }
    }

    if (totalWeight <= 0) return;

    // Normalize weights to CDF
    const cdf = new Float64Array(CELLS);
    cdf[0] = weights[0] / totalWeight;
    for (let i = 1; i < CELLS; i++) {
      cdf[i] = cdf[i - 1] + weights[i] / totalWeight;
    }

    const count = householdCount ?? INITIAL_HOUSEHOLD_COUNT;
    for (let i = 0; i < count; i++) {
      const r = prng();
      // Binary search in CDF
      let lo = 0;
      let hi = CELLS - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] <= r) lo = mid + 1;
        else hi = mid;
      }
      const cellIdx = lo;
      this.addHousehold(cellIdx, INITIAL_HOUSEHOLD_POP, -1);
    }
  }

  addHousehold(cellIdx: number, population: number, settlementId: number): Household {
    const id = this.nextId++;
    const h: Household = {
      id,
      settlementId,
      population,
      growthAccum: 0,
      cellIdx,
    };
    this.households.set(id, h);

    let cellSet = this.cellIndex.get(cellIdx);
    if (!cellSet) {
      cellSet = new Set();
      this.cellIndex.set(cellIdx, cellSet);
    }
    cellSet.add(id);

    if (settlementId >= 0) {
      this.populationCache.set(settlementId, (this.populationCache.get(settlementId) ?? 0) + population);
    }

    return h;
  }

  removeHousehold(id: number): void {
    const h = this.households.get(id);
    if (!h) return;
    if (h.settlementId >= 0) {
      const cached = this.populationCache.get(h.settlementId);
      if (cached !== undefined) {
        const updated = cached - h.population;
        if (updated <= 0) this.populationCache.delete(h.settlementId);
        else this.populationCache.set(h.settlementId, updated);
      }
    }
    this.households.delete(id);
    const cellSet = this.cellIndex.get(h.cellIdx);
    if (cellSet) {
      cellSet.delete(id);
      if (cellSet.size === 0) this.cellIndex.delete(h.cellIdx);
    }
  }

  /**
   * Tick all households. Returns awakenings and split candidates.
   */
  tickAll(
    prng: PRNG,
    areaTags: AreaTagSystem,
  ): { awakenings: AwakeningResult[]; splits: SplitResult[] } {
    const awakenings: AwakeningResult[] = [];
    const splits: SplitResult[] = [];
    const toRemove: number[] = [];

    for (const h of this.households.values()) {
      const x = h.cellIdx % MAP_SIZE;
      const y = (h.cellIdx - x) / MAP_SIZE;
      const td = areaTags.getTerrainDanger(x, y);
      const se = areaTags.getSpiritualEnergy(x, y);

      // Growth
      const safetyFactor = TERRAIN_SAFETY_FACTOR[td];
      const rawGrowth = h.population * HOUSEHOLD_BASE_GROWTH_RATE * safetyFactor;
      h.growthAccum += rawGrowth;
      const intGrowth = Math.floor(h.growthAccum);
      if (intGrowth > 0) {
        h.population += intGrowth;
        h.growthAccum -= intGrowth;
        if (h.settlementId >= 0) {
          this.populationCache.set(h.settlementId, (this.populationCache.get(h.settlementId) ?? 0) + intGrowth);
        }
      }

      // Awakening
      const awakeningFactor = SPIRITUAL_ENERGY_AWAKENING_FACTOR[se];
      const awakeningProb = BASE_AWAKENING_RATE * h.population * awakeningFactor;
      if (prng() < awakeningProb && h.population > 1) {
        h.population -= 1;
        if (h.settlementId >= 0) {
          const cached = this.populationCache.get(h.settlementId);
          if (cached !== undefined && cached > 0) {
            this.populationCache.set(h.settlementId, cached - 1);
          }
        }
        awakenings.push({
          householdId: h.id,
          settlementId: h.settlementId,
          cellIdx: h.cellIdx,
        });
      }

      // Split check
      if (h.population >= HOUSEHOLD_SPLIT_THRESHOLD) {
        splits.push({
          parentId: h.id,
          parentSettlementId: h.settlementId,
          parentCellIdx: h.cellIdx,
          totalPopulation: h.population,
        });
      }

      // Death
      if (h.population <= 0) {
        toRemove.push(h.id);
      }
    }

    for (const id of toRemove) {
      this.removeHousehold(id);
    }

    return { awakenings, splits };
  }

  /**
   * Split a household: reduce parent population, create child households.
   * Returns the cell index of the new settlement origin.
   */
  splitHousehold(
    parentId: number,
    prng: PRNG,
    settlements: SettlementSystem,
  ): { newHouseholds: Household[]; originCell: number } | null {
    const parent = this.households.get(parentId);
    if (!parent || parent.population < HOUSEHOLD_SPLIT_THRESHOLD) return null;

    const px = parent.cellIdx % MAP_SIZE;
    const py = (parent.cellIdx - px) / MAP_SIZE;

    // Find a valid adjacent cell not already occupied by a settlement
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;
    const candidates: number[] = [];
    for (let d = 0; d < 8; d++) {
      const nx = ((px + DX[d]) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
      const ny = ((py + DY[d]) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
      const idx = ny * MAP_SIZE + nx;
      if (!settlements.isCellOccupied(idx)) {
        candidates.push(idx);
      }
    }

    // No empty neighbor cell available - don't split
    if (candidates.length === 0) return null;

    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const targetCell = candidates[0];

    // Split: take population from parent, create new households at target cell
    const splitPop = Math.min(parent.population, HOUSEHOLD_SPLIT_COUNT * HOUSEHOLD_SPLIT_POP);
    parent.population -= splitPop;
    if (parent.settlementId >= 0 && splitPop > 0) {
      const cached = this.populationCache.get(parent.settlementId);
      if (cached !== undefined) {
        const updated = cached - splitPop;
        if (updated <= 0) this.populationCache.delete(parent.settlementId);
        else this.populationCache.set(parent.settlementId, updated);
      }
    }

    const newHouseholds: Household[] = [];
    const perHousehold = Math.floor(splitPop / HOUSEHOLD_SPLIT_COUNT);
    let remainder = splitPop - perHousehold * HOUSEHOLD_SPLIT_COUNT;

    for (let i = 0; i < HOUSEHOLD_SPLIT_COUNT; i++) {
      const pop = perHousehold + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      if (pop > 0) {
        const nh = this.addHousehold(targetCell, pop, -1);
        newHouseholds.push(nh);
      }
    }

    return { newHouseholds, originCell: targetCell };
  }

  /** Apply collateral damage from combat at a cell */
  applyCombatDamage(cellIdx: number, damage: number): void {
    const cellSet = this.cellIndex.get(cellIdx);
    if (!cellSet || cellSet.size === 0) return;

    // Distribute damage among households at this cell
    const ids = [...cellSet];
    const perHousehold = Math.max(1, Math.ceil(damage / ids.length));
    const toRemove: number[] = [];
    for (const hid of ids) {
      const h = this.households.get(hid);
      if (!h) continue;
      const loss = Math.min(h.population, perHousehold);
      h.population -= loss;
      if (h.settlementId >= 0 && loss > 0) {
        const cached = this.populationCache.get(h.settlementId);
        if (cached !== undefined) {
          const updated = cached - loss;
          if (updated <= 0) this.populationCache.delete(h.settlementId);
          else this.populationCache.set(h.settlementId, updated);
        }
      }
      if (h.population <= 0) {
        toRemove.push(hid);
      }
    }
    for (const id of toRemove) {
      this.removeHousehold(id);
    }
  }

  /** Get total population of a settlement from cache */
  settlementPopulation(settlementId: number): number {
    return this.populationCache.get(settlementId) ?? 0;
  }

  /** Update population cache when a household's settlementId changes */
  updateSettlementAffiliation(householdId: number, newSettlementId: number): void {
    const h = this.households.get(householdId);
    if (!h) return;
    const oldSid = h.settlementId;
    if (oldSid === newSettlementId) return;
    // Remove from old settlement cache
    if (oldSid >= 0) {
      const cached = this.populationCache.get(oldSid);
      if (cached !== undefined) {
        const updated = cached - h.population;
        if (updated <= 0) this.populationCache.delete(oldSid);
        else this.populationCache.set(oldSid, updated);
      }
    }
    // Add to new settlement cache
    h.settlementId = newSettlementId;
    if (newSettlementId >= 0) {
      this.populationCache.set(newSettlementId, (this.populationCache.get(newSettlementId) ?? 0) + h.population);
    }
  }

  reset(): void {
    this.households.clear();
    this.cellIndex.clear();
    this.populationCache.clear();
    this.nextId = 0;
  }

  // --- Serialization ---

  serializeSize(): number {
    // header: nextId(i32) + count(i32)
    // per household: id(i32) + settlementId(i32) + population(i32) + growthAccum(f32) + cellIdx(i32) = 20 bytes
    return 8 + this.households.size * 20;
  }

  serializeTo(dv: DataView, off: number): number {
    dv.setInt32(off, this.nextId, true); off += 4;
    dv.setInt32(off, this.households.size, true); off += 4;
    for (const h of this.households.values()) {
      dv.setInt32(off, h.id, true); off += 4;
      dv.setInt32(off, h.settlementId, true); off += 4;
      dv.setInt32(off, h.population, true); off += 4;
      dv.setFloat32(off, h.growthAccum, true); off += 4;
      dv.setInt32(off, h.cellIdx, true); off += 4;
    }
    return off;
  }

  static deserializeFrom(dv: DataView, off: number): { system: HouseholdSystem; offset: number } {
    const system = new HouseholdSystem();
    system.nextId = dv.getInt32(off, true); off += 4;
    const count = dv.getInt32(off, true); off += 4;
    for (let i = 0; i < count; i++) {
      const id = dv.getInt32(off, true); off += 4;
      const settlementId = dv.getInt32(off, true); off += 4;
      const population = dv.getInt32(off, true); off += 4;
      const growthAccum = dv.getFloat32(off, true); off += 4;
      const cellIdx = dv.getInt32(off, true); off += 4;

      const h: Household = { id, settlementId, population, growthAccum, cellIdx };
      system.households.set(id, h);

      let cellSet = system.cellIndex.get(cellIdx);
      if (!cellSet) {
        cellSet = new Set();
        system.cellIndex.set(cellIdx, cellSet);
      }
      cellSet.add(id);

      if (settlementId >= 0) {
        system.populationCache.set(settlementId, (system.populationCache.get(settlementId) ?? 0) + population);
      }
    }
    return { system, offset: off };
  }
}
