import type {
  Cultivator,
  DefeatOutcome,
  NewsRank,
  RichCombatEvent,
  RichEvent,
} from '../types';
import { gaussianContribution, getBalanceProfile, sigmoidContribution } from '../balance';
import {
  DEFEAT_CULT_LOSS_RATE,
  DEFEAT_CULT_LOSS_W,
  DEFEAT_DEATH_BASE,
  DEFEAT_DEATH_DECAY,
  DEFEAT_DEMOTION_W,
  DEFEAT_GAP_SEVERITY,
  DEFEAT_INJURY_W,
  DEFEAT_LIGHT_INJURY_W,
  DEFEAT_MAX_DEATH,
  DEFEAT_MERIDIAN_W,
  EVASION_PENALTY,
  EVASION_SENSITIVITY,
  INJURY_DURATION,
  LEVEL_COUNT,
  LIGHT_INJURY_DURATION,
  LOOT_BASE_RATE,
  LOOT_VARIABLE_RATE,
  LUCK_MAX,
  LUCK_MEAN,
  LUCK_MIN,
  LUCK_STDDEV,
  MERIDIAN_COMBAT_PENALTY,
  MERIDIAN_DAMAGE_DURATION,
  effectiveCourage,
  round1,
  threshold,
} from '../constants';
import { prngShuffle, truncatedGaussian } from './prng';
import { tryBreakthrough, type SimulationEngine } from './simulation';
import { profiler } from './profiler';

type EventBuffer = RichEvent[] | null;

const OUTCOME_NAMES: DefeatOutcome[] = [
  'death', 'demotion', 'injury', 'cult_loss',
  'cult_loss', // index 4 unused, placeholder
  'meridian_damage', 'light_injury',
];

export function scoreNewsRank(e: RichEvent): NewsRank {
  if (e.type === 'milestone') return 'S';
  if (e.type === 'tribulation') return 'S';
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
  const snapshotNk = engine._snapshotNk;
  const aliveIds = engine.aliveIds;
  snapshotNk.fill(0);
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
    snapshotNk[level] = arr.length;
    snapshotN += arr.length;
  }
  profiler.end('processEncounters.buildCache');

  if (snapshotN === 0) {
    profiler.end('processEncounters');
    return;
  }

  const encounterThresholds = engine._encounterThresholds;
  for (let level = 1; level < LEVEL_COUNT; level++) {
    encounterThresholds[level] = snapshotNk[level] / snapshotN;
  }

  profiler.start('processEncounters.buildAliveIds');
  prngShuffle(engine.prng, aliveIds);
  profiler.end('processEncounters.buildAliveIds');

  engine._defeatedBuf.fill(0);

  profiler.start('processEncounters.combatLoop');
  for (const id of aliveIds) {
    const c = engine.cultivators[id];
    if (!c.alive) continue;
    if (c.injuredUntil > engine.year || engine._defeatedBuf[id]) continue;

    const nk = snapshotNk[c.level];
    if (nk <= 1) continue;

    if (engine.prng() >= encounterThresholds[c.level]) continue;

    const arr = engine.levelArrayCache[c.level];
    if (arr.length === 0) continue;
    if (arr.length === 1 && arr[0] === c.id) continue;

    let oppId: number;
    do { oppId = arr[Math.floor(engine.prng() * arr.length)]; } while (oppId === c.id);
    const opp = engine.cultivators[oppId];
    if (!opp.alive || opp.level !== c.level) continue;

    resolveCombat(engine, c, opp, events);
  }
  profiler.end('processEncounters.combatLoop');

  profiler.end('processEncounters');
}

function resolveDefeatOutcome(
  prng: () => number,
  winnerSnap: number,
  loserSnap: number,
  loserLevel: number,
): number {
  const gap = (winnerSnap - loserSnap) / (winnerSnap + loserSnap);
  const profile = getBalanceProfile();
  const deathBoost = Math.exp(gaussianContribution(loserLevel, profile.combat.deathBoost));
  const deathChance = Math.min(DEFEAT_MAX_DEATH,
    DEFEAT_DEATH_BASE * DEFEAT_DEATH_DECAY ** loserLevel * (1 + DEFEAT_GAP_SEVERITY * gap) * deathBoost);
  if (prng() < deathChance) return 0;
  const total = DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W + DEFEAT_MERIDIAN_W + DEFEAT_DEMOTION_W;
  const r = prng();
  if (r < DEFEAT_LIGHT_INJURY_W / total) return 6;
  if (r < (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W) / total) return 2;
  if (r < (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W) / total) return 3;
  if (r < (DEFEAT_LIGHT_INJURY_W + DEFEAT_INJURY_W + DEFEAT_CULT_LOSS_W + DEFEAT_MERIDIAN_W) / total) return 5;
  return 1;
}

function resolveCombat(
  engine: SimulationEngine,
  a: Cultivator,
  b: Cultivator,
  events: EventBuffer,
): void {
  const year = engine.year;
  const aCultSnap = a.cultivation;
  const bCultSnap = b.cultivation;

  let aCombatPower = a.cultivation;
  let bCombatPower = b.cultivation;
  if (a.meridianDamagedUntil > year) {
    aCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
  }
  if (b.meridianDamagedUntil > year) {
    bCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
  }

  let total = aCombatPower + bCombatPower;
  if (total <= 0) return;
  const aCourage = a.cachedCourage;
  const bCourage = b.cachedCourage;
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
    const P = Math.max(0, Math.min(1, 0.5 + EVASION_SENSITIVITY * gap));

    const evasionSucceeded = P === 0 ? false : P === 1 ? true : engine.prng() < P;
    if (evasionSucceeded) return;

    const penalized = round1(evader.cultivation * (1 - EVASION_PENALTY));
    evader.cultivation = Math.max(threshold(evader.level), penalized);

    aCombatPower = a.cultivation;
    bCombatPower = b.cultivation;
    if (a.meridianDamagedUntil > year) {
      aCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
    }
    if (b.meridianDamagedUntil > year) {
      bCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
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
  const baseLoot = levelBase * LOOT_BASE_RATE;
  const excess = Math.max(0, loserSnap - levelBase);
  const luck = truncatedGaussian(engine.prng, LUCK_MEAN, LUCK_STDDEV, LUCK_MIN, LUCK_MAX);
  const profile = getBalanceProfile();
  const lootPenalty = Math.exp(-sigmoidContribution(combatLevel, profile.combat.lootPenalty));
  const loot = Math.max(0.1, round1((baseLoot + excess * LOOT_VARIABLE_RATE * luck) * lootPenalty));
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
    } else if (outcomeCode === 2) {
      engine.combatInjuries++;
      loser.injuredUntil = year + INJURY_DURATION;
    } else if (outcomeCode === 3) {
      engine.combatCultLosses++;
      loser.cultivation = Math.max(
        threshold(loser.level), round1(loser.cultivation * (1 - DEFEAT_CULT_LOSS_RATE)));
    } else if (outcomeCode === 5) {
      engine.combatMeridianDamages++;
      loser.meridianDamagedUntil = year + MERIDIAN_DAMAGE_DURATION;
    } else if (outcomeCode === 6) {
      engine.combatLightInjuries++;
      loser.lightInjuryUntil = year + LIGHT_INJURY_DURATION;
    }
  }

  engine.hooks?.onCombatResult(winner, loser, loserDied, year);

  if (events) {
    const winnerName = engine.hooks?.getName(winner.id);
    const loserName = engine.hooks?.getName(loser.id);

    const combatEvent: RichCombatEvent = {
      type: 'combat',
      year,
      newsRank: 'C',
      winner: { id: winner.id, name: winnerName, level: combatLevel, cultivation: winnerSnap },
      loser: { id: loser.id, name: loserName, level: combatLevel, cultivation: loserSnap },
      absorbed: loot,
      outcome,
    };
    combatEvent.newsRank = scoreNewsRank(combatEvent);
    events.push(combatEvent);

    if (loserDied) {
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
