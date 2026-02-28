import type { Cultivator, SimEvent, YearSummary } from '../types';
import { LEVEL_COUNT, LEVEL_NAMES, MORTAL_MAX_AGE, YEARLY_NEW, lifespanBonus, threshold } from '../constants';
import { processEncounters } from './combat';
import { createPRNG } from './prng';

const MAX_LEVEL = LEVEL_COUNT - 1;

export class SimulationEngine {
  cultivators = new Map<number, Cultivator>();
  levelGroups: Map<number, Set<number>>;
  nextId = 1;
  nextEventId = 1;
  year = 1;
  private _summaryYear = 1;
  prng: () => number;
  yearlySpawn: number;

  combatDeaths = 0;
  expiryDeaths = 0;
  promotionCounts = new Array<number>(LEVEL_COUNT).fill(0);
  spawned = 0;

  aliveIds: number[] = [];
  levelArrayCache: Map<number, number[]>;
  private _levelCountsBuf = new Array<number>(LEVEL_COUNT).fill(0);
  _highBuf: number[] = [];
  _lowBuf: number[] = [];
  _snapshotNk = new Array<number>(LEVEL_COUNT).fill(0);
  private _pool: Cultivator[] = [];

  constructor(seed: number, initialPopCount: number) {
    this.prng = createPRNG(seed);
    this.yearlySpawn = YEARLY_NEW;
    this.levelGroups = initLevelGroups();
    this.levelArrayCache = initLevelArrayCache();
    this.spawnCultivators(initialPopCount);
  }

  spawnCultivators(count: number): void {
    const pool = this._pool;
    for (let i = 0; i < count; i++) {
      const id = this.nextId++;
      let c: Cultivator;
      if (pool.length > 0) {
        c = pool[pool.length - 1];
        pool.length--;
        c.id = id;
        c.age = 10;
        c.cultivation = 0;
        c.level = 0;
        (c as { courage: number }).courage = this.prng();
        c.maxAge = MORTAL_MAX_AGE;
        c.alive = true;
      } else {
        c = { id, age: 10, cultivation: 0, level: 0, courage: this.prng(), maxAge: MORTAL_MAX_AGE, alive: true };
      }
      this.cultivators.set(id, c);
      this.levelGroups.get(0)!.add(id);
    }
    this.spawned += count;
  }

  naturalCultivation(): void {
    for (const c of this.cultivators.values()) {
      if (!c.alive) continue;
      c.cultivation += 1;
      c.age += 1;
    }
  }

  checkPromotions(events?: SimEvent[]): void {
    for (const c of this.cultivators.values()) {
      if (!c.alive) continue;
      const prev = c.level;
      while (c.level < MAX_LEVEL && c.cultivation >= threshold(c.level + 1)) {
        c.level++;
        if (c.level === 1) c.maxAge = 100;
        else c.maxAge += lifespanBonus(c.level);
        this.promotionCounts[c.level]++;
      }
      if (c.level !== prev) {
        this.levelGroups.get(prev)!.delete(c.id);
        this.levelGroups.get(c.level)!.add(c.id);
        if (events && c.level >= 3) {
          events.push({
            id: this.nextEventId++,
            year: this.year,
            type: 'promotion',
            actorLevel: c.level,
            detail: `${LEVEL_NAMES[prev]}→${LEVEL_NAMES[c.level]}（自然晋升）`,
          });
        }
      }
    }
  }

  removeExpired(events?: SimEvent[]): void {
    for (const c of this.cultivators.values()) {
      if (!c.alive || c.age < c.maxAge) continue;
      c.alive = false;
      this.expiryDeaths++;
      this.levelGroups.get(c.level)!.delete(c.id);
      if (events && c.level >= 3) {
        events.push({
          id: this.nextEventId++,
          year: this.year,
          type: 'expiry',
          actorLevel: c.level,
          detail: `${LEVEL_NAMES[c.level]}寿元耗尽`,
        });
      }
    }
  }

  purgeDead(): void {
    const pool = this._pool;
    for (const [id, c] of this.cultivators) {
      if (!c.alive) {
        this.cultivators.delete(id);
        pool.push(c);
      }
    }
  }

  getSummary(): YearSummary {
    const buf = this._levelCountsBuf;
    buf.fill(0);
    let total = 0, highLevel = 0, highCult = 0;
    for (const c of this.cultivators.values()) {
      if (!c.alive) continue;
      total++;
      buf[c.level]++;
      if (c.level > highLevel) highLevel = c.level;
      if (c.cultivation > highCult) highCult = c.cultivation;
    }
    return {
      year: this._summaryYear,
      totalPopulation: total,
      levelCounts: buf.slice(),
      newCultivators: this.spawned,
      deaths: this.combatDeaths + this.expiryDeaths,
      combatDeaths: this.combatDeaths,
      expiryDeaths: this.expiryDeaths,
      promotions: [...this.promotionCounts],
      highestLevel: highLevel,
      highestCultivation: highCult,
    };
  }

  tickYear(collectEvents = true): { isExtinct: boolean; events: SimEvent[] } {
    this.resetYearCounters();
    this.spawnCultivators(this.yearlySpawn);
    this.naturalCultivation();
    const events = processEncounters(this, collectEvents);
    if (collectEvents) {
      this.checkPromotions(events);
      this.removeExpired(events);
    } else {
      this.checkPromotions();
      this.removeExpired();
    }
    this.purgeDead();
    const isExtinct = this.cultivators.size === 0;
    this._summaryYear = this.year;
    this.year++;
    return { isExtinct, events };
  }

  resetYearCounters(): void {
    this.combatDeaths = 0;
    this.expiryDeaths = 0;
    this.promotionCounts.fill(0);
    this.spawned = 0;
  }

  reset(seed: number, initialPop: number): void {
    this.cultivators.clear();
    this.levelGroups = initLevelGroups();
    this.levelArrayCache = initLevelArrayCache();
    this.aliveIds.length = 0;
    this._highBuf.length = 0;
    this._lowBuf.length = 0;
    this._pool.length = 0;
    this.nextId = 1;
    this.nextEventId = 1;
    this.year = 1;
    this._summaryYear = 1;
    this.prng = createPRNG(seed);
    this.yearlySpawn = YEARLY_NEW;
    this.resetYearCounters();
    this.spawnCultivators(initialPop);
  }
}

function initLevelGroups(): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (let i = 0; i < LEVEL_COUNT; i++) m.set(i, new Set());
  return m;
}

function initLevelArrayCache(): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (let i = 0; i < LEVEL_COUNT; i++) m.set(i, []);
  return m;
}
