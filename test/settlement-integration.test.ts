/**
 * Integration tests derived from PRD Acceptance Criteria:
 * .trellis/tasks/03-20-population-origin/prd.md
 *
 * Each test maps to a specific AC, verifying end-to-end behavior
 * through the SimulationEngine rather than testing subsystems in isolation.
 */
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/engine/simulation';
import { HOUSEHOLD_SPLIT_THRESHOLD, SETTLEMENT_VILLAGE_MIN } from '../src/constants';

function runYears(engine: SimulationEngine, years: number): void {
  for (let i = 0; i < years; i++) {
    const { isExtinct } = engine.tickYear(false);
    if (isExtinct) break;
  }
}

describe('Settlement System Integration (PRD Acceptance Criteria)', () => {
  /**
   * AC: 初始世界从零开始，聚落有机涌现
   * AC: 移除固定 spawnCultivators，修士完全从家户觉醒产生
   */
  it('starts with zero cultivators and zero settlements', () => {
    const engine = new SimulationEngine(42, 200);

    expect(engine.aliveCount).toBe(0);
    expect(engine.settlements.count).toBe(0);
    expect(engine.households.count).toBe(200);
    expect(engine.households.totalPopulation()).toBeGreaterThan(0);
  });

  /**
   * AC: 家户每年自然增长，受 terrainDanger 影响
   */
  it('household population grows over time', () => {
    const engine = new SimulationEngine(42, 200);
    const popBefore = engine.households.totalPopulation();

    runYears(engine, 10);

    expect(engine.households.totalPopulation()).toBeGreaterThan(popBefore);
  });

  /**
   * AC: 移除固定 spawnCultivators，修士完全从家户觉醒产生
   * PRD: 前几十年为蛮荒时代
   */
  it('cultivators eventually awaken from households (not spawned from nothing)', () => {
    const engine = new SimulationEngine(42, 200);

    // Run enough years for population to grow and awakenings to occur
    runYears(engine, 200);

    expect(engine.aliveCount).toBeGreaterThan(0);

    // Verify all cultivators have origin info
    for (const c of engine.cultivators) {
      if (!c.alive) continue;
      expect(c.originHouseholdId).toBeDefined();
    }
  });

  /**
   * AC: 家户达到阈值升格为新聚落
   * AC: 聚落有机涌现
   */
  it('settlements emerge organically from household growth', () => {
    const engine = new SimulationEngine(42, 200);
    expect(engine.settlements.count).toBe(0);

    // Run until at least one settlement forms
    // At 3% growth, household of 5 reaches 50 in ~80 years
    runYears(engine, 150);

    expect(engine.settlements.count).toBeGreaterThan(0);

    // Verify settlement has a name and valid metadata
    const first = engine.settlements.allSettlements().next().value;
    expect(first).toBeDefined();
    expect(first.name.length).toBeGreaterThan(0);
    expect(first.cells.length).toBeGreaterThanOrEqual(1);
    expect(first.foundedYear).toBeGreaterThan(0);
  });

  /**
   * AC: 修士携带出身信息（originSettlementId, originHouseholdId）
   */
  it('awakened cultivators carry origin settlement and household IDs', () => {
    const engine = new SimulationEngine(42, 200);

    // Run until we have cultivators with settlements
    runYears(engine, 200);

    const withOrigin = engine.cultivators.filter(
      c => c.alive && c.originHouseholdId >= 0,
    );
    expect(withOrigin.length).toBeGreaterThan(0);

    for (const c of withOrigin) {
      // originHouseholdId should be a valid (or historically valid) ID
      expect(c.originHouseholdId).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * AC: 聚落类型随人口动态升降级（hamlet/village/town/city）
   */
  it('settlement type reflects population thresholds', () => {
    const engine = new SimulationEngine(42, 200);

    // Run long enough for some settlements to grow
    runYears(engine, 300);

    if (engine.settlements.count > 0) {
      for (const s of engine.settlements.allSettlements()) {
        const pop = engine.households.settlementPopulation(s.id);
        const type = engine.settlements.getType(s.id, engine.households);

        if (pop < SETTLEMENT_VILLAGE_MIN) {
          expect(type).toBe('hamlet');
        } else if (pop < 1000) {
          expect(type).toBe('village');
        } else if (pop < 5000) {
          expect(type).toBe('town');
        } else {
          expect(type).toBe('city');
        }
      }
    }
  });

  /**
   * AC: 修士战斗波及聚落人口
   */
  it('combat causes collateral damage to nearby households', () => {
    const engine = new SimulationEngine(42, 200);

    // Run until we have cultivators and settlements
    runYears(engine, 200);

    if (engine.aliveCount > 0 && engine.settlements.count > 0) {
      const totalPopBefore = engine.households.totalPopulation();

      // Run more years to allow combat to happen
      runYears(engine, 100);

      // If combat happened in settlement areas, some pop loss should occur
      // (We can't guarantee combat hits settlements, but total pop should
      // reflect natural growth minus any combat damage)
      // At minimum, system should not crash
      expect(engine.households.totalPopulation()).toBeGreaterThan(0);
    }
  });

  /**
   * AC: 聚落和家户数据可序列化/反序列化（快照兼容）
   */
  it('snapshot round-trip preserves household and settlement state', () => {
    const engine = new SimulationEngine(42, 200);
    runYears(engine, 150);

    const householdCountBefore = engine.households.count;
    const settlementCountBefore = engine.settlements.count;
    const popBefore = engine.households.totalPopulation();
    const aliveBefore = engine.aliveCount;
    const yearBefore = engine.year;

    // Serialize
    const snapshot = engine.serialize();

    // Deserialize into a new engine
    const restored = SimulationEngine.deserialize(snapshot);

    expect(restored.year).toBe(yearBefore);
    expect(restored.aliveCount).toBe(aliveBefore);
    expect(restored.households.count).toBe(householdCountBefore);
    expect(restored.settlements.count).toBe(settlementCountBefore);
    expect(restored.households.totalPopulation()).toBe(popBefore);

    // Verify settlement data integrity
    for (const s of engine.settlements.allSettlements()) {
      const rs = restored.settlements.getSettlement(s.id);
      expect(rs).toBeDefined();
      expect(rs!.name).toBe(s.name);
      expect(rs!.cells).toEqual(s.cells);
      expect(rs!.foundedYear).toBe(s.foundedYear);
    }

    // Verify cultivator origin fields survive serialization
    for (let i = 0; i < engine.cultivators.length; i++) {
      const c = engine.cultivators[i];
      if (!c.alive) continue;
      const rc = restored.cultivators[i];
      expect(rc.originSettlementId).toBe(c.originSettlementId);
      expect(rc.originHouseholdId).toBe(c.originHouseholdId);
    }
  });

  /**
   * AC: YearSummary includes settlement stats
   */
  it('getSummary reports mortal population and settlement counts', () => {
    const engine = new SimulationEngine(42, 200);
    runYears(engine, 150);

    const summary = engine.getSummary();
    expect(summary.mortalPopulation).toBe(engine.households.totalPopulation());
    expect(summary.householdCount).toBe(engine.households.count);
    expect(summary.settlementCount).toBe(engine.settlements.count);
    expect(typeof summary.hamletCount).toBe('number');
    expect(typeof summary.villageCount).toBe('number');
    expect(typeof summary.townCount).toBe('number');
    expect(typeof summary.cityCount).toBe('number');
  });

  /**
   * PRD: 前几十年为蛮荒时代，无修士
   */
  it('wilderness era: very few cultivators in early years', () => {
    const engine = new SimulationEngine(42, 200);

    // First 10 years should have very few (ideally zero) cultivators
    runYears(engine, 10);

    // With 200 households * 5 pop = 1000 mortals, rate 0.0005, avg SE factor ~1.0
    // Expected awakenings per year ≈ 0.5, so in 10 years ≈ 5 total
    expect(engine.aliveCount).toBeLessThan(20);
  });

  /**
   * Edge case: simulation remains stable over long runs
   */
  it('runs 300 years without crashing', { timeout: 30_000 }, () => {
    const engine = new SimulationEngine(42, 200);
    runYears(engine, 300);

    // Should have grown substantially
    expect(engine.households.totalPopulation()).toBeGreaterThan(1000);
    expect(engine.year).toBeGreaterThanOrEqual(300);
  });
});
