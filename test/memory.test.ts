import { describe, it, expect } from 'vitest';
import {
  createEmptyMemory, resetMemory,
  pushEncounter, pushPlace, findEncounter, countEncountersWith, findPlaceByType,
  serializeMemory, deserializeMemory,
  ENCOUNTER_WIN, ENCOUNTER_LOSS, ENCOUNTER_KIN_KILLED,
  PLACE_DANGER, PLACE_BREAKTHROUGH,
  ENCOUNTER_BUFFER_SIZE, PLACE_BUFFER_SIZE,
  MEMORY_SERIALIZE_BYTES,
  incrementStat,
  tickEmotionalDecay, tickRootedness,
  onCombatWin, onCombatLoss, onBreakthroughSuccess, onBreakthroughFail,
} from '../src/engine/memory';
import { DEFAULT_SIM_TUNING } from '../src/sim-tuning';
import type { Cultivator } from '../src/types';
import { SimulationEngine } from '../src/engine/simulation';

function makeCultivator(overrides: Partial<Cultivator> = {}): Cultivator {
  return {
    id: 0, age: 20, cultivation: 100, level: 1, courage: 0.5,
    maxAge: 150, injuredUntil: 0, lightInjuryUntil: 0,
    meridianDamagedUntil: 0, breakthroughCooldownUntil: 0,
    alive: true, cachedCourage: 0.5, reachedMaxLevelAt: 0,
    x: 5, y: 5, behaviorState: 'wandering', settlingUntil: 0,
    originSettlementId: 1, originHouseholdId: 1,
    ...overrides,
  };
}

describe('CharacterMemory', () => {
  describe('createEmptyMemory', () => {
    it('initializes confidence to courage baseline', () => {
      const c = makeCultivator({ courage: 0.7 });
      const mem = createEmptyMemory(c);
      expect(mem.confidence).toBe(0.7);
      expect(mem.ambition).toBe(0.5);
      expect(mem.caution).toBe(0);
      expect(mem.bloodlust).toBe(0);
      expect(mem.rootedness).toBe(0);
      expect(mem.breakthroughFear).toBe(0);
    });

    it('has empty encounter buffer', () => {
      const mem = createEmptyMemory(makeCultivator());
      expect(mem.encounters).toHaveLength(ENCOUNTER_BUFFER_SIZE);
      for (const e of mem.encounters) {
        expect(e.opponentId).toBe(-1);
      }
    });

    it('has empty place buffer', () => {
      const mem = createEmptyMemory(makeCultivator());
      expect(mem.places).toHaveLength(PLACE_BUFFER_SIZE);
      for (const p of mem.places) {
        expect(p.cellIdx).toBe(-1);
      }
    });
  });

  describe('resetMemory', () => {
    it('resets all fields to defaults', () => {
      const c = makeCultivator({ courage: 0.3 });
      const mem = createEmptyMemory(c);
      mem.confidence = 0.9;
      mem.combatWins = 42;
      pushEncounter(mem, 99, ENCOUNTER_WIN, 100);
      pushPlace(mem, 500, PLACE_DANGER, 100);
      mem.milestones.firstCombatYear = 50;

      resetMemory(mem, c);
      expect(mem.confidence).toBe(0.3);
      expect(mem.combatWins).toBe(0);
      expect(mem.encounters[0].opponentId).toBe(-1);
      expect(mem.places[0].cellIdx).toBe(-1);
      expect(mem.milestones.firstCombatYear).toBe(0);
    });
  });

  describe('encounter ring buffer', () => {
    it('pushes and finds encounters', () => {
      const mem = createEmptyMemory(makeCultivator());
      pushEncounter(mem, 10, ENCOUNTER_WIN, 50);
      pushEncounter(mem, 20, ENCOUNTER_LOSS, 55);

      expect(findEncounter(mem, 10)?.outcome).toBe(ENCOUNTER_WIN);
      expect(findEncounter(mem, 20)?.outcome).toBe(ENCOUNTER_LOSS);
      expect(findEncounter(mem, 99)).toBeNull();
    });

    it('overwrites oldest entry when full', () => {
      const mem = createEmptyMemory(makeCultivator());
      for (let i = 0; i < ENCOUNTER_BUFFER_SIZE; i++) {
        pushEncounter(mem, i, ENCOUNTER_WIN, 100 + i);
      }
      // Push one more, overwriting id=0
      pushEncounter(mem, 99, ENCOUNTER_LOSS, 200);
      expect(findEncounter(mem, 0)).toBeNull();
      expect(findEncounter(mem, 99)?.outcome).toBe(ENCOUNTER_LOSS);
    });

    it('counts encounters with opponent', () => {
      const mem = createEmptyMemory(makeCultivator());
      pushEncounter(mem, 5, ENCOUNTER_WIN, 10);
      pushEncounter(mem, 5, ENCOUNTER_LOSS, 20);
      pushEncounter(mem, 5, ENCOUNTER_WIN, 30);
      pushEncounter(mem, 7, ENCOUNTER_WIN, 40);

      const counts = countEncountersWith(mem, 5);
      expect(counts.total).toBe(3);
      expect(counts.wins).toBe(2);
      expect(counts.losses).toBe(1);
    });

    it('records kin_killed encounters', () => {
      const mem = createEmptyMemory(makeCultivator());
      pushEncounter(mem, 42, ENCOUNTER_KIN_KILLED, 100);
      const e = findEncounter(mem, 42);
      expect(e?.outcome).toBe(ENCOUNTER_KIN_KILLED);
    });
  });

  describe('place ring buffer', () => {
    it('pushes and finds by type', () => {
      const mem = createEmptyMemory(makeCultivator());
      pushPlace(mem, 100, PLACE_DANGER, 50);
      pushPlace(mem, 200, PLACE_BREAKTHROUGH, 60);

      expect(findPlaceByType(mem, PLACE_DANGER)?.cellIdx).toBe(100);
      expect(findPlaceByType(mem, PLACE_BREAKTHROUGH)?.cellIdx).toBe(200);
    });

    it('returns most recent of same type', () => {
      const mem = createEmptyMemory(makeCultivator());
      pushPlace(mem, 100, PLACE_DANGER, 50);
      pushPlace(mem, 200, PLACE_DANGER, 60);
      expect(findPlaceByType(mem, PLACE_DANGER)?.cellIdx).toBe(200);
    });
  });

  describe('incrementStat', () => {
    it('increments and clamps to u16 max', () => {
      const mem = createEmptyMemory(makeCultivator());
      incrementStat(mem, 'combatWins');
      expect(mem.combatWins).toBe(1);
      mem.combatWins = 65534;
      incrementStat(mem, 'combatWins');
      expect(mem.combatWins).toBe(65535);
      incrementStat(mem, 'combatWins');
      expect(mem.combatWins).toBe(65535); // clamped
    });
  });

  describe('serialization round-trip', () => {
    it('preserves all memory fields', () => {
      const mem = createEmptyMemory(makeCultivator({ courage: 0.65 }));
      mem.confidence = 0.8;
      mem.caution = 0.3;
      mem.ambition = 0.7;
      mem.bloodlust = 0.15;
      mem.rootedness = 0.4;
      mem.breakthroughFear = 0.25;
      mem.combatWins = 10;
      mem.combatLosses = 3;
      mem.kills = 2;
      mem.breakthroughAttempts = 5;
      mem.breakthroughSuccesses = 2;
      mem.heavyInjuries = 1;
      mem.yearsSettled = 50;
      mem.timesDisplaced = 4;
      pushEncounter(mem, 42, ENCOUNTER_LOSS, 100);
      pushEncounter(mem, 7, ENCOUNTER_WIN, 110);
      pushPlace(mem, 300, PLACE_BREAKTHROUGH, 105);
      pushPlace(mem, 150, PLACE_DANGER, 108);
      mem.milestones.firstCombatYear = 30;
      mem.milestones.firstKillYear = 50;
      mem.milestones.worstDefeatYear = 100;
      mem.milestones.worstDefeatOpponentId = 42;
      mem.milestones.greatestVictoryYear = 110;
      mem.milestones.greatestVictoryOpponentId = 7;

      const buf = new ArrayBuffer(MEMORY_SERIALIZE_BYTES);
      const dv = new DataView(buf);
      serializeMemory(dv, 0, mem);
      const { mem: restored } = deserializeMemory(dv, 0);

      expect(restored.confidence).toBe(0.8);
      expect(restored.caution).toBe(0.3);
      expect(restored.ambition).toBe(0.7);
      expect(restored.bloodlust).toBe(0.15);
      expect(restored.rootedness).toBe(0.4);
      expect(restored.breakthroughFear).toBe(0.25);
      expect(restored.combatWins).toBe(10);
      expect(restored.combatLosses).toBe(3);
      expect(restored.kills).toBe(2);
      expect(restored.breakthroughAttempts).toBe(5);
      expect(restored.breakthroughSuccesses).toBe(2);
      expect(restored.heavyInjuries).toBe(1);
      expect(restored.yearsSettled).toBe(50);
      expect(restored.timesDisplaced).toBe(4);
      expect(findEncounter(restored, 42)?.outcome).toBe(ENCOUNTER_LOSS);
      expect(findEncounter(restored, 7)?.outcome).toBe(ENCOUNTER_WIN);
      expect(findPlaceByType(restored, PLACE_BREAKTHROUGH)?.cellIdx).toBe(300);
      expect(findPlaceByType(restored, PLACE_DANGER)?.cellIdx).toBe(150);
      expect(restored.milestones.firstCombatYear).toBe(30);
      expect(restored.milestones.worstDefeatOpponentId).toBe(42);
      expect(restored.milestones.greatestVictoryOpponentId).toBe(7);
    });

    it('byte size matches constant', () => {
      const mem = createEmptyMemory(makeCultivator());
      const buf = new ArrayBuffer(MEMORY_SERIALIZE_BYTES + 10);
      const dv = new DataView(buf);
      const endOff = serializeMemory(dv, 0, mem);
      expect(endOff).toBe(MEMORY_SERIALIZE_BYTES);
    });
  });

  describe('emotional decay', () => {
    const mt = DEFAULT_SIM_TUNING.memory;

    it('decays confidence toward courage baseline', () => {
      const c = makeCultivator({ courage: 0.5 });
      const mem = createEmptyMemory(c);
      mem.confidence = 0.9;
      tickEmotionalDecay(mem, c, mt);
      // 0.5 + (0.9 - 0.5) * 0.95 = 0.5 + 0.38 = 0.88
      expect(mem.confidence).toBeCloseTo(0.88, 2);
      // After many ticks, should converge to baseline
      for (let i = 0; i < 100; i++) tickEmotionalDecay(mem, c, mt);
      expect(mem.confidence).toBeCloseTo(0.5, 1);
    });

    it('decays caution toward 0', () => {
      const c = makeCultivator();
      const mem = createEmptyMemory(c);
      mem.caution = 0.8;
      for (let i = 0; i < 50; i++) tickEmotionalDecay(mem, c, mt);
      expect(mem.caution).toBeLessThan(0.1);
    });

    it('decays ambition toward 0.5', () => {
      const c = makeCultivator();
      const mem = createEmptyMemory(c);
      mem.ambition = 1.0;
      for (let i = 0; i < 50; i++) tickEmotionalDecay(mem, c, mt);
      expect(mem.ambition).toBeCloseTo(0.5, 1);
    });
  });

  describe('rootedness tick', () => {
    const mt = DEFAULT_SIM_TUNING.memory;

    it('increases while settling', () => {
      const mem = createEmptyMemory(makeCultivator());
      expect(mem.rootedness).toBe(0);
      tickRootedness(mem, true, mt);
      expect(mem.rootedness).toBe(mt.rootednessSettlingDelta);
      expect(mem.yearsSettled).toBe(1);
    });

    it('does not change when not settling', () => {
      const mem = createEmptyMemory(makeCultivator());
      tickRootedness(mem, false, mt);
      expect(mem.rootedness).toBe(0);
      expect(mem.yearsSettled).toBe(0);
    });
  });

  describe('combat event updates', () => {
    const mt = DEFAULT_SIM_TUNING.memory;

    it('onCombatWin increases confidence and tracks stats', () => {
      const mem = createEmptyMemory(makeCultivator());
      const baseline = mem.confidence;
      onCombatWin(mem, 10, false, 100, mt);
      expect(mem.confidence).toBeGreaterThan(baseline);
      expect(mem.combatWins).toBe(1);
      expect(mem.kills).toBe(0);
      expect(mem.milestones.firstCombatYear).toBe(100);
    });

    it('onCombatWin with kill tracks kills', () => {
      const mem = createEmptyMemory(makeCultivator());
      onCombatWin(mem, 10, true, 100, mt);
      expect(mem.kills).toBe(1);
      expect(mem.milestones.firstKillYear).toBe(100);
      expect(mem.bloodlust).toBeGreaterThan(0);
    });

    it('onCombatLoss decreases confidence and increases caution on injury', () => {
      const mem = createEmptyMemory(makeCultivator());
      const baseline = mem.confidence;
      onCombatLoss(mem, 20, 100, true, false, mt);
      expect(mem.confidence).toBeLessThan(baseline);
      expect(mem.caution).toBeGreaterThan(0);
      expect(mem.combatLosses).toBe(1);
      expect(mem.heavyInjuries).toBe(1);
      expect(mem.milestones.firstInjuryYear).toBe(100);
    });
  });

  describe('breakthrough event updates', () => {
    const mt = DEFAULT_SIM_TUNING.memory;

    it('onBreakthroughSuccess clears fear and records place', () => {
      const mem = createEmptyMemory(makeCultivator());
      mem.breakthroughFear = 0.5;
      onBreakthroughSuccess(mem, 300, 100, mt);
      expect(mem.breakthroughFear).toBe(0);
      expect(mem.ambition).toBeGreaterThan(0.5);
      expect(mem.breakthroughSuccesses).toBe(1);
      expect(mem.milestones.firstBreakthroughYear).toBe(100);
      expect(findPlaceByType(mem, PLACE_BREAKTHROUGH)?.cellIdx).toBe(300);
    });

    it('onBreakthroughFail increases fear, high courage boosts ambition', () => {
      const mem = createEmptyMemory(makeCultivator({ courage: 0.8 }));
      onBreakthroughFail(mem, 0.8, false, 100, mt);
      expect(mem.breakthroughFear).toBeGreaterThan(0);
      expect(mem.ambition).toBeGreaterThan(0.5); // high courage → ambition up
    });

    it('onBreakthroughFail low courage reduces ambition', () => {
      const mem = createEmptyMemory(makeCultivator({ courage: 0.2 }));
      onBreakthroughFail(mem, 0.2, false, 100, mt);
      expect(mem.breakthroughFear).toBeGreaterThan(0);
      expect(mem.ambition).toBeLessThan(0.5); // low courage → ambition down
    });
  });

  describe('engine integration', () => {
    it('spawns cultivators with memory', () => {
      const engine = new SimulationEngine(42, 200);
      // Run a few years to get some cultivators
      for (let i = 0; i < 20; i++) engine.tickYear(false);
      expect(engine.memories.length).toBeGreaterThan(0);
      for (let i = 0; i < engine.nextId; i++) {
        const mem = engine.memories[i];
        expect(mem).toBeDefined();
        expect(mem.encounters).toHaveLength(ENCOUNTER_BUFFER_SIZE);
      }
    });

    it('memories evolve after running simulation', () => {
      const engine = new SimulationEngine(42, 200);
      for (let i = 0; i < 200; i++) engine.tickYear(false);

      // After 200 years with combat and breakthroughs, some memories should be non-default
      let hasNonDefaultConfidence = false;
      let hasCombatWins = false;
      let hasBreakthroughAttempts = false;
      for (let i = 0; i < engine.nextId; i++) {
        if (!engine.cultivators[i].alive) continue;
        const mem = engine.memories[i];
        if (Math.abs(mem.confidence - engine.cultivators[i].courage) > 0.01) hasNonDefaultConfidence = true;
        if (mem.combatWins > 0) hasCombatWins = true;
        if (mem.breakthroughAttempts > 0) hasBreakthroughAttempts = true;
      }
      expect(hasNonDefaultConfidence).toBe(true);
      expect(hasCombatWins).toBe(true);
      expect(hasBreakthroughAttempts).toBe(true);
    });

    it('serialize/deserialize round-trip preserves memories', () => {
      const engine = new SimulationEngine(42, 200);
      for (let i = 0; i < 30; i++) engine.tickYear(false);

      // Mutate some memories
      if (engine.nextId > 0) {
        const mem = engine.memories[0];
        mem.confidence = 0.99;
        pushEncounter(mem, 5, ENCOUNTER_WIN, engine.year);
      }

      const buf = engine.serialize();
      const restored = SimulationEngine.deserialize(buf);

      expect(restored.memories.length).toBe(engine.memories.length);
      if (engine.nextId > 0) {
        expect(restored.memories[0].confidence).toBe(0.99);
        expect(findEncounter(restored.memories[0], 5)?.outcome).toBe(ENCOUNTER_WIN);
      }
    });
  });
});
