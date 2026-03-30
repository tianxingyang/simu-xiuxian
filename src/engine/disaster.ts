import type { DisasterType } from '../sim-tuning.js';
import { getSimTuning } from '../sim-tuning.js';
import { MAP_SIZE } from '../constants/index.js';
import type { PRNG } from './prng.js';
import type { AreaTagSystem } from './area-tag.js';
import type { HouseholdSystem } from './household.js';
import type { SettlementSystem } from './settlement.js';

export interface DisasterResult {
  type: DisasterType;
  settlementId: number;
  settlementName: string;
  populationBefore: number;
  populationLost: number;
  lossRatio: number;
  originCellIdx: number;
}

const DISASTER_TYPES: readonly DisasterType[] = [
  'plague', 'famine', 'flood', 'beast_tide', 'qi_disruption',
] as const;

export function processDisasters(
  prng: PRNG,
  settlements: SettlementSystem,
  households: HouseholdSystem,
  areaTags: AreaTagSystem,
): DisasterResult[] {
  const tuning = getSimTuning();
  if (!tuning.disaster.enabled) return [];

  const results: DisasterResult[] = [];

  for (const s of settlements.allSettlements()) {
    const totalPop = households.settlementPopulation(s.id);
    if (totalPop <= 0) continue;

    const cellCount = s.cells.length;
    const densityRatio = totalPop / (cellCount * tuning.mortalDeath.carryingCapacityPerCell);

    let avgTD = 0;
    let avgSE = 0;
    for (const cellIdx of s.cells) {
      const x = cellIdx % MAP_SIZE;
      const y = (cellIdx - x) / MAP_SIZE;
      avgTD += areaTags.getTerrainDanger(x, y);
      avgSE += areaTags.getSpiritualEnergy(x, y);
    }
    avgTD /= cellCount;
    avgSE /= cellCount;

    for (const dtype of DISASTER_TYPES) {
      const cfg = tuning.disaster.types[dtype];

      let prob = cfg.baseProb;
      if (densityRatio > tuning.disaster.densityThreshold) {
        prob += tuning.disaster.densityProbScale * (densityRatio - tuning.disaster.densityThreshold) * cfg.densityWeight;
      }
      prob += cfg.terrainDangerWeight * (avgTD / 5) * 0.01;
      prob += cfg.spiritualEnergyWeight * (avgSE / 5) * 0.01;

      if (prng() >= prob) continue;

      const lossRatio = cfg.popLossMin + prng() * (cfg.popLossMax - cfg.popLossMin);
      let totalLost = 0;

      for (const h of households.allHouseholds()) {
        if (h.settlementId !== s.id) continue;
        const loss = Math.min(h.population - 1, Math.floor(h.population * lossRatio));
        if (loss <= 0) continue;
        h.population -= loss;
        totalLost += loss;
      }

      if (totalLost > 0) {
        households.recountSettlementPopulation(s.id);
      }

      const actualRatio = totalPop > 0 ? totalLost / totalPop : 0;
      if (totalLost > 0 && actualRatio >= tuning.disaster.eventRecordThreshold) {
        results.push({
          type: dtype,
          settlementId: s.id,
          settlementName: s.name,
          populationBefore: totalPop,
          populationLost: totalLost,
          lossRatio: actualRatio,
          originCellIdx: s.cells[0],
        });
      }

      // One disaster per settlement per year
      break;
    }
  }

  return results;
}
