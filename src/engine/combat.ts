import type {
  Cultivator,
  DefeatOutcome,
  NewsRank,
  RichCombatEvent,
  RichEvent,
} from '../types.js';
import { gaussianContribution, getBalanceProfile, sigmoidContribution } from '../balance.js';
import { getSimTuning } from '../sim-tuning.js';
import {
  LEVEL_COUNT,
  MAP_SIZE,
  effectiveCourage,
  getRegionName,
  round1,
  threshold,
} from '../constants/index.js';
import { prngShuffle, truncatedGaussian } from './prng.js';
import { tryBreakthrough, type SimulationEngine } from './simulation.js';
import { profiler } from './profiler.js';
import { buildEncounterProbCache, findSpatialOpponent, localEncounterProbability } from './spatial.js';
import { onCombatWin, onCombatLoss, pushPlace, PLACE_DANGER, findEncounter, ENCOUNTER_LOSS, ENCOUNTER_KIN_KILLED, countEncountersWith } from './memory.js';
import {
  isFellowDisciple, isRival, hasVendettaAgainst, findAlly,
  addRival, addVendetta, addAlly, removeRival, setMentor, addDisciple,
} from './relationship.js';
import type { RichRelationshipEvent } from '../types.js';

type EventBuffer = RichEvent[] | null;

const OUTCOME_NAMES: DefeatOutcome[] = [
  'death', 'demotion', 'injury', 'cult_loss',
  'cult_loss', // index 4 unused, placeholder
  'meridian_damage', 'light_injury',
];

export function scoreNewsRank(e: RichEvent): NewsRank {
  if (e.type === 'milestone') return 'S';
  if (e.type === 'tribulation') return 'S';
  if (e.type === 'relationship') return e.newsRank;
  if (e.type === 'combat' && e.outcome === 'death' && e.loser.level >= 6) return 'S';
  if (e.type === 'combat') {
    const lv = Math.max(e.winner.level, e.loser.level);
    if (lv >= 4) return 'A';
    if (e.winner.cultivation < e.loser.cultivation * 0.5) return 'A';
  }
  if (e.type === 'promotion' && e.toLevel - e.fromLevel >= 2) return 'A';
  if (e.type === 'expiry' && e.level >= 4 && e.subject.name) return 'A';
  if (e.type === 'promotion' && e.toLevel >= 2 && e.toLevel <= 3) return 'B';
  if (e.type === 'combat') {
    const lv = Math.max(e.winner.level, e.loser.level);
    if (lv === 3) return 'B';
  }
  if (e.type === 'expiry' && e.level >= 2 && e.level <= 3 && e.subject.name) return 'B';
  return 'C';
}

export function processEncounters(engine: SimulationEngine, events: EventBuffer = null): void {
  profiler.start('processEncounters');

  if (engine.nextId > engine._defeatedBuf.length) {
    engine._defeatedBuf = new Uint8Array(engine.nextId);
    engine._levelArrayIndex = new Int32Array(engine.nextId);
  }

  profiler.start('processEncounters.buildCache');
  const aliveIds = engine.aliveIds;
  aliveIds.length = 0;
  let snapshotN = 0;
  engine._levelArrayIndex.fill(-1);
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const ids = engine.levelGroups[level];
    const arr = engine.levelArrayCache[level];
    arr.length = 0;
    if (level === 0) continue;
    for (const id of ids) {
      const c = engine.cultivators[id];
      if (c.injuredUntil > engine.year) continue;
      engine._levelArrayIndex[id] = arr.length;
      arr.push(id);
      aliveIds.push(id);
    }
    snapshotN += arr.length;
  }
  profiler.end('processEncounters.buildCache');

  if (snapshotN === 0) {
    profiler.end('processEncounters');
    return;
  }

  profiler.start('processEncounters.buildAliveIds');
  prngShuffle(engine.prng, aliveIds);
  profiler.end('processEncounters.buildAliveIds');

  engine._defeatedBuf.fill(0);

  buildEncounterProbCache(engine);

  let eventMinLevel = 0;
  if (events) {
    let cumulative = 0;
    const target = Math.ceil(engine.aliveCount * 0.05);
    for (let lv = LEVEL_COUNT - 1; lv >= 0; lv--) {
      cumulative += engine.levelGroups[lv].size;
      if (cumulative >= target) { eventMinLevel = lv; break; }
    }
  }

  profiler.start('processEncounters.combatLoop');
  for (const id of aliveIds) {
    const c = engine.cultivators[id];
    if (!c.alive) continue;
    if (c.injuredUntil > engine.year || engine._defeatedBuf[id]) continue;

    const encounterProb = localEncounterProbability(c);
    if (encounterProb <= 0) continue;
    if (engine.prng() >= encounterProb) continue;

    const opp = findSpatialOpponent(engine, c);
    if (!opp) continue;

    resolveCombat(engine, c, opp, events, eventMinLevel);
  }
  profiler.end('processEncounters.combatLoop');

  const rlt = getSimTuning().relationship;
  if (rlt.enabled) {
    profiler.start('processEncounters.relationships');
    processRelationshipFormation(engine, events);
    profiler.end('processEncounters.relationships');
  }

  profiler.end('processEncounters');
}

function resolveDefeatOutcome(
  prng: () => number,
  winnerSnap: number,
  loserSnap: number,
  loserLevel: number,
): number {
  const gap = (winnerSnap - loserSnap) / (winnerSnap + loserSnap);
  const tuning = getSimTuning();
  const profile = getBalanceProfile();
  const deathBoost = Math.exp(gaussianContribution(loserLevel, profile.combat.deathBoost));
  const deathChance = Math.min(
    tuning.combat.defeatMaxDeath,
    tuning.combat.defeatDeathBase *
      tuning.combat.defeatDeathDecay ** loserLevel *
      (1 + tuning.combat.defeatGapSeverity * gap) *
      deathBoost,
  );
  if (prng() < deathChance) return 0;
  const total =
    tuning.combat.defeatLightInjuryWeight +
    tuning.combat.defeatInjuryWeight +
    tuning.combat.defeatCultLossWeight +
    tuning.combat.defeatMeridianWeight +
    tuning.combat.defeatDemotionWeight;
  const r = prng();
  if (r < tuning.combat.defeatLightInjuryWeight / total) return 6;
  if (r < (tuning.combat.defeatLightInjuryWeight + tuning.combat.defeatInjuryWeight) / total) return 2;
  if (
    r < (
      tuning.combat.defeatLightInjuryWeight +
      tuning.combat.defeatInjuryWeight +
      tuning.combat.defeatCultLossWeight
    ) / total
  ) return 3;
  if (
    r < (
      tuning.combat.defeatLightInjuryWeight +
      tuning.combat.defeatInjuryWeight +
      tuning.combat.defeatCultLossWeight +
      tuning.combat.defeatMeridianWeight
    ) / total
  ) return 5;
  return 1;
}

function resolveCombat(
  engine: SimulationEngine,
  a: Cultivator,
  b: Cultivator,
  events: EventBuffer,
  eventMinLevel: number,
): void {
  const year = engine.year;
  const tuning = getSimTuning();
  const aCultSnap = a.cultivation;
  const bCultSnap = b.cultivation;

  let aCombatPower = a.cultivation;
  let bCombatPower = b.cultivation;
  if (a.meridianDamagedUntil > year) {
    aCombatPower *= (1 - tuning.combat.meridianCombatPenalty);
  }
  if (b.meridianDamagedUntil > year) {
    bCombatPower *= (1 - tuning.combat.meridianCombatPenalty);
  }

  let total = aCombatPower + bCombatPower;
  if (total <= 0) return;
  const mt = tuning.memory;
  let aCourage = a.cachedCourage;
  let bCourage = b.cachedCourage;

  // Memory-based combat willingness adjustments
  if (mt.enabled) {
    const aMem = engine.memories[a.id];
    const bMem = engine.memories[b.id];

    // Confidence modulates effective courage
    aCourage = aCourage * (0.5 + 0.5 * aMem.confidence / Math.max(0.01, a.courage));
    bCourage = bCourage * (0.5 + 0.5 * bMem.confidence / Math.max(0.01, b.courage));

    // Past defeat by this specific opponent → flee boost
    const aMemOfB = findEncounter(aMem, b.id);
    if (aMemOfB && (aMemOfB.outcome === ENCOUNTER_LOSS || aMemOfB.outcome === ENCOUNTER_KIN_KILLED)) {
      aCourage *= (1 - mt.encounterFleeBoost);
    }
    const bMemOfA = findEncounter(bMem, a.id);
    if (bMemOfA && (bMemOfA.outcome === ENCOUNTER_LOSS || bMemOfA.outcome === ENCOUNTER_KIN_KILLED)) {
      bCourage *= (1 - mt.encounterFleeBoost);
    }

    // Same origin settlement → reduce combat willingness
    if (a.originSettlementId >= 0 && a.originSettlementId === b.originSettlementId) {
      aCourage *= (1 - mt.kinCombatReduction);
      bCourage *= (1 - mt.kinCombatReduction);
    }

    // Relationship-based combat willingness (rule-based fallback)
    const rlt = tuning.relationship;
    if (rlt.enabled) {
      const aRel = engine.relationships[a.id];
      const bRel = engine.relationships[b.id];
      if (isFellowDisciple(aRel, bRel)) {
        aCourage *= (1 - rlt.fellowDiscipleCombatReduction);
        bCourage *= (1 - rlt.fellowDiscipleCombatReduction);
      }
      const aAllyOfB = findAlly(aRel, b.id);
      if (aAllyOfB) aCourage *= (1 - aAllyOfB.strength * 0.5);
      const bAllyOfA = findAlly(bRel, a.id);
      if (bAllyOfA) bCourage *= (1 - bAllyOfA.strength * 0.5);
      if (isRival(aRel, b.id)) aCourage *= 1.3;
      if (isRival(bRel, a.id)) bCourage *= 1.3;
      if (hasVendettaAgainst(aRel, b.id)) aCourage *= 1.5;
      if (hasVendettaAgainst(bRel, a.id)) bCourage *= 1.5;
    }
  }

  const aDefeat = bCombatPower / total;
  const bDefeat = aCombatPower / total;
  const aWantsFight = aCourage > aDefeat;
  const bWantsFight = bCourage > bDefeat;
  if (!aWantsFight && !bWantsFight) return;

  if (aWantsFight !== bWantsFight) {
    const attacker = aWantsFight ? a : b;
    const evader = aWantsFight ? b : a;
    const gap = (evader.cultivation - attacker.cultivation)
      / (evader.cultivation + attacker.cultivation);
    const terrainAdj = tuning.terrain.terrainDangerEvasionAdjust[engine.areaTags.getTerrainDanger(evader.x, evader.y)];
    const P = Math.max(0, Math.min(1, 0.5 + tuning.courage.evasionSensitivity * gap + terrainAdj));

    const evasionSucceeded = P === 0 ? false : P === 1 ? true : engine.prng() < P;
    if (evasionSucceeded) return;

    const penalized = round1(evader.cultivation * (1 - tuning.courage.evasionPenalty));
    evader.cultivation = Math.max(threshold(evader.level), penalized);

    aCombatPower = a.cultivation;
    bCombatPower = b.cultivation;
    if (a.meridianDamagedUntil > year) {
      aCombatPower *= (1 - tuning.combat.meridianCombatPenalty);
    }
    if (b.meridianDamagedUntil > year) {
      bCombatPower *= (1 - tuning.combat.meridianCombatPenalty);
    }
    total = aCombatPower + bCombatPower;
    if (total <= 0) return;
  }

  const aWins = engine.prng() < aCombatPower / total;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const winnerSnap = winner === a ? aCultSnap : bCultSnap;
  const loserSnap = loser === a ? aCultSnap : bCultSnap;
  const combatLevel = loser.level;

  const levelBase = threshold(loser.level);
  const baseLoot = levelBase * tuning.combat.lootBaseRate;
  const excess = Math.max(0, loserSnap - levelBase);
  const luck = truncatedGaussian(
    engine.prng,
    tuning.combat.luckMean,
    tuning.combat.luckStddev,
    tuning.combat.luckMin,
    tuning.combat.luckMax,
  );
  const profile = getBalanceProfile();
  const lootPenalty = Math.exp(-sigmoidContribution(combatLevel, profile.combat.lootPenalty));
  const loot = Math.max(
    0.1,
    round1((baseLoot + excess * tuning.combat.lootVariableRate * luck) * lootPenalty),
  );
  winner.cultivation += loot;

  const loserCombatPower = loser === a ? aCombatPower : bCombatPower;
  const winnerCombatPower = winner === a ? aCombatPower : bCombatPower;
  const outcomeCode = resolveDefeatOutcome(engine.prng, winnerCombatPower, loserCombatPower, loser.level);
  const outcome = OUTCOME_NAMES[outcomeCode];

  let loserDied = false;
  if (outcomeCode === 0) {
    loser.alive = false;
    loserDied = true;
    engine.combatDeaths++;
    engine.aliveCount--;
    engine._deadIds.push(loser.id);
    engine.levelGroups[loser.level].delete(loser.id);
    engine.spatialIndex.remove(loser.id, loser.level, loser.x, loser.y);
  } else {
    const arr = engine.levelArrayCache[loser.level];
    const idx = engine._levelArrayIndex[loser.id];
    if (idx !== -1) {
      const last = arr.length - 1;
      if (idx < last) {
        const movedId = arr[last];
        arr[idx] = movedId;
        engine._levelArrayIndex[movedId] = idx;
      }
      arr.pop();
      engine._levelArrayIndex[loser.id] = -1;
    }
    engine._defeatedBuf[loser.id] = 1;

    if (outcomeCode === 1) {
      engine.combatDemotions++;
      const oldLevel = loser.level;
      loser.level--;
      loser.cultivation = loser.level >= 1 ? threshold(loser.level) : 0;
      engine.levelGroups[oldLevel].delete(loser.id);
      engine.levelGroups[loser.level].add(loser.id);
      engine.spatialIndex.changeLevel(loser.id, oldLevel, loser.level, loser.x, loser.y);
    } else if (outcomeCode === 2) {
      engine.combatInjuries++;
      loser.injuredUntil = year + tuning.combat.injuryDuration;
    } else if (outcomeCode === 3) {
      engine.combatCultLosses++;
      loser.cultivation = Math.max(
        threshold(loser.level), round1(loser.cultivation * (1 - tuning.combat.defeatCultLossRate)));
    } else if (outcomeCode === 5) {
      engine.combatMeridianDamages++;
      loser.meridianDamagedUntil = year + tuning.combat.meridianDamageDuration;
    } else if (outcomeCode === 6) {
      engine.combatLightInjuries++;
      loser.lightInjuryUntil = year + tuning.combat.lightInjuryDuration;
    }

  }

  engine.hooks?.onCombatResult(winner, loser, loserDied, year);

  // Memory updates
  if (mt.enabled) {
    const wasHeavy = outcomeCode === 2; // injury
    const wasLight = outcomeCode === 6; // light_injury
    onCombatWin(engine.memories[winner.id], loser.id, loserDied, year, mt);
    if (!loserDied) {
      onCombatLoss(engine.memories[loser.id], winner.id, year, wasHeavy, wasLight, mt);
      if (wasHeavy) {
        pushPlace(engine.memories[loser.id], loser.y * MAP_SIZE + loser.x, PLACE_DANGER, year);
      }
    }
    // Greatest victory milestone (winner beat higher cultivation opponent)
    if (winnerSnap < loserSnap) {
      const wm = engine.memories[winner.id].milestones;
      if (wm.greatestVictoryYear === 0 || loserSnap > (engine.cultivators[wm.greatestVictoryOpponentId]?.cultivation ?? 0)) {
        wm.greatestVictoryYear = year;
        wm.greatestVictoryOpponentId = loser.id;
      }
    }
    // Kin killed: notify same-origin cultivators of loser (simplified: check winner's origin vs loser's origin)
    if (loserDied && loser.originSettlementId >= 0 && loser.originSettlementId === winner.originSettlementId) {
      // Loser was killed by someone from the same settlement — not a kin-kill scenario
    } else if (loserDied && loser.originSettlementId >= 0) {
      // Winner killed someone from a different settlement — loser's kin would be angry at winner
    }
  }

  // Relationship updates
  const rlt = tuning.relationship;
  if (rlt.enabled) {
    const winRel = engine.relationships[winner.id];
    if (!loserDied) {
      const loseRel = engine.relationships[loser.id];
      const wEncounters = countEncountersWith(engine.memories[winner.id], loser.id);
      if (wEncounters.total >= rlt.rivalCombatThreshold) {
        addRival(winRel, loser.id, year, rlt.rivalIntensityPerCombat);
        addRival(loseRel, winner.id, year, rlt.rivalIntensityPerCombat);
        if (events && combatLevel >= 2) {
          const wn = engine.hooks?.getName(winner.id);
          const ln = engine.hooks?.getName(loser.id);
          const re: RichRelationshipEvent = {
            type: 'relationship', year, newsRank: 'C', subtype: 'rival_formed',
            actorA: { id: winner.id, name: wn, level: winner.level },
            actorB: { id: loser.id, name: ln, level: loser.level },
            region: getRegionName(winner.x, winner.y),
          };
          events.push(re);
        }
      }
      if (outcomeCode === 1 || outcomeCode === 2) {
        addRival(loseRel, winner.id, year, rlt.rivalIntensityPerCombat);
      }
    } else {
      const loserRel = engine.relationships[loser.id];
      // Vendetta: loser's disciples
      for (let d = 0; d < 3; d++) {
        const did = loserRel.disciples[d];
        if (did >= 0 && engine.cultivators[did].alive) {
          addVendetta(engine.relationships[did], winner.id, 'killed_mentor', year);
          if (mt.enabled) engine.memories[did].grief = Math.min(1, engine.memories[did].grief + 0.6);
          if (events) {
            const dn = engine.hooks?.getName(did);
            const wn = engine.hooks?.getName(winner.id);
            const ve: RichRelationshipEvent = {
              type: 'relationship', year, newsRank: 'B', subtype: 'vendetta_declared',
              actorA: { id: did, name: dn, level: engine.cultivators[did].level },
              actorB: { id: winner.id, name: wn, level: winner.level },
              region: getRegionName(engine.cultivators[did].x, engine.cultivators[did].y),
            };
            events.push(ve);
          }
        }
      }
      // Vendetta: loser's mentor
      if (loserRel.mentor >= 0 && engine.cultivators[loserRel.mentor].alive) {
        addVendetta(engine.relationships[loserRel.mentor], winner.id, 'killed_disciple', year);
        if (mt.enabled) engine.memories[loserRel.mentor].grief = Math.min(1, engine.memories[loserRel.mentor].grief + 0.5);
        if (events) {
          const mentorChar = engine.cultivators[loserRel.mentor];
          const mn = engine.hooks?.getName(loserRel.mentor);
          const wn = engine.hooks?.getName(winner.id);
          const ve: RichRelationshipEvent = {
            type: 'relationship', year, newsRank: 'B', subtype: 'vendetta_declared',
            actorA: { id: loserRel.mentor, name: mn, level: mentorChar.level },
            actorB: { id: winner.id, name: wn, level: winner.level },
            region: getRegionName(mentorChar.x, mentorChar.y),
          };
          events.push(ve);
        }
      }
      // Vendetta: close allies
      for (let i = 0; i < 6; i++) {
        const ally = loserRel.allies[i];
        if (ally.id >= 0 && ally.strength >= rlt.closeAllyThreshold && engine.cultivators[ally.id].alive) {
          addVendetta(engine.relationships[ally.id], winner.id, 'killed_close_ally', year);
          if (mt.enabled) engine.memories[ally.id].grief = Math.min(1, engine.memories[ally.id].grief + 0.4);
          if (events) {
            const allyChar = engine.cultivators[ally.id];
            const an = engine.hooks?.getName(ally.id);
            const wn = engine.hooks?.getName(winner.id);
            const ve: RichRelationshipEvent = {
              type: 'relationship', year, newsRank: 'B', subtype: 'vendetta_declared',
              actorA: { id: ally.id, name: an, level: allyChar.level },
              actorB: { id: winner.id, name: wn, level: winner.level },
              region: getRegionName(allyChar.x, allyChar.y),
            };
            events.push(ve);
          }
        }
      }
      // Vendetta fulfilled
      if (hasVendettaAgainst(winRel, loser.id)) {
        removeRival(winRel, loser.id);
        if (events && combatLevel >= 2) {
          const wn = engine.hooks?.getName(winner.id);
          const ln = engine.hooks?.getName(loser.id);
          const re: RichRelationshipEvent = {
            type: 'relationship', year, newsRank: 'A', subtype: 'vendetta_fulfilled',
            actorA: { id: winner.id, name: wn, level: winner.level },
            actorB: { id: loser.id, name: ln, level: combatLevel },
            region: getRegionName(winner.x, winner.y),
          };
          events.push(re);
        }
      }
    }
  }

  // Combat collateral damage to both combatants' cells
  const winnerCellIdx = winner.y * MAP_SIZE + winner.x;
  const loserCellIdx = loser.y * MAP_SIZE + loser.x;
  engine.applyCombatCollateral(winnerCellIdx);
  if (loserCellIdx !== winnerCellIdx) {
    engine.applyCombatCollateral(loserCellIdx);
  }

  if (events) {
    if (combatLevel >= eventMinLevel) {
      const winnerName = engine.hooks?.getName(winner.id);
      const loserName = engine.hooks?.getName(loser.id);
      const combatEvent: RichCombatEvent = {
        type: 'combat',
        year,
        newsRank: 'C',
        winner: { id: winner.id, name: winnerName, level: combatLevel, cultivation: winnerSnap, age: winner.age, behaviorState: winner.behaviorState },
        loser: { id: loser.id, name: loserName, level: combatLevel, cultivation: loserSnap, age: loser.age, behaviorState: loser.behaviorState },
        absorbed: loot,
        outcome,
        region: getRegionName(winner.x, winner.y),
        spiritualEnergy: engine.areaTags.getSpiritualEnergy(winner.x, winner.y),
        terrainDanger: engine.areaTags.getTerrainDanger(winner.x, winner.y),
      };
      combatEvent.newsRank = scoreNewsRank(combatEvent);
      events.push(combatEvent);
    }

    if (loserDied) {
      const loserName = engine.hooks?.getName(loser.id);
      const ms = engine.milestones.checkDeath(
        combatLevel, engine.levelGroups[combatLevel].size,
        loser.id, loserName ?? '', year,
      );
      if (ms) events.push(ms);
    }
  }

  if (tryBreakthrough(engine, winner, events, 'combat')) {
    winner.cachedCourage = effectiveCourage(winner);
  }
}

function processRelationshipFormation(engine: SimulationEngine, events: EventBuffer): void {
  const tuning = getSimTuning();
  const rlt = tuning.relationship;
  const year = engine.year;
  const prng = engine.prng;

  for (let i = 0; i < engine.nextId; i++) {
    const c = engine.cultivators[i];
    if (!c.alive || c.level === 0) continue;
    if (c.behaviorState !== 'settling' && c.behaviorState !== 'wandering') continue;

    const rel = engine.relationships[i];
    const radius = tuning.spatial.encounterRadius[c.level];

    // Mentor formation: settling cultivator can take a nearby lower-level disciple
    if (c.behaviorState === 'settling' && rel.discipleCount < 3) {
      for (let lv = 1; lv < c.level - rlt.mentorLevelGap + 1; lv++) {
        const candidateId = engine.spatialIndex.findNearbyAtLevel(c.x, c.y, radius, lv, c.id);
        if (candidateId < 0) continue;
        const candidate = engine.cultivators[candidateId];
        if (!candidate.alive) continue;
        const cRel = engine.relationships[candidateId];
        if (cRel.mentor >= 0) continue;

        const memMod = tuning.memory.enabled ? engine.memories[i].rootedness * 0.5 : 0;
        if (prng() >= rlt.mentorFormChance + memMod) continue;

        setMentor(cRel, c.id, year);
        addDisciple(rel, candidateId);
        if (tuning.memory.enabled) {
          engine.memories[candidateId].gratitude = Math.min(1, engine.memories[candidateId].gratitude + 0.3);
        }

        if (events && c.level >= 2) {
          const mn = engine.hooks?.getName(c.id);
          const dn = engine.hooks?.getName(candidateId);
          const re: RichRelationshipEvent = {
            type: 'relationship', year,
            newsRank: c.level >= 4 ? 'A' : 'B',
            subtype: 'mentor_accept',
            actorA: { id: c.id, name: mn, level: c.level },
            actorB: { id: candidateId, name: dn, level: candidate.level },
            region: getRegionName(c.x, c.y),
          };
          events.push(re);
        }
        break;
      }
    }

    // Ally formation
    if (prng() >= rlt.allyFormChance) continue;
    const nearbyId = engine.spatialIndex.findNearbyAny(c.x, c.y, Math.min(radius, 3), c.id);
    if (nearbyId < 0) continue;
    const nearby = engine.cultivators[nearbyId];
    if (!nearby.alive) continue;
    const minCult = Math.min(c.cultivation, nearby.cultivation);
    const maxCult = Math.max(c.cultivation, nearby.cultivation);
    if (maxCult > 0 && minCult / maxCult < rlt.allyCultivationRatioMin) continue;
    const nRel = engine.relationships[nearbyId];
    if (hasVendettaAgainst(rel, nearbyId) || hasVendettaAgainst(nRel, c.id)) continue;
    if (isRival(rel, nearbyId)) continue;

    addAlly(rel, nearbyId, year, rlt.allyStrengthPerEncounter);
    addAlly(nRel, c.id, year, rlt.allyStrengthPerEncounter);

    if (events && c.level >= 2) {
      const an = engine.hooks?.getName(c.id);
      const bn = engine.hooks?.getName(nearbyId);
      const re: RichRelationshipEvent = {
        type: 'relationship', year, newsRank: 'C', subtype: 'ally_formed',
        actorA: { id: c.id, name: an, level: c.level },
        actorB: { id: nearbyId, name: bn, level: nearby.level },
        region: getRegionName(c.x, c.y),
      };
      events.push(re);
    }
  }
}
