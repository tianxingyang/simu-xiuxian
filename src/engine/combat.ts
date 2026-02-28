import type { Cultivator, SimEvent } from '../types';
import {
  ABSORB_RATE,
  EVENTS_PER_TICK,
  LEVEL_COUNT,
  LEVEL_NAMES,
  lifespanBonus,
  round1,
  threshold,
} from '../constants';
import { prngShuffle } from './prng';
import type { SimulationEngine } from './simulation';

const MAX_LEVEL = LEVEL_COUNT - 1;
const EMPTY_EVENTS: SimEvent[] = [];

export function processEncounters(engine: SimulationEngine, collectEvents = true): SimEvent[] {
  const snapshotNk = engine._snapshotNk;
  snapshotNk.fill(0);
  let snapshotN = 0;
  for (const [level, ids] of engine.levelGroups) {
    const arr = engine.levelArrayCache.get(level)!;
    arr.length = 0;
    if (level === 0) continue;
    snapshotNk[level] = ids.size;
    snapshotN += ids.size;
    if (ids.size > 1) for (const id of ids) arr.push(id);
  }
  if (snapshotN === 0) return EMPTY_EVENTS;

  const aliveIds = engine.aliveIds;
  aliveIds.length = 0;
  for (const c of engine.cultivators.values()) {
    if (c.alive && c.level > 0) aliveIds.push(c.id);
  }
  prngShuffle(engine.prng, aliveIds);

  let highBuf: number[] | null = null;
  let lowBuf: number[] | null = null;
  if (collectEvents) {
    highBuf = engine._highBuf;
    lowBuf = engine._lowBuf;
    highBuf.length = 0;
    lowBuf.length = 0;
  }

  for (const id of aliveIds) {
    const c = engine.cultivators.get(id)!;
    if (!c.alive) continue;

    const nk = snapshotNk[c.level];
    if (nk <= 1) continue;

    if (engine.prng() >= nk / snapshotN) continue;

    const arr = engine.levelArrayCache.get(c.level);
    if (!arr || arr.length === 0) continue;

    let oppId: number;
    do { oppId = arr[Math.floor(engine.prng() * arr.length)]; } while (oppId === c.id);
    const opp = engine.cultivators.get(oppId)!;
    if (!opp.alive || opp.level !== c.level) continue;

    resolveCombat(engine, c, opp, highBuf, lowBuf);
  }

  if (!collectEvents) return EMPTY_EVENTS;
  return materializeSelected(highBuf!, lowBuf!, engine.year, engine.prng, engine);
}

function resolveCombat(
  engine: SimulationEngine,
  a: Cultivator,
  b: Cultivator,
  highBuf: number[] | null,
  lowBuf: number[] | null,
): void {
  const total = a.cultivation + b.cultivation;
  if (total <= 0) return;
  if (a.courage <= b.cultivation / total && b.courage <= a.cultivation / total) return;

  const aWins = engine.prng() < a.cultivation / total;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;

  loser.alive = false;
  engine.combatDeaths++;
  engine.levelGroups.get(loser.level)!.delete(loser.id);

  const absorbed = round1(loser.cultivation * ABSORB_RATE);
  winner.cultivation += absorbed;

  const prevLevel = winner.level;
  while (winner.level < MAX_LEVEL && winner.cultivation >= threshold(winner.level + 1)) {
    winner.level++;
    if (winner.level === 1) winner.maxAge = 100;
    else winner.maxAge += lifespanBonus(winner.level);
    engine.promotionCounts[winner.level]++;
  }
  if (winner.level !== prevLevel) {
    engine.levelGroups.get(prevLevel)!.delete(winner.id);
    engine.levelGroups.get(winner.level)!.add(winner.id);
  }

  if (highBuf && lowBuf) {
    const combatLevel = loser.level;
    (combatLevel >= 3 ? highBuf : lowBuf).push(0, combatLevel, absorbed, 0);
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
      detail: `${LEVEL_NAMES[actorLevel]}对决，吸收修为${buf[off + 2]}`,
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
