import { describe, expect, it } from 'vitest';
import { threshold } from '../src/constants';
import { SimulationEngine, tryBreakthrough } from '../src/engine/simulation';

describe('Milestone buffering', () => {
  it('keeps promotion milestone state even when events are skipped', () => {
    const engine = new SimulationEngine(42, 0);
    engine.spawnCultivators(2);
    engine.prng = () => 0;

    for (const cultivator of engine.cultivators) {
      engine.levelGroups[0].delete(cultivator.id);
      cultivator.level = 1;
      cultivator.cultivation = threshold(2);
      cultivator.maxAge = 150;
      cultivator.breakthroughCooldownUntil = 0;
      cultivator.injuredUntil = 0;
      engine.levelGroups[1].add(cultivator.id);
    }

    const [first, second] = engine.cultivators;
    expect(tryBreakthrough(engine, first, null, 'natural')).toBe(true);
    expect(engine.milestones.levelEverPopulated[2]).toBe(true);
    expect(engine.milestones.highestLevelEverReached).toBe(2);

    const events = [] as Parameters<typeof tryBreakthrough>[2] extends infer T
      ? Exclude<T, null>
      : never;
    expect(tryBreakthrough(engine, second, events, 'natural')).toBe(true);

    expect(events.filter(event => event.type === 'milestone')).toHaveLength(0);
    expect(events.filter(event => event.type === 'promotion')).toHaveLength(1);
  });
});
