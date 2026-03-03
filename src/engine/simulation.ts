import type { Cultivator, LevelStat, SimEvent, YearSummary } from '../types';
import { COURAGE_MEAN, COURAGE_STDDEV, INJURY_GROWTH_RATE, LEVEL_COUNT, LEVEL_NAMES, LIGHT_INJURY_GROWTH_RATE, LIFESPAN_DECAY_RATE, MORTAL_MAX_AGE, SUSTAINABLE_MAX_AGE, YEARLY_NEW, effectiveCourage, lifespanBonus, round1, round2, threshold } from '../constants';
import { processEncounters } from './combat';
import { createPRNG, truncatedGaussian } from './prng';
import { profiler } from './profiler';

const MAX_LEVEL = LEVEL_COUNT - 1;

export class SimulationEngine {
  cultivators: Cultivator[] = [];
  levelGroups: Set<number>[];
  aliveLevelIds: Set<number>[];
  nextId = 0;
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
  levelArrayCache: number[][];
  private _levelCountsBuf = new Array<number>(LEVEL_COUNT).fill(0);
  _highBuf: number[] = [];
  _lowBuf: number[] = [];
  _snapshotNk = new Array<number>(LEVEL_COUNT).fill(0);
  freeSlots: number[] = [];
  aliveCount = 0;
  _deadIds: number[] = [];
  private _ageBuffers: number[][] = [];
  private _courageBuffers: number[][] = [];

  constructor(seed: number, initialPopCount: number) {
    this.prng = createPRNG(seed);
    this.yearlySpawn = YEARLY_NEW;
    this.levelGroups = initLevelGroups();
    this.aliveLevelIds = initLevelGroups();
    this.levelArrayCache = initLevelArrayCache();
    this._ageBuffers = initBuffers();
    this._courageBuffers = initBuffers();
    this.spawnCultivators(initialPopCount);
  }

  spawnCultivators(count: number): void {
    for (let i = 0; i < count; i++) {
      const courage = round2(truncatedGaussian(this.prng, COURAGE_MEAN, COURAGE_STDDEV, 0.01, 1.00));
      let id: number;
      if (this.freeSlots.length > 0) {
        id = this.freeSlots[this.freeSlots.length - 1];
        this.freeSlots.length--;
        const c = this.cultivators[id];
        c.id = id;
        c.age = 10;
        c.cultivation = 0;
        c.level = 0;
        (c as { courage: number }).courage = courage;
        c.maxAge = MORTAL_MAX_AGE;
        c.injuredUntil = 0;
        c.lightInjuryUntil = 0;
        c.meridianDamagedUntil = 0;
        c.alive = true;
      } else {
        id = this.nextId++;
        this.cultivators[id] = { id, age: 10, cultivation: 0, level: 0, courage, maxAge: MORTAL_MAX_AGE, injuredUntil: 0, lightInjuryUntil: 0, meridianDamagedUntil: 0, alive: true };
      }
      this.aliveCount++;
      this.levelGroups[0].add(id);
      this.aliveLevelIds[0].add(id);
    }
    this.spawned += count;
  }

  tickCultivators(events?: SimEvent[]): void {
    profiler.start('tickCultivators');
    for (let i = 0; i < this.nextId; i++) {
      const c = this.cultivators[i];
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

      const prev = c.level;
      while (c.level < MAX_LEVEL && c.cultivation >= threshold(c.level + 1)) {
        c.level++;
        if (c.level === 1) c.maxAge = 100;
        else c.maxAge += lifespanBonus(c.level);
        this.promotionCounts[c.level]++;
      }
      if (c.level !== prev) {
        this.levelGroups[prev].delete(c.id);
        this.levelGroups[c.level].add(c.id);
        this.aliveLevelIds[prev].delete(c.id);
        this.aliveLevelIds[c.level].add(c.id);
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

      if (c.age >= c.maxAge) {
        c.alive = false;
        this.expiryDeaths++;
        this.aliveCount--;
        this._deadIds.push(c.id);
        this.levelGroups[c.level].delete(c.id);
        this.aliveLevelIds[c.level].delete(c.id);
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
    profiler.end('tickCultivators');
  }

  purgeDead(): void {
    const deadIds = this._deadIds;
    const freeSlots = this.freeSlots;
    for (let i = 0; i < deadIds.length; i++) {
      freeSlots.push(deadIds[i]);
    }
    deadIds.length = 0;
  }

  getSummary(): YearSummary {
    profiler.start('getSummary');
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

    profiler.start('getSummary.iterate');
    let total = 0, highLevel = 0, highCult = 0;
    for (let i = 0; i < this.nextId; i++) {
      const c = this.cultivators[i];
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
    profiler.end('getSummary.iterate');

    profiler.start('getSummary.median');
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
    profiler.end('getSummary.median');

    profiler.end('getSummary');
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
    profiler.start('tickYear');
    this.resetYearCounters();
    this.spawnCultivators(this.yearlySpawn);
    const events = collectEvents ? [] : ([] as SimEvent[]);
    this.tickCultivators(collectEvents ? events : undefined);
    const combatEvents = processEncounters(this, collectEvents);
    if (collectEvents) events.push(...combatEvents);
    this.purgeDead();
    const isExtinct = this.aliveCount === 0;
    this._summaryYear = this.year;
    this.year++;
    profiler.end('tickYear');
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
    this._deadIds.length = 0;
  }

  reset(seed: number, initialPop: number): void {
    this.cultivators.length = 0;
    this.freeSlots.length = 0;
    this._deadIds.length = 0;
    this.nextId = 0;
    this.aliveCount = 0;
    this.levelGroups = initLevelGroups();
    this.aliveLevelIds = initLevelGroups();
    this.levelArrayCache = initLevelArrayCache();
    this.aliveIds.length = 0;
    this._highBuf.length = 0;
    this._lowBuf.length = 0;
    this._ageBuffers = initBuffers();
    this._courageBuffers = initBuffers();
    this.nextEventId = 1;
    this.year = 1;
    this._summaryYear = 1;
    this.prng = createPRNG(seed);
    this.yearlySpawn = YEARLY_NEW;
    this.resetYearCounters();
    this.spawnCultivators(initialPop);
  }
}

function initLevelGroups(): Set<number>[] {
  const a: Set<number>[] = new Array(LEVEL_COUNT);
  for (let i = 0; i < LEVEL_COUNT; i++) a[i] = new Set();
  return a;
}

function median(arr: number[]): number {
  arr.sort((a, b) => a - b);
  const mid = arr.length >> 1;
  return arr.length & 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function initBuffers(): number[][] {
  return Array.from({ length: LEVEL_COUNT }, () => []);
}

function initLevelArrayCache(): number[][] {
  const a: number[][] = new Array(LEVEL_COUNT);
  for (let i = 0; i < LEVEL_COUNT; i++) a[i] = [];
  return a;
}
