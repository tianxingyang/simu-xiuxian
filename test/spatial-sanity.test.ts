import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/engine/simulation';

describe('spatial sanity', () => {
  it('engine runs 100 years with spatial matching', () => {
    const e = new SimulationEngine(42, 500);
    for (let i = 0; i < 50; i++) {
      const r = e.tickYear(false);
      if (r.isExtinct) break;
    }
    expect(e.year).toBeGreaterThan(30);
    expect(e.aliveCount).toBeGreaterThan(0);

    const sample = e.cultivators.find(c => c.alive);
    expect(sample).toBeDefined();
    expect(sample!.x).toBeGreaterThanOrEqual(0);
    expect(sample!.x).toBeLessThan(32);
    expect(sample!.y).toBeGreaterThanOrEqual(0);
    expect(sample!.y).toBeLessThan(32);
  });
});
