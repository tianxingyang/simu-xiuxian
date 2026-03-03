import type { Cultivator, SimEvent } from '../types';
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
  EVENTS_PER_TICK,
  INJURY_DURATION,
  LEVEL_COUNT,
  LEVEL_NAMES,
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
  lifespanBonus,
  round1,
  threshold,
} from '../constants';
import { prngShuffle, truncatedGaussian } from './prng';
import type { SimulationEngine } from './simulation';
import { profiler } from './profiler';

const MAX_LEVEL = LEVEL_COUNT - 1;
const EMPTY_EVENTS: SimEvent[] = [];
const OUTCOME_SUFFIX = ['', '，败者跌境', '，败者重伤', '，败者损失修为', '', '，败者经脉受损', '，败者轻伤'];

export function processEncounters(engine: SimulationEngine, collectEvents = true): SimEvent[] {
  profiler.start('processEncounters');

  profiler.start('processEncounters.buildCache');
  const snapshotNk = engine._snapshotNk;
  snapshotNk.fill(0);
  let snapshotN = 0;
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const ids = engine.levelGroups[level];
    const arr = engine.levelArrayCache[level];
    arr.length = 0;
    if (level === 0) continue;
    for (const id of ids) {
      const c = engine.cultivators[id];
      if (c.injuredUntil > engine.year) continue;
      arr.push(id);
    }
    snapshotNk[level] = arr.length;
    snapshotN += arr.length;
  }
  profiler.end('processEncounters.buildCache');

  if (snapshotN === 0) {
    profiler.end('processEncounters');
    return EMPTY_EVENTS;
  }

  profiler.start('processEncounters.buildAliveIds');
  const aliveIds = engine.aliveIds;
  aliveIds.length = 0;
  for (let level = 1; level < LEVEL_COUNT; level++) {
    for (const id of engine.aliveLevelIds[level]) {
      aliveIds.push(id);
    }
  }
  prngShuffle(engine.prng, aliveIds);
  profiler.end('processEncounters.buildAliveIds');

  let highBuf: number[] | null = null;
  let lowBuf: number[] | null = null;
  if (collectEvents) {
    highBuf = engine._highBuf;
    lowBuf = engine._lowBuf;
    highBuf.length = 0;
    lowBuf.length = 0;
  }

  const defeatedSet = new Set<number>();

  profiler.start('processEncounters.combatLoop');
  for (const id of aliveIds) {
    const c = engine.cultivators[id];
    if (!c.alive) continue;
    if (c.injuredUntil > engine.year || defeatedSet.has(id)) continue;

    const nk = snapshotNk[c.level];
    if (nk <= 1) continue;

    if (engine.prng() >= nk / snapshotN) continue;

    const arr = engine.levelArrayCache[c.level];
    if (arr.length === 0) continue;
    if (arr.length === 1 && arr[0] === c.id) continue;

    let oppId: number;
    do { oppId = arr[Math.floor(engine.prng() * arr.length)]; } while (oppId === c.id);
    const opp = engine.cultivators[oppId];
    if (!opp.alive || opp.level !== c.level) continue;

    resolveCombat(engine, c, opp, highBuf, lowBuf, defeatedSet);
  }
  profiler.end('processEncounters.combatLoop');

  if (!collectEvents) {
    profiler.end('processEncounters');
    return EMPTY_EVENTS;
  }

  profiler.start('processEncounters.materialize');
  const result = materializeSelected(highBuf!, lowBuf!, engine.year, engine.prng, engine);
  profiler.end('processEncounters.materialize');

  profiler.end('processEncounters');
  return result;
}

function resolveDefeatOutcome(
  prng: () => number,
  winnerSnap: number,
  loserSnap: number,
  loserLevel: number,
): number {
  const gap = (winnerSnap - loserSnap) / (winnerSnap + loserSnap);
  const deathChance = Math.min(DEFEAT_MAX_DEATH,
    DEFEAT_DEATH_BASE * DEFEAT_DEATH_DECAY ** loserLevel * (1 + DEFEAT_GAP_SEVERITY * gap));
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
  highBuf: number[] | null,
  lowBuf: number[] | null,
  defeatedSet: Set<number>,
): void {
  const aCultSnap = a.cultivation;
  const bCultSnap = b.cultivation;

  let aCombatPower = a.cultivation;
  let bCombatPower = b.cultivation;
  if (a.meridianDamagedUntil > engine.year) {
    aCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
  }
  if (b.meridianDamagedUntil > engine.year) {
    bCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
  }

  let total = aCombatPower + bCombatPower;
  if (total <= 0) return;
  const aCourage = effectiveCourage(a);
  const bCourage = effectiveCourage(b);
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
    if (a.meridianDamagedUntil > engine.year) {
      aCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
    }
    if (b.meridianDamagedUntil > engine.year) {
      bCombatPower *= (1 - MERIDIAN_COMBAT_PENALTY);
    }
    total = aCombatPower + bCombatPower;
  }

  const aWins = engine.prng() < aCombatPower / total;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;

  const loserSnap = loser === a ? aCultSnap : bCultSnap;
  const levelBase = threshold(loser.level);
  const baseLoot = levelBase * LOOT_BASE_RATE;
  const excess = Math.max(0, loserSnap - levelBase);
  const luck = truncatedGaussian(engine.prng, LUCK_MEAN, LUCK_STDDEV, LUCK_MIN, LUCK_MAX);
  const loot = Math.max(0.1, round1(baseLoot + excess * LOOT_VARIABLE_RATE * luck));
  winner.cultivation += loot;

  const combatLevel = loser.level;
  const loserCombatPower = loser === a ? aCombatPower : bCombatPower;
  const winnerCombatPower = winner === a ? aCombatPower : bCombatPower;
  const outcome = resolveDefeatOutcome(engine.prng, winnerCombatPower, loserCombatPower, loser.level);

  if (outcome === 0) {
    loser.alive = false;
    engine.combatDeaths++;
    engine.aliveCount--;
    engine._deadIds.push(loser.id);
    engine.levelGroups[loser.level].delete(loser.id);
    engine.aliveLevelIds[loser.level].delete(loser.id);
  } else {
    const arr = engine.levelArrayCache[loser.level];
    const idx = arr.indexOf(loser.id);
    if (idx !== -1) { arr[idx] = arr[arr.length - 1]; arr.pop(); }
    defeatedSet.add(loser.id);

    if (outcome === 1) {
      engine.combatDemotions++;
      const oldLevel = loser.level;
      loser.level--;
      loser.cultivation = loser.level >= 1 ? threshold(loser.level) : 0;
      engine.levelGroups[oldLevel].delete(loser.id);
      engine.levelGroups[loser.level].add(loser.id);
      engine.aliveLevelIds[oldLevel].delete(loser.id);
      engine.aliveLevelIds[loser.level].add(loser.id);
    } else if (outcome === 2) {
      engine.combatInjuries++;
      loser.injuredUntil = engine.year + INJURY_DURATION;
    } else if (outcome === 3) {
      engine.combatCultLosses++;
      loser.cultivation = Math.max(
        threshold(loser.level), round1(loser.cultivation * (1 - DEFEAT_CULT_LOSS_RATE)));
    } else if (outcome === 5) {
      engine.combatMeridianDamages++;
      loser.meridianDamagedUntil = engine.year + MERIDIAN_DAMAGE_DURATION;
    } else if (outcome === 6) {
      engine.combatLightInjuries++;
      loser.lightInjuryUntil = engine.year + LIGHT_INJURY_DURATION;
    }
  }

  const prevLevel = winner.level;
  while (winner.level < MAX_LEVEL && winner.cultivation >= threshold(winner.level + 1)) {
    winner.level++;
    if (winner.level === 1) winner.maxAge = 100;
    else winner.maxAge += lifespanBonus(winner.level);
    engine.promotionCounts[winner.level]++;
  }
  if (winner.level !== prevLevel) {
    engine.levelGroups[prevLevel].delete(winner.id);
    engine.levelGroups[winner.level].add(winner.id);
    engine.aliveLevelIds[prevLevel].delete(winner.id);
    engine.aliveLevelIds[winner.level].add(winner.id);
  }

  if (highBuf && lowBuf) {
    (combatLevel >= 3 ? highBuf : lowBuf).push(0, combatLevel, loot, outcome);
    if (winner.level !== prevLevel) {
      (winner.level >= 3 ? highBuf : lowBuf).push(1, winner.level, prevLevel, winner.level);
    }
  }
}

function shuffleStride4(prng: () => number, buf: number[]): void {
  const n = buf.length >> 2;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const ii = i << 2, jj = j << 2;
    for (let k = 0; k < 4; k++) {
      const tmp = buf[ii + k];
      buf[ii + k] = buf[jj + k];
      buf[jj + k] = tmp;
    }
  }
}

function materialize(buf: number[], off: number, year: number, engine: SimulationEngine): SimEvent {
  const actorLevel = buf[off + 1];
  if (buf[off] === 0) {
    return {
      id: engine.nextEventId++,
      year,
      type: 'combat',
      actorLevel,
      detail: `${LEVEL_NAMES[actorLevel]}对决，获得机缘${buf[off + 2]}${OUTCOME_SUFFIX[buf[off + 3]]}`,
    };
  }
  return {
    id: engine.nextEventId++,
    year,
    type: 'promotion',
    actorLevel,
    detail: `${LEVEL_NAMES[buf[off + 2]]}→${LEVEL_NAMES[buf[off + 3]]}（战斗晋升）`,
  };
}

function materializeSelected(
  highBuf: number[],
  lowBuf: number[],
  year: number,
  prng: () => number,
  engine: SimulationEngine,
): SimEvent[] {
  const highCount = highBuf.length >> 2;

  if (highCount >= EVENTS_PER_TICK) {
    shuffleStride4(prng, highBuf);
    const result: SimEvent[] = [];
    for (let i = 0; i < EVENTS_PER_TICK; i++) result.push(materialize(highBuf, i << 2, year, engine));
    return result;
  }

  const result: SimEvent[] = [];
  for (let i = 0; i < highCount; i++) result.push(materialize(highBuf, i << 2, year, engine));

  const remaining = EVENTS_PER_TICK - highCount;
  const lowCount = lowBuf.length >> 2;
  if (lowCount <= remaining) {
    for (let i = 0; i < lowCount; i++) result.push(materialize(lowBuf, i << 2, year, engine));
    return result;
  }

  shuffleStride4(prng, lowBuf);
  for (let i = 0; i < remaining; i++) result.push(materialize(lowBuf, i << 2, year, engine));
  return result;
}
