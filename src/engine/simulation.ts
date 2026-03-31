import type { BehaviorState, Cultivator, EngineHooks, FactionSummary, GuardianInfo, LevelStat, RichBreakthroughEvent, RichDisasterEvent, RichEvent, RichExpiryEvent, RichMilestoneEvent, RichPromotionEvent, RichRelationshipEvent, RichTribulationEvent, YearSummary } from '../types.js';
import { getSimTuning } from '../sim-tuning.js';
import { LEVEL_COUNT, MAP_SIZE, YEARLY_NEW, breakthroughChance, effectiveCourage, getRegionCode, getRegionName, type RegionCode, REGION_NAMES, lifespanBonus, round1, round2, sustainableMaxAge, threshold, tribulationChance } from '../constants/index.js';
import { getBalanceProfile } from '../balance.js';
import { processEncounters, scoreNewsRank } from './combat.js';
import { type PRNG, createPRNG, truncatedGaussian } from './prng.js';
import { profiler } from './profiler.js';
import { SpatialIndex, breakthroughMove, moveCultivators } from './spatial.js';
import { AreaTagSystem } from './area-tag.js';
import { HouseholdSystem } from './household.js';
import { SettlementSystem } from './settlement.js';
import { type DisasterResult, processDisasters } from './disaster.js';
import type { PolicyEngine } from './ai-policy.js';
import { extractState } from './ai-state-extract.js';
import type { RelationshipContext } from './ai-state-extract.js';
import {
  type CharacterMemory, createEmptyMemory, resetMemory,
  serializeMemory, deserializeMemory, deserializeMemoryLegacy, MEMORY_SERIALIZE_BYTES,
  tickEmotionalDecay, tickRootedness,
  onBreakthroughSuccess, onBreakthroughFail,
} from './memory.js';
import {
  type CharacterRelationships, createEmptyRelationships, resetRelationships,
  serializeRelationships, deserializeRelationships, RELATIONSHIP_SERIALIZE_BYTES,
  tickRelationshipDecay, purgeDeadFromRelationships,
  addAlly, removeDisciple, clearMentor,
  findAlly, isFellowDisciple, ALLY_BUFFER_SIZE, MAX_DISCIPLES,
  strongestAllyStrength, maxRivalIntensity, hasAnyVendetta,
} from './relationship.js';
import { processNonCombatEncounters } from './interaction.js';
import { FactionSystem, processFactions } from './faction.js';

const MAX_LEVEL = LEVEL_COUNT - 1;
type EventBuffer = RichEvent[] | null;

const BEHAVIOR_STATE_ENCODE: Readonly<Record<BehaviorState, number>> = {
  wandering: 0, escaping: 1, recuperating: 2, seeking_breakthrough: 3, settling: 4,
};
const BEHAVIOR_STATE_DECODE: readonly BehaviorState[] = [
  'wandering', 'escaping', 'recuperating', 'seeking_breakthrough', 'settling',
];

function encodeBehaviorState(state: BehaviorState): number {
  return BEHAVIOR_STATE_ENCODE[state];
}

function decodeBehaviorState(code: number): BehaviorState {
  return BEHAVIOR_STATE_DECODE[code] ?? 'wandering';
}

export class MilestoneTracker {
  highestLevelEverReached = 0;
  levelEverPopulated: boolean[];

  constructor() {
    this.levelEverPopulated = new Array(LEVEL_COUNT).fill(false);
    this.levelEverPopulated[0] = true;
  }

  checkPromotion(
    level: number, cultivatorId: number,
    cultivatorName: string, year: number,
  ): RichMilestoneEvent | null {
    this.levelEverPopulated[level] = true;
    if (level < 2 || level <= this.highestLevelEverReached) {
      if (level > this.highestLevelEverReached) this.highestLevelEverReached = level;
      return null;
    }
    this.highestLevelEverReached = level;
    return {
      type: 'milestone', year, newsRank: 'S', kind: 'first_at_level',
      detail: { level, cultivatorId, cultivatorName, year },
    };
  }

  recordPromotion(level: number): void {
    this.levelEverPopulated[level] = true;
    if (level > this.highestLevelEverReached) this.highestLevelEverReached = level;
  }

  checkDeath(
    level: number, levelGroupSize: number,
    cultivatorId: number, cultivatorName: string, year: number,
  ): RichMilestoneEvent | null {
    if (level < 2 || !this.levelEverPopulated[level] || levelGroupSize > 0) return null;
    return {
      type: 'milestone', year, newsRank: 'S', kind: 'last_at_level',
      detail: { level, cultivatorId, cultivatorName, year },
    };
  }

  reset(): void {
    this.highestLevelEverReached = 0;
    this.levelEverPopulated.fill(false);
    this.levelEverPopulated[0] = true;
  }
}

export class SimulationEngine {
  cultivators: Cultivator[] = [];
  memories: CharacterMemory[] = [];
  relationships: CharacterRelationships[] = [];
  levelGroups: Set<number>[];
  aliveLevelIds: Set<number>[];
  nextId = 0;
  year = 1;
  private _summaryYear = 1;
  prng: PRNG;
  yearlySpawn: number;

  hooks?: EngineHooks;
  aiPolicy: PolicyEngine | null = null;
  milestones = new MilestoneTracker();
  spatialIndex = new SpatialIndex();
  areaTags = new AreaTagSystem();
  households = new HouseholdSystem();
  settlements = new SettlementSystem();
  factions = new FactionSystem();

  combatDeaths = 0;
  combatDemotions = 0;
  combatInjuries = 0;
  combatCultLosses = 0;
  combatLightInjuries = 0;
  combatMeridianDamages = 0;
  breakthroughAttempts = 0;
  breakthroughSuccesses = 0;
  breakthroughFailures = 0;
  expiryDeaths = 0;
  tribulations = 0;
  ascensions = 0;
  tribulationDeaths = 0;
  promotionCounts = new Array<number>(LEVEL_COUNT).fill(0);
  breakthroughAttemptsByLevel = new Array<number>(LEVEL_COUNT).fill(0);
  expiryDeathsByLevel = new Array<number>(LEVEL_COUNT).fill(0);
  combatDeathsByLevel = new Array<number>(LEVEL_COUNT).fill(0);
  spawned = 0;
  naturalDeaths = 0;
  disasterDeaths = 0;
  disasterCount = 0;

  aliveIds: number[] = [];
  levelArrayCache: number[][];
  private _levelCountsBuf = new Array<number>(LEVEL_COUNT).fill(0);
  _ageSumBuf = new Float64Array(LEVEL_COUNT);
  _courageSumBuf = new Float64Array(LEVEL_COUNT);
  _defeatedBuf = new Uint8Array(0);
  _levelArrayIndex = new Int32Array(0);
  freeSlots: number[] = [];
  aliveCount = 0;
  _deadIds: number[] = [];
  private _ageBuffers: number[][] = [];
  private _courageBuffers: number[][] = [];

  constructor(seed: number, initialPopCount: number) {
    this.prng = createPRNG(seed);
    this.yearlySpawn = YEARLY_NEW;
    this.levelGroups = initLevelGroups();
    this.aliveLevelIds = this.levelGroups;
    this.levelArrayCache = initLevelArrayCache();
    this._ageBuffers = initBuffers();
    this._courageBuffers = initBuffers();
    this.areaTags.generate(seed);
    this.households.generate(seed, this.prng, this.areaTags, initialPopCount);
    // No initial cultivators -- they awaken from households over time
    this._defeatedBuf = new Uint8Array(this.nextId);
    this._levelArrayIndex = new Int32Array(this.nextId);
  }

  spawnCultivator(x: number, y: number, originSettlementId: number, originHouseholdId: number): void {
    const tuning = getSimTuning();
    const courage = round2(truncatedGaussian(this.prng, tuning.courage.mean, tuning.courage.stddev, 0.01, 1.00));
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
      c.maxAge = tuning.lifespan.mortalMaxAge;
      c.injuredUntil = 0;
      c.lightInjuryUntil = 0;
      c.meridianDamagedUntil = 0;
      c.breakthroughCooldownUntil = 0;
      c.alive = true;
      c.cachedCourage = effectiveCourage(c);
      c.reachedMaxLevelAt = 0;
      c.x = x;
      c.y = y;
      c.behaviorState = 'wandering';
      c.settlingUntil = 0;
      c.originSettlementId = originSettlementId;
      c.originHouseholdId = originHouseholdId;
      c.teachingBoostUntil = 0;
      c.teachingBoostRate = 0;
      c.factionId = -1;
      resetMemory(this.memories[id], c);
      resetRelationships(this.relationships[id]);
    } else {
      id = this.nextId++;
      const nc = this.cultivators[id] = {
        id, age: 10, cultivation: 0, level: 0, courage, maxAge: tuning.lifespan.mortalMaxAge,
        injuredUntil: 0, lightInjuryUntil: 0, meridianDamagedUntil: 0,
        breakthroughCooldownUntil: 0, alive: true, cachedCourage: 0,
        reachedMaxLevelAt: 0, x, y,
        behaviorState: 'wandering' as BehaviorState, settlingUntil: 0,
        originSettlementId, originHouseholdId,
        teachingBoostUntil: 0, teachingBoostRate: 0,
        factionId: -1,
      };
      nc.cachedCourage = effectiveCourage(nc);
      this.memories[id] = createEmptyMemory(nc);
      this.relationships[id] = createEmptyRelationships();
    }
    this.aliveCount++;
    this.levelGroups[0].add(id);
    this.spatialIndex.add(id, 0, x, y);
    this.spawned++;
  }

  /** @deprecated Legacy bulk spawn (for backward compat in deserialization) */
  spawnCultivators(count: number): void {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(this.prng() * MAP_SIZE);
      const y = Math.floor(this.prng() * MAP_SIZE);
      this.spawnCultivator(x, y, -1, -1);
    }
  }

  tickCultivators(events: EventBuffer = null): void {
    profiler.start('tickCultivators');
    const tuning = getSimTuning();
    for (let i = 0; i < this.nextId; i++) {
      const c = this.cultivators[i];
      if (!c.alive) continue;

      c.age += 1;
      let growthRate = 1;
      if (c.injuredUntil > this.year) {
        growthRate = tuning.combat.injuryGrowthRate;
      } else if (c.lightInjuryUntil > this.year) {
        growthRate = tuning.combat.lightInjuryGrowthRate;
      }
      if (c.teachingBoostUntil > this.year) {
        growthRate += c.teachingBoostRate;
      } else if (c.teachingBoostRate > 0) {
        c.teachingBoostRate = 0;
      }
      c.cultivation += growthRate;

      // Memory: emotional decay + rootedness
      if (tuning.memory.enabled) {
        const mem = this.memories[i];
        tickEmotionalDecay(mem, c, tuning.memory);
        tickRootedness(mem, c.behaviorState === 'settling', tuning.memory);
      }

      // Relationship: decay + mentor bonus
      const rt = tuning.relationship;
      if (rt.enabled) {
        const rel = this.relationships[i];
        tickRelationshipDecay(rel, rt);
        if (rel.mentor >= 0) {
          const mentor = this.cultivators[rel.mentor];
          if (mentor.alive) {
            const levelBonus = Math.max(0, mentor.level - c.level);
            c.cultivation += rt.mentorCultivationBonus * (1 + levelBonus * 0.1);
          } else {
            clearMentor(rel);
            if (tuning.memory.enabled) {
              const mem = this.memories[i];
              mem.ambition = Math.min(1, mem.ambition + 0.2);
              mem.grief = Math.min(1, mem.grief + 0.5);
            }
          }
        }
        if (rel.discipleCount > 0) {
          let aliveDisciples = 0;
          for (let d = 0; d < 3; d++) {
            const did = rel.disciples[d];
            if (did >= 0 && this.cultivators[did].alive) aliveDisciples++;
          }
          c.cultivation += rt.mentorTeachingBonus * aliveDisciples;
        }
        // Graduate: disciple level >= mentor level
        if (rel.mentor >= 0) {
          const mentorId = rel.mentor;
          const mentor = this.cultivators[mentorId];
          if (mentor.alive && c.level >= mentor.level) {
            const mentorRel = this.relationships[mentorId];
            removeDisciple(mentorRel, c.id);
            clearMentor(rel);
            addAlly(rel, mentorId, this.year, 0.5);
            addAlly(mentorRel, c.id, this.year, 0.5);
            if (events && c.level >= 2) {
              const mn = this.hooks?.getName(mentorId);
              const dn = this.hooks?.getName(c.id);
              const ge: RichRelationshipEvent = {
                type: 'relationship', year: this.year,
                newsRank: c.level >= 4 ? 'A' : 'B',
                subtype: 'graduate',
                actorA: { id: c.id, name: dn, level: c.level },
                actorB: { id: mentorId, name: mn, level: mentor.level },
                region: getRegionName(c.x, c.y),
              };
              events.push(ge);
            }
          }
        }
      }

      const target = sustainableMaxAge(c.level);
      if (c.maxAge > target) {
        c.maxAge = Math.max(
          tuning.lifespan.mortalMaxAge,
          Math.round(c.maxAge - (c.maxAge - target) * tuning.lifespan.lifespanDecayRate),
        );

      }

      tryBreakthrough(this, c, events, 'natural');

      if (c.level === MAX_LEVEL && c.alive) {
        tryTribulation(this, c, events);
        if (!c.alive) continue;
      }

      c.cachedCourage = effectiveCourage(c);

      if (c.age >= c.maxAge) {
        c.alive = false;
        this.expiryDeaths++;
        this.expiryDeathsByLevel[c.level]++;
        this.aliveCount--;
        this._deadIds.push(c.id);
        const deathLevel = c.level;
        this.levelGroups[deathLevel].delete(c.id);
        this.spatialIndex.remove(c.id, deathLevel, c.x, c.y);

        this.hooks?.onExpiry(c, this.year);

        if (events && deathLevel >= 2) {
          const name = this.hooks?.getName(c.id);
          const ee: RichExpiryEvent = {
            type: 'expiry', year: this.year, newsRank: 'C',
            subject: { id: c.id, name, age: c.age, behaviorState: c.behaviorState }, level: deathLevel,
            region: getRegionName(c.x, c.y),
            spiritualEnergy: this.areaTags.getSpiritualEnergy(c.x, c.y),
            terrainDanger: this.areaTags.getTerrainDanger(c.x, c.y),
          };
          ee.newsRank = scoreNewsRank(ee);
          events.push(ee);

          const ms = this.milestones.checkDeath(
            deathLevel, this.levelGroups[deathLevel].size,
            c.id, name ?? '', this.year,
          );
          if (ms) events.push(ms);
        }
      }
    }
    profiler.end('tickCultivators');
  }

  purgeDead(): void {
    const deadIds = this._deadIds;
    const freeSlots = this.freeSlots;
    const rt = getSimTuning().relationship;
    for (let i = 0; i < deadIds.length; i++) {
      const deadId = deadIds[i];
      freeSlots.push(deadId);
      // Remove from faction
      const fid = this.cultivators[deadId].factionId;
      if (fid >= 0) {
        this.factions.removeMember(deadId, fid);
        this.cultivators[deadId].factionId = -1;
      }
      if (rt.enabled) {
        for (let j = 0; j < this.nextId; j++) {
          if (!this.cultivators[j].alive) continue;
          purgeDeadFromRelationships(this.relationships[j], deadId);
        }
      }
    }
    deadIds.length = 0;
  }

  getSummary(): YearSummary {
    profiler.start('getSummary');
    const buf = this._levelCountsBuf;
    buf.fill(0);
    const ageBuf = this._ageBuffers;
    const courBuf = this._courageBuffers;
    const ageSum = this._ageSumBuf;
    const courSum = this._courageSumBuf;
    ageSum.fill(0);
    courSum.fill(0);
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
      const courage = c.cachedCourage;
      buf[lv]++;
      ageSum[lv] += c.age;
      courSum[lv] += courage;
      ageBuf[lv].push(c.age);
      courBuf[lv].push(courage);
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

    const typeCounts = this.settlements.getTypeCounts();

    const factionSummaries: FactionSummary[] = [];
    for (const f of this.factions.allFactions()) {
      factionSummaries.push({
        id: f.id,
        name: f.name,
        regionCode: f.regionCode,
        memberCount: f.memberCount,
        foundedYear: f.foundedYear,
      });
    }
    factionSummaries.sort((a, b) => b.memberCount - a.memberCount);

    profiler.end('getSummary');
    return {
      year: this._summaryYear,
      totalPopulation: total,
      levelCounts: buf.slice(),
      newCultivators: this.spawned,
      deaths: this.combatDeaths + this.expiryDeaths + this.tribulationDeaths,
      combatDeaths: this.combatDeaths,
      expiryDeaths: this.expiryDeaths,
      tribulations: this.tribulations,
      ascensions: this.ascensions,
      tribulationDeaths: this.tribulationDeaths,
      promotions: [...this.promotionCounts],
      breakthroughAttemptsByLevel: [...this.breakthroughAttemptsByLevel],
      expiryDeathsByLevel: [...this.expiryDeathsByLevel],
      combatDeathsByLevel: [...this.combatDeathsByLevel],
      highestLevel: highLevel,
      highestCultivation: highCult,
      combatDemotions: this.combatDemotions,
      combatInjuries: this.combatInjuries,
      combatCultLosses: this.combatCultLosses,
      combatLightInjuries: this.combatLightInjuries,
      combatMeridianDamages: this.combatMeridianDamages,
      breakthroughAttempts: this.breakthroughAttempts,
      breakthroughSuccesses: this.breakthroughSuccesses,
      breakthroughFailures: this.breakthroughFailures,
      levelStats,
      mortalPopulation: this.households.totalPopulation(),
      householdCount: this.households.count,
      settlementCount: this.settlements.count,
      hamletCount: typeCounts.hamlet,
      villageCount: typeCounts.village,
      townCount: typeCounts.town,
      cityCount: typeCounts.city,
      naturalDeaths: this.naturalDeaths,
      disasterDeaths: this.disasterDeaths,
      disasterCount: this.disasterCount,
      factionCount: this.factions.count,
      factionSummaries,
    };
  }

  getWorldContext(): {
    currentYear: number;
    population: number;
    levelCounts: number[];
    regionProfiles: { name: string; population: number; avgSpiritualEnergy: number; avgTerrainDanger: number }[];
    behaviorDistribution: Record<BehaviorState, number>;
    settlementSummary: {
      totalSettlements: number;
      mortalPopulation: number;
      householdCount: number;
      hamlet: number;
      village: number;
      town: number;
      city: number;
    };
  } {
    const levelCounts = new Array(LEVEL_COUNT).fill(0) as number[];
    const behaviorDist: Record<BehaviorState, number> = {
      escaping: 0, recuperating: 0, seeking_breakthrough: 0, settling: 0, wandering: 0,
    };
    const regionPop = new Map<RegionCode, number>();
    const regionSE = new Map<RegionCode, number>();
    const regionTD = new Map<RegionCode, number>();

    for (let i = 0; i < this.nextId; i++) {
      const c = this.cultivators[i];
      if (!c.alive) continue;
      levelCounts[c.level]++;
      behaviorDist[c.behaviorState]++;
      const rc = getRegionCode(c.x, c.y);
      regionPop.set(rc, (regionPop.get(rc) ?? 0) + 1);
      regionSE.set(rc, (regionSE.get(rc) ?? 0) + this.areaTags.getSpiritualEnergy(c.x, c.y));
      regionTD.set(rc, (regionTD.get(rc) ?? 0) + this.areaTags.getTerrainDanger(c.x, c.y));
    }

    const regionProfiles: { name: string; population: number; avgSpiritualEnergy: number; avgTerrainDanger: number }[] = [];
    for (const [rc, pop] of regionPop) {
      if (rc === '~') continue;
      regionProfiles.push({
        name: REGION_NAMES[rc],
        population: pop,
        avgSpiritualEnergy: round1((regionSE.get(rc) ?? 0) / pop),
        avgTerrainDanger: round1((regionTD.get(rc) ?? 0) / pop),
      });
    }
    regionProfiles.sort((a, b) => b.population - a.population);

    const typeCounts = this.settlements.getTypeCounts();
    const settlementSummary = {
      totalSettlements: this.settlements.count,
      mortalPopulation: this.households.totalPopulation(),
      householdCount: this.households.count,
      ...typeCounts,
    };

    return { currentYear: this.year, population: this.aliveCount, levelCounts, regionProfiles, behaviorDistribution: behaviorDist, settlementSummary };
  }

  evaluateBehaviorStates(): void {
    profiler.start('evaluateBehaviorStates');
    const year = this.year;
    const tuning = getSimTuning();
    const policy = this.aiPolicy !== null && !this.aiPolicy.fallback ? this.aiPolicy : null;

    for (let i = 0; i < this.nextId; i++) {
      const c = this.cultivators[i];
      if (!c.alive) continue;
      if (c.reachedMaxLevelAt > 0) continue;

      if (policy) {
        const nextThreshold = c.level < MAX_LEVEL ? threshold(c.level + 1) : c.cultivation;
        const mem = tuning.memory.enabled ? this.memories[i] : null;
        const rel = this.relationships[i];
        const nearbyId = this.spatialIndex.findNearbyAny(c.x, c.y, 3, i);
        const hasNearby = nearbyId >= 0;
        const relCtx: RelationshipContext = {
          rel,
          allyNearby: hasNearby && findAlly(rel, nearbyId) >= 0,
          rivalNearby: rel.rivals.some(r => r.id >= 0 && this.cultivators[r.id]?.alive),
          vendettaTargetNearby: rel.vendettas.some(v => v.targetId >= 0 && this.cultivators[v.targetId]?.alive),
          isFellowDisciple: hasNearby && isFellowDisciple(rel, this.relationships[nearbyId]),
          canSpar: false,
          canTeach: false,
          canBeTaught: rel.mentor >= 0,
          allyBreakthroughNearby: false,
          canGuard: c.injuredUntil <= year && c.behaviorState !== 'escaping',
          guardAvailable: false,
        };
        const state = extractState(
          c, year,
          this.areaTags.getSpiritualEnergy(c.x, c.y),
          this.areaTags.getTerrainDanger(c.x, c.y),
          nextThreshold,
          mem,
          relCtx,
        );
        const actionIdx = policy.selectAction(state, this.prng);
        const action = policy.actionName(actionIdx);
        c.behaviorState = action;
        if (action === 'settling') {
          c.settlingUntil = year + Math.max(1, Math.floor(c.maxAge * tuning.behavior.settlingFraction));
        }
        continue;
      }

      // --- Fallback: rule-based behavior ---
      const mem = tuning.memory.enabled ? this.memories[i] : null;

      // Priority 1: heavy injury -> escaping
      if (c.injuredUntil > year) {
        c.behaviorState = 'escaping';
        continue;
      }

      // Priority 1b: high caution → enter escaping even without active injury
      if (mem && mem.caution > 0.7 && c.behaviorState !== 'settling') {
        c.behaviorState = 'escaping';
        continue;
      }

      // Priority 2: light injury -> recuperating
      if (c.lightInjuryUntil > year) {
        c.behaviorState = 'recuperating';
        continue;
      }

      // Non-condition-driven states: re-evaluate at interval scaled by lifespan
      const evalInterval = Math.max(
        1,
        Math.floor(c.maxAge / tuning.lifespan.mortalMaxAge) * tuning.behavior.evalBaseInterval,
      );
      if (year % evalInterval !== 0 && c.behaviorState !== 'escaping' && c.behaviorState !== 'recuperating') {
        // Keep current state if not at evaluation tick (but settling expiry still checked)
        if (c.behaviorState === 'settling' && c.settlingUntil <= year) {
          // High rootedness extends settling duration
          if (mem && mem.rootedness > 0.5) {
            c.settlingUntil = year + Math.max(1, Math.floor(c.maxAge * tuning.behavior.settlingFraction * (1 + mem.rootedness)));
          } else {
            c.behaviorState = 'wandering';
          }
        }
        continue;
      }

      // Priority 3: check if breakthrough is urgent
      if (c.level < MAX_LEVEL) {
        const remainingYears = c.maxAge - c.age;
        const cultNeeded = threshold(c.level + 1) - c.cultivation;
        if (cultNeeded > 0 && remainingYears > 0) {
          const yearsToThreshold = cultNeeded; // base growth rate = 1.0 per year
          const seFactor = tuning.terrain.spiritualEnergyBreakthroughFactor[this.areaTags.getSpiritualEnergy(c.x, c.y)];
          const btChance = breakthroughChance(c.level) * seFactor;
          const expectedAttempts = btChance > 0 ? 1 / btChance : Infinity;
          const totalExpectedYears = yearsToThreshold + expectedAttempts * tuning.breakthroughFailure.cooldown;

          // Ambition modulates urgency threshold: high ambition → seek breakthrough earlier
          const urgencyMul = mem ? (1 + (mem.ambition - 0.5) * 0.6) : 1; // 0.7x ~ 1.3x
          if (totalExpectedYears * urgencyMul > remainingYears) {
            // Breakthrough fear: chance to delay even when urgent ("心魔")
            if (mem && mem.breakthroughFear > 0.3 && this.prng() < mem.breakthroughFear * tuning.memory.breakthroughFearDelayProb) {
              // Fear overrides — stay in current state instead of seeking
            } else {
              c.behaviorState = 'seeking_breakthrough';
              continue;
            }
          }

          // Was seeking and current cell now sufficient -> settle here
          if (c.behaviorState === 'seeking_breakthrough') {
            c.behaviorState = 'settling';
            c.settlingUntil = year + Math.max(1, Math.floor(c.maxAge * tuning.behavior.settlingFraction));
            continue;
          }
        }
      }

      // Priority 4: settling check
      if (c.behaviorState === 'settling' && c.settlingUntil > year) {
        continue; // keep settling
      }

      // Random chance to enter settling (frequency inversely proportional to maxAge)
      const settlingChance = tuning.lifespan.mortalMaxAge / c.maxAge;
      if (this.prng() < settlingChance) {
        c.behaviorState = 'settling';
        c.settlingUntil = year + Math.max(1, Math.floor(c.maxAge * tuning.behavior.settlingFraction));
        continue;
      }

      // Default: wandering
      c.behaviorState = 'wandering';
    }
    profiler.end('evaluateBehaviorStates');
  }

  tickYear(collectEvents = true): { isExtinct: boolean; events: RichEvent[] } {
    profiler.start('tickYear');
    this.resetYearCounters();

    // Household tick: growth, awakening, split
    profiler.start('tickYear.households');
    const { awakenings, splits, totalNaturalDeaths } = this.households.tickAll(this.prng, this.areaTags);
    this.naturalDeaths = totalNaturalDeaths;

    // Spawn cultivators from awakenings
    for (const aw of awakenings) {
      const x = aw.cellIdx % MAP_SIZE;
      const y = (aw.cellIdx - x) / MAP_SIZE;
      this.spawnCultivator(x, y, aw.settlementId, aw.householdId);
    }

    // Process household splits -> grow existing settlements or create new ones
    for (const sp of splits) {
      const result = this.households.splitHousehold(sp.parentId, this.prng, this.settlements);
      if (result) {
        if (sp.parentSettlementId >= 0) {
          // Parent belongs to a settlement: expand it instead of creating a new one
          this.settlements.addCell(sp.parentSettlementId, result.originCell, this.households);
          for (const nh of result.newHouseholds) {
            this.households.updateSettlementAffiliation(nh.id, sp.parentSettlementId);
          }
        } else {
          // Unaffiliated household: create a new settlement
          const s = this.settlements.createSettlement(
            sp.parentId, result.originCell, this.year, this.prng, this.households,
          );
          for (const nh of result.newHouseholds) {
            this.households.updateSettlementAffiliation(nh.id, s.id);
          }
        }
      }
    }

    // Try settlement expansion
    for (const s of this.settlements.allSettlements()) {
      this.settlements.tryExpand(s.id, this.prng, this.households);
    }

    // Try settlement shrinkage
    for (const s of this.settlements.allSettlements()) {
      while (this.settlements.tryShrink(s.id, this.households)) { /* release cells until stable */ }
    }

    // Prune dead settlements
    this.settlements.pruneDestroyed(this.households);
    this.settlements.recountTypes(this.households);

    profiler.end('tickYear.households');

    // Disasters
    const tuning = getSimTuning();
    let disasterResults: DisasterResult[] | undefined;
    if (tuning.disaster.enabled) {
      disasterResults = processDisasters(this.prng, this.settlements, this.households, this.areaTags);
      for (const d of disasterResults) {
        this.disasterDeaths += d.populationLost;
        this.disasterCount++;
      }
      if (disasterResults.length > 0) {
        this.settlements.recountTypes(this.households);
      }
    }

    const events: EventBuffer = collectEvents ? [] : null;

    if (events && disasterResults) {
      for (const d of disasterResults) {
        const originX = d.originCellIdx % MAP_SIZE;
        const originY = (d.originCellIdx - originX) / MAP_SIZE;
        const de: RichDisasterEvent = {
          type: 'disaster',
          year: this.year,
          newsRank: d.lossRatio >= 0.25 ? 'A' : 'B',
          disasterType: d.type,
          settlementId: d.settlementId,
          settlementName: d.settlementName,
          populationBefore: d.populationBefore,
          populationLost: d.populationLost,
          lossRatio: d.lossRatio,
          region: getRegionName(originX, originY),
          spiritualEnergy: this.areaTags.getSpiritualEnergy(originX, originY),
          terrainDanger: this.areaTags.getTerrainDanger(originX, originY),
        };
        events.push(de);
      }
    }
    this.tickCultivators(events);
    this.evaluateBehaviorStates();
    moveCultivators(this);
    processEncounters(this, events);
    processNonCombatEncounters(this, events);
    processFactions(this, events);
    this.purgeDead();
    const isExtinct = this.aliveCount === 0 && this.households.count === 0;
    this._summaryYear = this.year;
    this.year++;
    profiler.end('tickYear');
    return { isExtinct, events: events ?? [] };
  }

  resetYearCounters(): void {
    this.combatDeaths = 0;
    this.combatDemotions = 0;
    this.combatInjuries = 0;
    this.combatCultLosses = 0;
    this.combatLightInjuries = 0;
    this.combatMeridianDamages = 0;
    this.breakthroughAttempts = 0;
    this.breakthroughSuccesses = 0;
    this.breakthroughFailures = 0;
    this.expiryDeaths = 0;
    this.tribulations = 0;
    this.ascensions = 0;
    this.tribulationDeaths = 0;
    this.promotionCounts.fill(0);
    this.breakthroughAttemptsByLevel.fill(0);
    this.expiryDeathsByLevel.fill(0);
    this.combatDeathsByLevel.fill(0);
    this.spawned = 0;
    this.naturalDeaths = 0;
    this.disasterDeaths = 0;
    this.disasterCount = 0;
    this._deadIds.length = 0;
  }

  reset(seed: number, initialPop: number): void {
    this.cultivators.length = 0;
    this.relationships.length = 0;
    this.freeSlots.length = 0;
    this._deadIds.length = 0;
    this.nextId = 0;
    this.aliveCount = 0;
    this.levelGroups = initLevelGroups();
    this.aliveLevelIds = this.levelGroups;
    this.levelArrayCache = initLevelArrayCache();
    this.aliveIds.length = 0;
    this._ageBuffers = initBuffers();
    this._courageBuffers = initBuffers();
    this.milestones.reset();
    this.spatialIndex.reset();
    this.areaTags.reset();
    this.areaTags.generate(seed);
    this.households.reset();
    this.settlements.reset();
    this.factions.reset();
    this.year = 1;
    this._summaryYear = 1;
    this.prng = createPRNG(seed);
    this.yearlySpawn = YEARLY_NEW;
    this.resetYearCounters();
    this.households.generate(seed, this.prng, this.areaTags, initialPop);
    this._defeatedBuf = new Uint8Array(this.nextId);
    this._levelArrayIndex = new Int32Array(this.nextId);
  }

  serialize(): Buffer {
    const SNAPSHOT_VERSION = 9;
    // Header: version(u8) + prngState(i32) + year(i32) + nextId(i32) + aliveCount(i32) + yearlySpawn(i32) + freeSlotsLen(i32)
    const HEADER_SIZE = 1 + 4 * 6;
    const freeSlotsSize = this.freeSlots.length * 4;
    // Per cultivator: v9 fields (87 + factionId i32 = 91) bytes
    const CULTIVATOR_SIZE = 91;
    const cultivatorsSize = this.nextId * CULTIVATOR_SIZE;
    const memoriesSize = this.nextId * MEMORY_SERIALIZE_BYTES;
    const relationshipsSize = this.nextId * RELATIONSHIP_SERIALIZE_BYTES;
    // Milestones: highestLevelEverReached(i32) + levelEverPopulated(u8 * LEVEL_COUNT)
    const milestonesSize = 4 + LEVEL_COUNT;
    const areaTagsSize = this.areaTags.serializeSize();
    const householdsSize = this.households.serializeSize();
    const settlementsSize = this.settlements.serializeSize();
    const factionsSize = this.factions.serializeSize();
    const totalSize = HEADER_SIZE + freeSlotsSize + cultivatorsSize + memoriesSize + relationshipsSize + milestonesSize + areaTagsSize + householdsSize + settlementsSize + factionsSize;

    const buf = Buffer.alloc(totalSize);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 0;

    // Header
    dv.setUint8(off, SNAPSHOT_VERSION); off += 1;
    dv.setInt32(off, this.prng.state, true); off += 4;
    dv.setInt32(off, this.year, true); off += 4;
    dv.setInt32(off, this.nextId, true); off += 4;
    dv.setInt32(off, this.aliveCount, true); off += 4;
    dv.setInt32(off, this.yearlySpawn, true); off += 4;
    dv.setInt32(off, this.freeSlots.length, true); off += 4;

    // FreeSlots
    for (let i = 0; i < this.freeSlots.length; i++) {
      dv.setInt32(off, this.freeSlots[i], true); off += 4;
    }

    // Cultivators (v4: includes origin fields)
    for (let i = 0; i < this.nextId; i++) {
      const c = this.cultivators[i];
      dv.setUint8(off, c.alive ? 1 : 0); off += 1;
      dv.setInt32(off, c.age, true); off += 4;
      dv.setFloat64(off, c.cultivation, true); off += 8;
      dv.setUint8(off, c.level); off += 1;
      dv.setFloat64(off, c.courage, true); off += 8;
      dv.setInt32(off, c.maxAge, true); off += 4;
      dv.setInt32(off, c.injuredUntil, true); off += 4;
      dv.setInt32(off, c.lightInjuryUntil, true); off += 4;
      dv.setInt32(off, c.meridianDamagedUntil, true); off += 4;
      dv.setInt32(off, c.breakthroughCooldownUntil, true); off += 4;
      dv.setFloat64(off, c.cachedCourage, true); off += 8;
      dv.setInt32(off, c.reachedMaxLevelAt, true); off += 4;
      dv.setInt32(off, c.x, true); off += 4;
      dv.setInt32(off, c.y, true); off += 4;
      dv.setUint8(off, encodeBehaviorState(c.behaviorState)); off += 1;
      dv.setInt32(off, c.settlingUntil, true); off += 4;
      dv.setInt32(off, c.originSettlementId, true); off += 4;
      dv.setInt32(off, c.originHouseholdId, true); off += 4;
      dv.setInt32(off, c.teachingBoostUntil, true); off += 4;
      dv.setFloat64(off, c.teachingBoostRate, true); off += 8;
      dv.setInt32(off, c.factionId, true); off += 4;
    }

    // Memories (v7)
    for (let i = 0; i < this.nextId; i++) {
      off = serializeMemory(dv, off, this.memories[i]);
    }

    // Relationships (v7)
    for (let i = 0; i < this.nextId; i++) {
      off = serializeRelationships(dv, off, this.relationships[i]);
    }

    // Milestones
    dv.setInt32(off, this.milestones.highestLevelEverReached, true); off += 4;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      dv.setUint8(off, this.milestones.levelEverPopulated[i] ? 1 : 0); off += 1;
    }

    // AreaTags
    off = this.areaTags.serializeTo(dv, off);

    // Households (v4)
    off = this.households.serializeTo(dv, off);

    // Settlements (v4)
    off = this.settlements.serializeTo(dv, off, buf);

    // Factions (v9)
    off = this.factions.serializeTo(dv, off, buf);

    return buf;
  }

  /** Apply combat collateral damage to households at a cell */
  applyCombatCollateral(cellIdx: number): void {
    this.households.applyCombatDamage(cellIdx, getSimTuning().household.combatCollateralPopLoss);
  }

  static deserialize(buf: Buffer): SimulationEngine {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 0;

    // Header
    const version = dv.getUint8(off); off += 1;
    if (version < 1 || version > 9) throw new Error(`Unknown snapshot version: ${version}`);
    const prngState = dv.getInt32(off, true); off += 4;
    const year = dv.getInt32(off, true); off += 4;
    const nextId = dv.getInt32(off, true); off += 4;
    /* aliveCount from header -- skip, recount from cultivators */
    off += 4;
    const yearlySpawn = dv.getInt32(off, true); off += 4;
    const freeSlotsLen = dv.getInt32(off, true); off += 4;

    // FreeSlots
    const freeSlots: number[] = new Array(freeSlotsLen);
    for (let i = 0; i < freeSlotsLen; i++) {
      freeSlots[i] = dv.getInt32(off, true); off += 4;
    }

    // Cultivators
    const cultivators: Cultivator[] = new Array(nextId);
    const levelGroups = initLevelGroups();
    const spatialIndex = new SpatialIndex();
    let verifiedAlive = 0;

    for (let i = 0; i < nextId; i++) {
      const alive = dv.getUint8(off) === 1; off += 1;
      const age = dv.getInt32(off, true); off += 4;
      const cultivation = dv.getFloat64(off, true); off += 8;
      const level = dv.getUint8(off); off += 1;
      const courage = dv.getFloat64(off, true); off += 8;
      const maxAge = dv.getInt32(off, true); off += 4;
      const injuredUntil = dv.getInt32(off, true); off += 4;
      const lightInjuryUntil = dv.getInt32(off, true); off += 4;
      const meridianDamagedUntil = dv.getInt32(off, true); off += 4;
      const breakthroughCooldownUntil = dv.getInt32(off, true); off += 4;
      const cachedCourage = dv.getFloat64(off, true); off += 8;
      const reachedMaxLevelAt = dv.getInt32(off, true); off += 4;
      const x = dv.getInt32(off, true); off += 4;
      const y = dv.getInt32(off, true); off += 4;

      let behaviorState: BehaviorState = 'wandering';
      let settlingUntil = 0;
      if (version >= 3) {
        behaviorState = decodeBehaviorState(dv.getUint8(off)); off += 1;
        settlingUntil = dv.getInt32(off, true); off += 4;
      }

      let originSettlementId = -1;
      let originHouseholdId = -1;
      if (version >= 4) {
        originSettlementId = dv.getInt32(off, true); off += 4;
        originHouseholdId = dv.getInt32(off, true); off += 4;
      }

      let teachingBoostUntil = 0;
      let teachingBoostRate = 0;
      if (version >= 8) {
        teachingBoostUntil = dv.getInt32(off, true); off += 4;
        teachingBoostRate = dv.getFloat64(off, true); off += 8;
      }

      let factionId = -1;
      if (version >= 9) {
        factionId = dv.getInt32(off, true); off += 4;
      }

      const c: Cultivator = {
        id: i, age, cultivation, level, courage, maxAge,
        injuredUntil, lightInjuryUntil, meridianDamagedUntil,
        breakthroughCooldownUntil, alive, cachedCourage, reachedMaxLevelAt, x, y,
        behaviorState, settlingUntil,
        originSettlementId, originHouseholdId,
        teachingBoostUntil, teachingBoostRate,
        factionId,
      };
      cultivators[i] = c;

      if (alive) {
        verifiedAlive++;
        levelGroups[level].add(i);
        spatialIndex.add(i, level, x, y);
      }
    }

    // Memories
    const memories: CharacterMemory[] = new Array(nextId);
    if (version >= 7) {
      for (let i = 0; i < nextId; i++) {
        const result = deserializeMemory(dv, off);
        memories[i] = result.mem;
        off = result.offset;
      }
    } else if (version >= 5) {
      for (let i = 0; i < nextId; i++) {
        const result = deserializeMemoryLegacy(dv, off);
        memories[i] = result.mem;
        off = result.offset;
      }
    } else {
      for (let i = 0; i < nextId; i++) {
        memories[i] = createEmptyMemory(cultivators[i]);
      }
    }

    // Relationships (v7+)
    const relationships: CharacterRelationships[] = new Array(nextId);
    if (version >= 7) {
      for (let i = 0; i < nextId; i++) {
        const result = deserializeRelationships(dv, off);
        relationships[i] = result.rel;
        off = result.offset;
      }
    } else {
      for (let i = 0; i < nextId; i++) {
        relationships[i] = createEmptyRelationships();
      }
    }

    // Milestones
    const milestones = new MilestoneTracker();
    milestones.highestLevelEverReached = dv.getInt32(off, true); off += 4;
    for (let i = 0; i < LEVEL_COUNT; i++) {
      milestones.levelEverPopulated[i] = dv.getUint8(off) === 1; off += 1;
    }

    // AreaTags
    let areaTags: AreaTagSystem;
    if (version >= 2) {
      const result = AreaTagSystem.deserializeFrom(dv, off);
      areaTags = result.system;
      off = result.offset;
    } else {
      areaTags = new AreaTagSystem();
      areaTags.generate(prngState);
    }

    // Households & Settlements (v4)
    let households: HouseholdSystem;
    let settlements: SettlementSystem;
    if (version >= 4) {
      const hResult = HouseholdSystem.deserializeFrom(dv, off, version);
      households = hResult.system;
      off = hResult.offset;
      const sResult = SettlementSystem.deserializeFrom(dv, off, buf);
      settlements = sResult.system;
      off = sResult.offset;
    } else {
      // Legacy snapshots: create empty households/settlements and generate initial state
      households = new HouseholdSystem();
      const tempPrng = createPRNG(prngState);
      households.generate(prngState, tempPrng, areaTags);
      settlements = new SettlementSystem();
    }

    // Factions (v9)
    let factionSys: FactionSystem;
    if (version >= 9) {
      const fResult = FactionSystem.deserializeFrom(dv, off, buf);
      factionSys = fResult.system;
      off = fResult.offset;
    } else {
      factionSys = new FactionSystem();
    }

    // Construct engine bypassing constructor
    const engine = Object.create(SimulationEngine.prototype) as SimulationEngine;
    engine.prng = createPRNG(prngState);
    engine.year = year;
    engine['_summaryYear'] = year > 1 ? year - 1 : 1;
    engine.nextId = nextId;
    engine.aliveCount = verifiedAlive;
    engine.yearlySpawn = yearlySpawn;
    engine.cultivators = cultivators;
    engine.memories = memories;
    engine.relationships = relationships;
    engine.freeSlots = freeSlots;
    engine.levelGroups = levelGroups;
    engine.aliveLevelIds = levelGroups;
    engine.spatialIndex = spatialIndex;
    engine.milestones = milestones;
    engine.areaTags = areaTags;
    engine.households = households;
    engine.settlements = settlements;
    engine.factions = factionSys;
    engine.levelArrayCache = initLevelArrayCache();
    engine.aliveIds = [];
    engine['_levelCountsBuf'] = new Array<number>(LEVEL_COUNT).fill(0);
    engine._ageSumBuf = new Float64Array(LEVEL_COUNT);
    engine._courageSumBuf = new Float64Array(LEVEL_COUNT);
    engine['_ageBuffers'] = initBuffers();
    engine['_courageBuffers'] = initBuffers();
    engine._defeatedBuf = new Uint8Array(nextId);
    engine._levelArrayIndex = new Int32Array(nextId);
    engine._deadIds = [];
    engine.hooks = undefined;
    engine.aiPolicy = null;

    // Reset yearly counters
    engine.combatDeaths = 0;
    engine.combatDemotions = 0;
    engine.combatInjuries = 0;
    engine.combatCultLosses = 0;
    engine.combatLightInjuries = 0;
    engine.combatMeridianDamages = 0;
    engine.breakthroughAttempts = 0;
    engine.breakthroughSuccesses = 0;
    engine.breakthroughFailures = 0;
    engine.expiryDeaths = 0;
    engine.tribulations = 0;
    engine.ascensions = 0;
    engine.tribulationDeaths = 0;
    engine.promotionCounts = new Array<number>(LEVEL_COUNT).fill(0);
    engine.breakthroughAttemptsByLevel = new Array<number>(LEVEL_COUNT).fill(0);
    engine.expiryDeathsByLevel = new Array<number>(LEVEL_COUNT).fill(0);
    engine.combatDeathsByLevel = new Array<number>(LEVEL_COUNT).fill(0);
    engine.spawned = 0;
    engine.naturalDeaths = 0;
    engine.disasterDeaths = 0;
    engine.disasterCount = 0;

    // Recount settlement types
    settlements.recountTypes(households);

    return engine;
  }
}

function initLevelGroups(): Set<number>[] {
  const a: Set<number>[] = new Array(LEVEL_COUNT);
  for (let i = 0; i < LEVEL_COUNT; i++) a[i] = new Set();
  return a;
}

function swap(arr: number[], i: number, j: number): void {
  const t = arr[i];
  arr[i] = arr[j];
  arr[j] = t;
}

function partition(arr: number[], left: number, right: number, pivotIndex: number): number {
  const pivotValue = arr[pivotIndex];
  swap(arr, pivotIndex, right);
  let storeIndex = left;
  for (let i = left; i < right; i++) {
    if (arr[i] < pivotValue) {
      swap(arr, storeIndex, i);
      storeIndex++;
    }
  }
  swap(arr, right, storeIndex);
  return storeIndex;
}

function quickselect(arr: number[], k: number): number {
  let left = 0;
  let right = arr.length - 1;
  while (left <= right) {
    const pivotIndex = (left + right) >> 1;
    const idx = partition(arr, left, right, pivotIndex);
    if (idx === k) return arr[idx];
    if (idx < k) left = idx + 1;
    else right = idx - 1;
  }
  return arr[k];
}

function median(arr: number[]): number {
  const mid = arr.length >> 1;
  if (arr.length & 1) return quickselect(arr, mid);
  const upper = quickselect(arr, mid);
  const lower = quickselect(arr, mid - 1);
  return (upper + lower) / 2;
}

function initBuffers(): number[][] {
  return Array.from({ length: LEVEL_COUNT }, () => []);
}

function initLevelArrayCache(): number[][] {
  const a: number[][] = new Array(LEVEL_COUNT);
  for (let i = 0; i < LEVEL_COUNT; i++) a[i] = [];
  return a;
}

interface GuardianResult {
  guardians: GuardianInfo[];
  bonus: number;
}

function findEligibleGuardians(
  engine: SimulationEngine, c: Cultivator,
): GuardianResult {
  const tuning = getSimTuning();
  const rt = tuning.relationship;
  const gt = tuning.guardian;

  if (!rt.enabled) return { guardians: [], bonus: 0 };

  const rel = engine.relationships[c.id];
  const radius = tuning.spatial.encounterRadius[c.level];
  const guardians: GuardianInfo[] = [];
  let totalBonus = 0;

  // Collect candidate IDs from relationships: mentor, allies, fellow disciples' mentor's other disciples
  const candidateIds = new Set<number>();

  // Mentor
  if (rel.mentor >= 0) candidateIds.add(rel.mentor);

  // Allies
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    if (rel.allies[i].id >= 0) candidateIds.add(rel.allies[i].id);
  }

  // Disciples (they can also guard)
  for (let d = 0; d < MAX_DISCIPLES; d++) {
    if (rel.disciples[d] >= 0) candidateIds.add(rel.disciples[d]);
  }

  // Fellow disciples (share same mentor)
  if (rel.mentor >= 0) {
    const mentorRel = engine.relationships[rel.mentor];
    for (let d = 0; d < MAX_DISCIPLES; d++) {
      const did = mentorRel.disciples[d];
      if (did >= 0 && did !== c.id) candidateIds.add(did);
    }
  }

  for (const gId of candidateIds) {
    const g = engine.cultivators[gId];
    if (!g.alive) continue;
    if (g.level < c.level) continue;
    if (g.injuredUntil > engine.year) continue;
    if (g.behaviorState === 'escaping') continue;

    // Check proximity
    const dx = Math.abs(c.x - g.x);
    const dy = Math.abs(c.y - g.y);
    if (Math.min(dx, MAP_SIZE - dx) > radius || Math.min(dy, MAP_SIZE - dy) > radius) continue;

    // Determine relationship type and bonus
    const gRel = engine.relationships[gId];
    const isMentor = rel.mentor === gId;
    const isFellow = isFellowDisciple(rel, gRel);
    const allyEntry = findAlly(rel, gId);
    const isStrongAlly = allyEntry !== null && allyEntry.strength >= 0.5;

    let bonus = 0;
    if (isMentor) {
      bonus = gt.mentorGuardianBonus;
    } else if (isStrongAlly || isFellow) {
      bonus = gt.allyGuardianBonus;
    } else {
      continue; // not a qualifying relationship
    }

    // Diminishing returns: each additional guardian contributes less
    const diminish = 1 / (1 + guardians.length);
    totalBonus += bonus * diminish;
    guardians.push({ id: gId, level: g.level });

    if (totalBonus >= gt.maxGuardianBonus) {
      totalBonus = gt.maxGuardianBonus;
      break;
    }
  }

  return { guardians, bonus: Math.min(totalBonus, gt.maxGuardianBonus) };
}

export function tryBreakthrough(
  engine: SimulationEngine, c: Cultivator,
  events: EventBuffer, cause: 'natural' | 'combat',
): boolean {
  const year = engine.year;
  const tuning = getSimTuning();
  const btTotalWeight =
    tuning.breakthroughFailure.nothingWeight +
    tuning.breakthroughFailure.cultLossWeight +
    tuning.breakthroughFailure.injuryWeight;
  const btNothingThreshold = tuning.breakthroughFailure.nothingWeight / btTotalWeight;
  const btCultLossThreshold =
    (tuning.breakthroughFailure.nothingWeight + tuning.breakthroughFailure.cultLossWeight) / btTotalWeight;
  if (c.level >= MAX_LEVEL) return false;
  if (c.cultivation < threshold(c.level + 1)) return false;
  if (c.breakthroughCooldownUntil > year) return false;
  if (c.injuredUntil > year) return false;

  engine.breakthroughAttempts++;
  engine.breakthroughAttemptsByLevel[c.level]++;

  // Find eligible guardians nearby
  const { guardians, bonus: guardianBonus } = findEligibleGuardians(engine, c);

  const seFactor = tuning.terrain.spiritualEnergyBreakthroughFactor[engine.areaTags.getSpiritualEnergy(c.x, c.y)];
  const baseChance = breakthroughChance(c.level) * seFactor;
  if (engine.prng() < baseChance + guardianBonus) {
    const prevLevel = c.level;
    c.level++;
    c.maxAge = Math.min(sustainableMaxAge(MAX_LEVEL), c.maxAge + lifespanBonus(c.level));
    engine.levelGroups[prevLevel].delete(c.id);
    engine.levelGroups[c.level].add(c.id);
    engine.spatialIndex.changeLevel(c.id, prevLevel, c.level, c.x, c.y);
    engine.promotionCounts[c.level]++;
    engine.breakthroughSuccesses++;
    if (c.level === MAX_LEVEL) c.reachedMaxLevelAt = engine.year;
    breakthroughMove(engine, c);

    if (tuning.memory.enabled) {
      onBreakthroughSuccess(engine.memories[c.id], c.y * MAP_SIZE + c.x, year, tuning.memory);
    }

    engine.hooks?.onPromotion(c, c.level, year);

    if (c.level >= 2) {
      if (!events) {
        engine.milestones.recordPromotion(c.level);
        return true;
      }

      const name = engine.hooks?.getName(c.id);
      const pe: RichPromotionEvent = {
        type: 'promotion', year, newsRank: 'C',
        subject: { id: c.id, name, age: c.age, behaviorState: c.behaviorState },
        fromLevel: prevLevel, toLevel: c.level, cause,
        region: getRegionName(c.x, c.y),
        spiritualEnergy: engine.areaTags.getSpiritualEnergy(c.x, c.y),
        terrainDanger: engine.areaTags.getTerrainDanger(c.x, c.y),
      };
      if (guardians.length > 0) pe.guardians = guardians;
      pe.newsRank = scoreNewsRank(pe);
      // Guarded breakthrough promotion gets +1 rank tier
      if (guardians.length > 0 && pe.newsRank !== 'S') {
        pe.newsRank = pe.newsRank === 'C' ? 'B' : pe.newsRank === 'B' ? 'A' : 'S';
      }
      events.push(pe);

      const ms = engine.milestones.checkPromotion(c.level, c.id, name ?? '', year);
      if (ms) events.push(ms);
    }
    return true;
  }

  c.breakthroughCooldownUntil = year + tuning.breakthroughFailure.cooldown;
  engine.breakthroughFailures++;

  const hasGuardian = guardians.length > 0;
  const penaltyReduction = hasGuardian ? tuning.guardian.failurePenaltyReduction : 1;

  const r = engine.prng();
  let penalty: RichBreakthroughEvent['penalty'] = 'cooldown_only';
  if (r >= btNothingThreshold) {
    if (r < btCultLossThreshold) {
      penalty = 'cultivation_loss';
      const base = threshold(c.level);
      const lossRate = tuning.breakthroughFailure.cultLossRate * penaltyReduction;
      c.cultivation = Math.max(
        base,
        round1(c.cultivation - (c.cultivation - base) * lossRate),
      );
    } else {
      if (hasGuardian) {
        // Guardian prevents heavy injury, downgrade to light injury
        penalty = 'cultivation_loss';
        const base = threshold(c.level);
        const lossRate = tuning.breakthroughFailure.cultLossRate * penaltyReduction;
        c.cultivation = Math.max(
          base,
          round1(c.cultivation - (c.cultivation - base) * lossRate),
        );
      } else {
        penalty = 'injury';
        c.injuredUntil = year + tuning.combat.injuryDuration;
      }
    }
  }

  if (tuning.memory.enabled) {
    onBreakthroughFail(engine.memories[c.id], c.courage, penalty === 'injury', year, tuning.memory);
  }

  if (events && c.level >= 2) {
    const name = engine.hooks?.getName(c.id);
    const be: RichBreakthroughEvent = {
      type: 'breakthrough_fail', year,
      newsRank: c.level >= 4 ? 'B' : 'C',
      subject: { id: c.id, name, level: c.level, age: c.age, behaviorState: c.behaviorState },
      penalty, cause,
      region: getRegionName(c.x, c.y),
      spiritualEnergy: engine.areaTags.getSpiritualEnergy(c.x, c.y),
      terrainDanger: engine.areaTags.getTerrainDanger(c.x, c.y),
    };
    if (hasGuardian) be.guardians = guardians;
    events.push(be);
  }

  return false;
}

export function tryTribulation(
  engine: SimulationEngine, c: Cultivator,
  events: EventBuffer,
): void {
  if (c.reachedMaxLevelAt <= 0) return;
  const yearsAtMax = engine.year - c.reachedMaxLevelAt;
  if (yearsAtMax <= 0) return;

  const chance = tribulationChance(yearsAtMax);
  if (chance <= 0 || engine.prng() >= chance) return;

  engine.tribulations++;
  const profile = getBalanceProfile();
  const ascended = engine.prng() < profile.tribulation.successRate;
  const outcome: 'ascension' | 'death' = ascended ? 'ascension' : 'death';

  const deathLevel = c.level;
  c.alive = false;
  engine.aliveCount--;
  engine._deadIds.push(c.id);
  engine.levelGroups[deathLevel].delete(c.id);
  engine.spatialIndex.remove(c.id, deathLevel, c.x, c.y);

  if (ascended) {
    engine.ascensions++;
  } else {
    engine.tribulationDeaths++;
  }

  engine.hooks?.onTribulation(c, outcome, engine.year);

  if (events) {
    const name = engine.hooks?.getName(c.id);
    const te: RichTribulationEvent = {
      type: 'tribulation', year: engine.year, newsRank: 'S',
      subject: { id: c.id, name, level: deathLevel, age: c.age, behaviorState: c.behaviorState },
      outcome,
      region: getRegionName(c.x, c.y),
      spiritualEnergy: engine.areaTags.getSpiritualEnergy(c.x, c.y),
      terrainDanger: engine.areaTags.getTerrainDanger(c.x, c.y),
    };
    events.push(te);

    if (!ascended) {
      const ms = engine.milestones.checkDeath(
        deathLevel, engine.levelGroups[deathLevel].size,
        c.id, name ?? '', engine.year,
      );
      if (ms) events.push(ms);
    }
  }
}
