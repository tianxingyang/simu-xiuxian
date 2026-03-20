import { describe, expect, it } from 'vitest';
import { LV7_MAX_AGE, SUSTAINABLE_MAX_AGE } from '../src/constants';
import { SimulationEngine, tryBreakthrough } from '../src/engine/simulation';

describe('Lifespan cap', () => {
  it('caps Lv7 maxAge at 100000 years', () => {
    const engine = new SimulationEngine(1, 0);
    engine.spawnCultivators(1);
    engine.prng = () => 0;

    const cultivator = engine.cultivators[0];
    cultivator.age = 10;
    cultivator.cultivation = Number.MAX_SAFE_INTEGER;

    while (cultivator.level < SUSTAINABLE_MAX_AGE.length - 1) {
      const promoted = tryBreakthrough(engine, cultivator, null, 'natural');
      expect(promoted).toBe(true);
      expect(cultivator.maxAge).toBeLessThanOrEqual(LV7_MAX_AGE);
    }

    expect(cultivator.level).toBe(7);
    expect(cultivator.maxAge).toBe(LV7_MAX_AGE);
  });
});
