import type { Cultivator, LevelStat, SimEvent, YearSummary } from '../types';
import { COURAGE_MEAN, COURAGE_STDDEV, INJURY_GROWTH_RATE, LEVEL_COUNT, LEVEL_NAMES, LIGHT_INJURY_GROWTH_RATE, LIFESPAN_DECAY_RATE, MORTAL_MAX_AGE, SUSTAINABLE_MAX_AGE, YEARLY_NEW, effectiveCourage, lifespanBonus, round1, round2, threshold } from '../constants';
import { processEncounters } from './combat';
import { createPRNG, truncatedGaussian } from './prng';

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
  combatDemotions = 0;
  combatInjuries = 0;
  combatCultLosses = 0;
  combatLightInjuries = 0;
  combatMeridianDamages = 0;
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
  private _ageBuffers: number[][] = [];
  private _courageBuffers: number[][] = [];

  constructor(seed: number, initialPopCount: number) {
    this.prng = createPRNG(seed);
    this.yearlySpawn = YEARLY_NEW;
    this.levelGroups = initLevelGroups();
    this.levelArrayCache = initLevelArrayCache();
    this._ageBuffers = initBuffers();
    this._courageBuffers = initBuffers();
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
        (c as { courage: number }).courage = round2(truncatedGaussian(this.prng, COURAGE_MEAN, COURAGE_STDDEV, 0.01, 1.00));
        c.maxAge = MORTAL_MAX_AGE;
        c.injuredUntil = 0;
        c.lightInjuryUntil = 0;
        c.meridianDamagedUntil = 0;
        c.alive = true;
      } else {
        c = { id, age: 10, cultivation: 0, level: 0, courage: round2(truncatedGaussian(this.prng, COURAGE_MEAN, COURAGE_STDDEV, 0.01, 1.00)), maxAge: MORTAL_MAX_AGE, injuredUntil: 0, lightInjuryUntil: 0, meridianDamagedUntil: 0, alive: true };
      }
      this.cultivators.set(id, c);
      this.levelGroups.get(0)!.add(id);
    }
    this.spawned += count;
  }

  naturalCultivation(): void {
    for (const c of this.cultivators.values()) {
      if (!c.alive) continue;
      c.age += 1;
      let growthRate = 1;
      if (c.injuredUntil > this.year) {
        growthRate = INJURY_GROWTH_RATE;
      } else if (c.lightInjuryUntil > this.year) {
        growthRate = LIGHT_INJURY_GROWTH_RATE;
      }
      c.cultivation += growthRate;

      const target = SUSTAINABLE_MAX_AGE[c.level];
      if (c.maxAge > target) {
        c.maxAge = Math.max(MORTAL_MAX_AGE, Math.round(c.maxAge - (c.maxAge - target) * LIFESPAN_DECAY_RATE));
      }
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
    const ageBuf = this._ageBuffers;
    const courBuf = this._courageBuffers;
    const ageSum = new Float64Array(LEVEL_COUNT);
    const courSum = new Float64Array(LEVEL_COUNT);
    for (let i = 0; i < LEVEL_COUNT; i++) {
      ageBuf[i].length = 0;
      courBuf[i].length = 0;
    }

    let total = 0, highLevel = 0, highCult = 0;
    for (const c of this.cultivators.values()) {
      if (!c.alive) continue;
      total++;
      const lv = c.level;
      buf[lv]++;
      ageSum[lv] += c.age;
      courSum[lv] += effectiveCourage(c);
      ageBuf[lv].push(c.age);
      courBuf[lv].push(effectiveCourage(c));
      if (lv > highLevel) highLevel = lv;
      if (c.cultivation > highCult) highCult = c.cultivation;
    }

    const levelStats: LevelStat[] = new Array(LEVEL_COUNT);
    for (let i = 0; i < LEVEL_COUNT; i++) {
      const n = buf[i];
      if (n === 0) {
        levelStats[i] = { ageAvg: 0, ageMedian: 0, courageAvg: 0, courageMedian: 0 };
      } else {
        levelStats[i] = {
          ageAvg: round1(ageSum[i] / n),
          ageMedian: round1(median(ageBuf[i])),
          courageAvg: round2(courSum[i] / n),
          courageMedian: round2(median(courBuf[i])),
        };
      }
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
      combatDemotions: this.combatDemotions,
      combatInjuries: this.combatInjuries,
      combatCultLosses: this.combatCultLosses,
      combatLightInjuries: this.combatLightInjuries,
      combatMeridianDamages: this.combatMeridianDamages,
      levelStats,
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
    this.combatDemotions = 0;
    this.combatInjuries = 0;
    this.combatCultLosses = 0;
    this.combatLightInjuries = 0;
    this.combatMeridianDamages = 0;
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
    this._ageBuffers = initBuffers();
    this._courageBuffers = initBuffers();
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

function median(arr: number[]): number {
  arr.sort((a, b) => a - b);
  const mid = arr.length >> 1;
  return arr.length & 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function initBuffers(): number[][] {
  return Array.from({ length: LEVEL_COUNT }, () => []);
}

function initLevelArrayCache(): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (let i = 0; i < LEVEL_COUNT; i++) m.set(i, []);
  return m;
}
