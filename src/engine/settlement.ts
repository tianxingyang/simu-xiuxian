import type { Settlement, SettlementType } from '../types.js';
import { getSimTuning } from '../sim-tuning.js';
import type { PRNG } from './prng.js';
import type { HouseholdSystem } from './household.js';
import {
  MAP_SIZE,
  SETTLEMENT_CITY_MIN,
  SETTLEMENT_TOWN_MIN,
  SETTLEMENT_VILLAGE_MIN,
} from '../constants/index.js';

// Settlement name generation pools
const SETTLEMENT_PREFIX = [
  '青', '白', '赤', '玄', '金', '翠', '碧', '紫', '苍', '丹',
  '云', '龙', '凤', '鹤', '虎', '鹿', '灵', '仙', '神', '天',
  '明', '清', '安', '宁', '平', '永', '长', '广', '通', '和',
  '瑞', '祥', '兴', '盛', '丰', '泰', '昌', '隆', '嘉', '福',
  '石', '沙', '柳', '桃', '松', '竹', '梅', '兰', '荷', '桂',
  '东', '西', '南', '北', '中', '上', '下', '左', '右', '前',
] as const;

const SETTLEMENT_SUFFIX_HAMLET = ['寨', '庄', '屯', '坊', '营'] as const;
const SETTLEMENT_SUFFIX_VILLAGE = ['村', '里', '堡', '集'] as const;

export class SettlementSystem {
  private settlements = new Map<number, Settlement>();
  private nextId = 0;
  /** Track which cells are claimed by settlements (multi-settlement per cell) */
  private cellToSettlement = new Map<number, Set<number>>();
  /** Count by type for summary */
  private typeCounts: Record<SettlementType, number> = { hamlet: 0, village: 0, town: 0, city: 0 };

  get count(): number {
    return this.settlements.size;
  }

  getSettlement(id: number): Settlement | undefined {
    return this.settlements.get(id);
  }

  getSettlementsAtCell(cellIdx: number): Set<number> | undefined {
    return this.cellToSettlement.get(cellIdx);
  }

  isCellOccupied(cellIdx: number): boolean {
    const s = this.cellToSettlement.get(cellIdx);
    return s !== undefined && s.size > 0;
  }

  getTypeCounts(): Readonly<Record<SettlementType, number>> {
    return this.typeCounts;
  }

  allSettlements(): IterableIterator<Settlement> {
    return this.settlements.values();
  }

  getType(settlementId: number, households: HouseholdSystem): SettlementType {
    const pop = households.settlementPopulation(settlementId);
    return populationToType(pop);
  }

  createSettlement(
    originHouseholdId: number,
    cell: number,
    year: number,
    prng: PRNG,
    households: HouseholdSystem,
  ): Settlement {
    const id = this.nextId++;
    const name = this.generateName(prng);
    const s: Settlement = {
      id,
      name,
      cells: [cell],
      originHouseholdId,
      foundedYear: year,
    };
    this.settlements.set(id, s);
    let cellSet = this.cellToSettlement.get(cell);
    if (!cellSet) {
      cellSet = new Set();
      this.cellToSettlement.set(cell, cellSet);
    }
    cellSet.add(id);

    // Affiliate origin household's child households to this settlement
    const cellHouseholds = households.getHouseholdsAtCell(cell);
    if (cellHouseholds) {
      for (const hid of cellHouseholds) {
        const h = households.getHousehold(hid);
        if (h && h.settlementId === -1) {
          households.updateSettlementAffiliation(hid, id);
        }
      }
    }

    this.recountTypes(households);
    return s;
  }

  /** Claim a cell for an existing settlement and affiliate unaffiliated households there */
  addCell(settlementId: number, cellIdx: number, households: HouseholdSystem): void {
    const s = this.settlements.get(settlementId);
    if (!s) return;
    if (!s.cells.includes(cellIdx)) {
      s.cells.push(cellIdx);
      let cellSet = this.cellToSettlement.get(cellIdx);
      if (!cellSet) {
        cellSet = new Set();
        this.cellToSettlement.set(cellIdx, cellSet);
      }
      cellSet.add(settlementId);
    }
    const cellHouseholds = households.getHouseholdsAtCell(cellIdx);
    if (cellHouseholds) {
      for (const hid of cellHouseholds) {
        const h = households.getHousehold(hid);
        if (h && h.settlementId === -1) {
          households.updateSettlementAffiliation(hid, settlementId);
        }
      }
    }
  }

  tryExpand(settlementId: number, prng: PRNG, households: HouseholdSystem): boolean {
    const tuning = getSimTuning();
    const s = this.settlements.get(settlementId);
    if (!s) return false;

    const pop = households.settlementPopulation(settlementId);
    // Expand when population exceeds threshold per cell
    if (pop < s.cells.length * tuning.settlement.expandThreshold) return false;

    // Find adjacent cells not already claimed
    const candidateCells = new Set<number>();
    for (const cellIdx of s.cells) {
      const x = cellIdx % MAP_SIZE;
      const y = (cellIdx - x) / MAP_SIZE;
      const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
      const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
      for (let d = 0; d < 8; d++) {
        const nx = ((x + DX[d]) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
        const ny = ((y + DY[d]) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
        const nIdx = ny * MAP_SIZE + nx;
        if (!this.isCellOccupied(nIdx) && !s.cells.includes(nIdx)) {
          candidateCells.add(nIdx);
        }
      }
    }

    if (candidateCells.size === 0) return false;

    const candidates = [...candidateCells];
    const chosen = candidates[Math.floor(prng() * candidates.length)];
    s.cells.push(chosen);
    let chosenSet = this.cellToSettlement.get(chosen);
    if (!chosenSet) {
      chosenSet = new Set();
      this.cellToSettlement.set(chosen, chosenSet);
    }
    chosenSet.add(settlementId);

    // Affiliate any unaffiliated households at the new cell
    const cellHouseholds = households.getHouseholdsAtCell(chosen);
    if (cellHouseholds) {
      for (const hid of cellHouseholds) {
        const h = households.getHousehold(hid);
        if (h && h.settlementId === -1) {
          households.updateSettlementAffiliation(hid, settlementId);
        }
      }
    }

    return true;
  }

  /** Shrink settlement by releasing edge cells when population density drops */
  tryShrink(settlementId: number, households: HouseholdSystem): boolean {
    const tuning = getSimTuning();
    const s = this.settlements.get(settlementId);
    if (!s || s.cells.length <= 1) return false;

    const pop = households.settlementPopulation(settlementId);
    if (pop >= s.cells.length * tuning.settlement.shrinkThreshold) return false;

    // Release the last cell (farthest from origin)
    const released = s.cells.pop();
    if (released === undefined) return false;
    const cs = this.cellToSettlement.get(released);
    if (cs) {
      cs.delete(settlementId);
      if (cs.size === 0) this.cellToSettlement.delete(released);
    }

    // Unaffiliate households on the released cell
    const cellHouseholds = households.getHouseholdsAtCell(released);
    if (cellHouseholds) {
      for (const hid of cellHouseholds) {
        const h = households.getHousehold(hid);
        if (h && h.settlementId === settlementId) {
          households.updateSettlementAffiliation(hid, -1);
        }
      }
    }

    return true;
  }

  /** Check if any settlements should be removed (all households gone) */
  pruneDestroyed(households: HouseholdSystem): void {
    const toRemove: number[] = [];
    for (const s of this.settlements.values()) {
      const pop = households.settlementPopulation(s.id);
      if (pop <= 0) {
        toRemove.push(s.id);
      }
    }
    for (const id of toRemove) {
      const s = this.settlements.get(id);
      if (s) {
        for (const cell of s.cells) {
          const cs = this.cellToSettlement.get(cell);
          if (cs) {
            cs.delete(id);
            if (cs.size === 0) this.cellToSettlement.delete(cell);
          }
        }
        this.settlements.delete(id);
      }
    }
    if (toRemove.length > 0) {
      this.recountTypes(households);
    }
  }

  /** Recount type distribution */
  recountTypes(households: HouseholdSystem): void {
    this.typeCounts = { hamlet: 0, village: 0, town: 0, city: 0 };
    for (const s of this.settlements.values()) {
      const pop = households.settlementPopulation(s.id);
      const t = populationToType(pop);
      this.typeCounts[t]++;
    }
  }

  private generateName(prng: PRNG): string {
    const prefix = SETTLEMENT_PREFIX[Math.floor(prng() * SETTLEMENT_PREFIX.length)];
    // Mix hamlet and village suffixes for variety
    const allSuffixes = [...SETTLEMENT_SUFFIX_HAMLET, ...SETTLEMENT_SUFFIX_VILLAGE];
    const suffix = allSuffixes[Math.floor(prng() * allSuffixes.length)];
    return prefix + suffix;
  }

  reset(): void {
    this.settlements.clear();
    this.cellToSettlement.clear();
    this.nextId = 0;
    this.typeCounts = { hamlet: 0, village: 0, town: 0, city: 0 };
  }

  // --- Serialization ---

  serializeSize(): number {
    // header: nextId(i32) + count(i32)
    let size = 8;
    for (const s of this.settlements.values()) {
      // id(i32) + nameLen(u16) + name(utf8) + cellsLen(i32) + cells(i32[]) + originHouseholdId(i32) + foundedYear(i32)
      size += 4 + 2 + new TextEncoder().encode(s.name).length + 4 + s.cells.length * 4 + 4 + 4;
    }
    return size;
  }

  serializeTo(dv: DataView, off: number, buf: Buffer): number {
    dv.setInt32(off, this.nextId, true); off += 4;
    dv.setInt32(off, this.settlements.size, true); off += 4;

    const encoder = new TextEncoder();
    for (const s of this.settlements.values()) {
      dv.setInt32(off, s.id, true); off += 4;
      const nameBytes = encoder.encode(s.name);
      dv.setUint16(off, nameBytes.length, true); off += 2;
      for (let i = 0; i < nameBytes.length; i++) {
        buf[off + i] = nameBytes[i];
      }
      off += nameBytes.length;
      dv.setInt32(off, s.cells.length, true); off += 4;
      for (const cell of s.cells) {
        dv.setInt32(off, cell, true); off += 4;
      }
      dv.setInt32(off, s.originHouseholdId, true); off += 4;
      dv.setInt32(off, s.foundedYear, true); off += 4;
    }
    return off;
  }

  static deserializeFrom(dv: DataView, off: number, buf: Buffer): { system: SettlementSystem; offset: number } {
    const system = new SettlementSystem();
    system.nextId = dv.getInt32(off, true); off += 4;
    const count = dv.getInt32(off, true); off += 4;

    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      const id = dv.getInt32(off, true); off += 4;
      const nameLen = dv.getUint16(off, true); off += 2;
      const name = decoder.decode(buf.subarray(off, off + nameLen));
      off += nameLen;
      const cellsLen = dv.getInt32(off, true); off += 4;
      const cells: number[] = new Array(cellsLen);
      for (let j = 0; j < cellsLen; j++) {
        cells[j] = dv.getInt32(off, true); off += 4;
      }
      const originHouseholdId = dv.getInt32(off, true); off += 4;
      const foundedYear = dv.getInt32(off, true); off += 4;

      const s: Settlement = { id, name, cells, originHouseholdId, foundedYear };
      system.settlements.set(id, s);
      for (const cell of cells) {
        let cellSet = system.cellToSettlement.get(cell);
        if (!cellSet) {
          cellSet = new Set();
          system.cellToSettlement.set(cell, cellSet);
        }
        cellSet.add(id);
      }
    }

    return { system, offset: off };
  }
}

function populationToType(pop: number): SettlementType {
  if (pop >= SETTLEMENT_CITY_MIN) return 'city';
  if (pop >= SETTLEMENT_TOWN_MIN) return 'town';
  if (pop >= SETTLEMENT_VILLAGE_MIN) return 'village';
  return 'hamlet';
}

export function getSettlementTypeName(type: SettlementType): string {
  switch (type) {
    case 'hamlet': return '村落';
    case 'village': return '村庄';
    case 'town': return '镇';
    case 'city': return '城';
    default: return type satisfies never;
  }
}
