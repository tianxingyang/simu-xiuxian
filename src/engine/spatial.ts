import type { Cultivator } from '../types.js';
import { getSimTuning } from '../sim-tuning.js';
import {
  LEVEL_COUNT,
  MAP_MASK,
  MAP_SIZE,
} from '../constants/index.js';
import type { SimulationEngine } from './simulation.js';
import { profiler } from './profiler.js';
import { findPlaceByType, PLACE_DANGER, PLACE_BREAKTHROUGH, type CharacterMemory } from './memory.js';

type CellSet = Set<number>;

const DX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const DY = [-1, -1, -1, 0, 0, 1, 1, 1] as const;

export function wrapCoord(v: number): number {
  return ((v % MAP_SIZE) + MAP_SIZE) & MAP_MASK;
}

const CELLS = MAP_SIZE * MAP_SIZE;

export class SpatialIndex {
  /** grid[level][y * MAP_SIZE + x] = Set<cultivatorId> */
  readonly grid: CellSet[][];
  /** levelCounts[level * CELLS + cellIdx] = count of cultivators at (level, cell) */
  private levelCounts: Int32Array;
  /** totalCounts[cellIdx] = total cultivators at cell across all levels */
  private totalCounts: Int32Array;

  constructor() {
    this.grid = SpatialIndex.createGrid();
    this.levelCounts = new Int32Array(LEVEL_COUNT * CELLS);
    this.totalCounts = new Int32Array(CELLS);
  }

  private static createGrid(): CellSet[][] {
    const g: CellSet[][] = new Array(LEVEL_COUNT);
    for (let lv = 0; lv < LEVEL_COUNT; lv++) {
      g[lv] = new Array(CELLS);
      for (let i = 0; i < CELLS; i++) g[lv][i] = new Set();
    }
    return g;
  }

  add(id: number, level: number, x: number, y: number): void {
    const idx = y * MAP_SIZE + x;
    this.grid[level][idx].add(id);
    this.levelCounts[level * CELLS + idx]++;
    this.totalCounts[idx]++;
  }

  remove(id: number, level: number, x: number, y: number): void {
    const idx = y * MAP_SIZE + x;
    this.grid[level][idx].delete(id);
    this.levelCounts[level * CELLS + idx]--;
    this.totalCounts[idx]--;
  }

  changeLevel(id: number, oldLevel: number, newLevel: number, x: number, y: number): void {
    const idx = y * MAP_SIZE + x;
    this.grid[oldLevel][idx].delete(id);
    this.grid[newLevel][idx].add(id);
    this.levelCounts[oldLevel * CELLS + idx]--;
    this.levelCounts[newLevel * CELLS + idx]++;
  }

  countNeighbors(level: number, cx: number, cy: number, radius: number): number {
    const lc = this.levelCounts;
    const base = level * CELLS;
    let count = 0;
    if (radius * 2 + 1 >= MAP_SIZE) {
      for (let i = 0; i < CELLS; i++) count += lc[base + i];
      return count;
    }
    for (let dy = -radius; dy <= radius; dy++) {
      const wy = (cy + dy + MAP_SIZE) & MAP_MASK;
      const rowBase = wy * MAP_SIZE;
      for (let dx = -radius; dx <= radius; dx++) {
        const wx = (cx + dx + MAP_SIZE) & MAP_MASK;
        count += lc[base + rowBase + wx];
      }
    }
    return count;
  }

  queryAllInRadius(cx: number, cy: number, radius: number): number {
    const tc = this.totalCounts;
    let count = 0;
    if (radius * 2 + 1 >= MAP_SIZE) {
      for (let i = 0; i < CELLS; i++) count += tc[i];
      return count;
    }
    for (let dy = -radius; dy <= radius; dy++) {
      const wy = (cy + dy + MAP_SIZE) & MAP_MASK;
      const rowBase = wy * MAP_SIZE;
      for (let dx = -radius; dx <= radius; dx++) {
        const wx = (cx + dx + MAP_SIZE) & MAP_MASK;
        count += tc[rowBase + wx];
      }
    }
    return count;
  }

  reset(): void {
    for (let lv = 0; lv < LEVEL_COUNT; lv++) {
      for (let i = 0; i < CELLS; i++) this.grid[lv][i].clear();
    }
    this.levelCounts.fill(0);
    this.totalCounts.fill(0);
  }
}

const _moveWeights = new Float64Array(8);

function moveToRandomDir(engine: SimulationEngine, c: Cultivator): void {
  const dir = Math.floor(engine.prng() * 8);
  const nx = wrapCoord(c.x + DX[dir]);
  const ny = wrapCoord(c.y + DY[dir]);
  engine.spatialIndex.remove(c.id, c.level, c.x, c.y);
  c.x = nx;
  c.y = ny;
  engine.spatialIndex.add(c.id, c.level, c.x, c.y);
}

function moveWeightedBy(
  engine: SimulationEngine, c: Cultivator,
  weightFn: (nx: number, ny: number) => number,
): void {
  let totalWeight = 0;
  for (let d = 0; d < 8; d++) {
    const w = weightFn(wrapCoord(c.x + DX[d]), wrapCoord(c.y + DY[d]));
    _moveWeights[d] = w;
    totalWeight += w;
  }
  if (totalWeight <= 0) { moveToRandomDir(engine, c); return; }
  const r = engine.prng() * totalWeight;
  let cumulative = 0;
  let dir = 7;
  for (let d = 0; d < 8; d++) {
    cumulative += _moveWeights[d];
    if (r < cumulative) { dir = d; break; }
  }
  const nx = wrapCoord(c.x + DX[dir]);
  const ny = wrapCoord(c.y + DY[dir]);
  engine.spatialIndex.remove(c.id, c.level, c.x, c.y);
  c.x = nx;
  c.y = ny;
  engine.spatialIndex.add(c.id, c.level, c.x, c.y);
}

// Manhattan distance on toroidal grid
function toroidalDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.min(dx, MAP_SIZE - dx) + Math.min(dy, MAP_SIZE - dy);
}

// Direction bias toward a target cell (higher weight for directions that reduce distance)
function homingWeight(cx: number, cy: number, tx: number, ty: number, dirIdx: number, strength: number): number {
  const nx = wrapCoord(cx + DX[dirIdx]);
  const ny = wrapCoord(cy + DY[dirIdx]);
  const curDist = toroidalDist(cx, cy, tx, ty);
  const newDist = toroidalDist(nx, ny, tx, ty);
  if (newDist < curDist) return 1 + strength;
  if (newDist > curDist) return Math.max(0.1, 1 - strength * 0.5);
  return 1;
}

export function moveCultivators(engine: SimulationEngine): void {
  profiler.start('moveCultivators');
  const prng = engine.prng;
  const tags = engine.areaTags;
  const tuning = getSimTuning();
  const mt = tuning.memory;
  const memEnabled = mt.enabled;

  for (let i = 0; i < engine.nextId; i++) {
    const c = engine.cultivators[i];
    if (!c.alive) continue;
    if (c.reachedMaxLevelAt > 0) continue;

    const state = c.behaviorState;
    if (state === 'settling') continue;

    const mem: CharacterMemory | null = memEnabled ? engine.memories[i] : null;

    if (state === 'escaping' || state === 'recuperating') {
      if (state === 'escaping' && prng() >= tuning.behavior.escapingMoveProb) continue;
      if (state === 'recuperating' && prng() >= tuning.behavior.recuperatingMoveProb) continue;

      if (mem) {
        // Homing toward origin settlement when escaping/recuperating
        const originSid = c.originSettlementId;
        const settlement = originSid >= 0 ? engine.settlements.getSettlement(originSid) : null;
        if (settlement && settlement.cells.length > 0) {
          const homeCell = settlement.cells[0];
          const hx = homeCell % MAP_SIZE;
          const hy = (homeCell - hx) / MAP_SIZE;
          moveWeightedBy(engine, c, (nx, ny) => {
            let w = 6 - tags.getTerrainDanger(nx, ny); // base: avoid danger
            // Bias toward home
            const homeDist = toroidalDist(nx, ny, hx, hy);
            const curDist = toroidalDist(c.x, c.y, hx, hy);
            if (homeDist < curDist) w *= (1 + mt.homingStrength);
            // Avoid remembered danger spots
            const dangerPlace = findPlaceByType(mem, PLACE_DANGER);
            if (dangerPlace && dangerPlace.cellIdx !== -1) {
              const dpx = dangerPlace.cellIdx % MAP_SIZE;
              const dpy = (dangerPlace.cellIdx - dpx) / MAP_SIZE;
              if (toroidalDist(nx, ny, dpx, dpy) <= 2) w *= Math.max(0.1, 1 / mt.dangerPlaceAvoidance);
            }
            return w;
          });
        } else if (state === 'escaping') {
          // No home — just flee danger, avoid remembered danger spots
          moveWeightedBy(engine, c, (nx, ny) => {
            let w = 6 - tags.getTerrainDanger(nx, ny);
            const dangerPlace = findPlaceByType(mem, PLACE_DANGER);
            if (dangerPlace && dangerPlace.cellIdx !== -1) {
              const dpx = dangerPlace.cellIdx % MAP_SIZE;
              const dpy = (dangerPlace.cellIdx - dpx) / MAP_SIZE;
              if (toroidalDist(nx, ny, dpx, dpy) <= 2) w *= Math.max(0.1, 1 / mt.dangerPlaceAvoidance);
            }
            return w;
          });
        } else {
          moveToRandomDir(engine, c);
        }
      } else {
        // No memory: original behavior
        if (state === 'escaping') {
          moveWeightedBy(engine, c, (nx, ny) => 6 - tags.getTerrainDanger(nx, ny));
        } else {
          moveToRandomDir(engine, c);
        }
      }
      continue;
    }

    if (state === 'seeking_breakthrough') {
      if (prng() >= tuning.behavior.seekingBreakthroughMoveProb) continue;
      if (mem) {
        const powerSpot = findPlaceByType(mem, PLACE_BREAKTHROUGH);
        moveWeightedBy(engine, c, (nx, ny) => {
          let w = tags.getSpiritualEnergy(nx, ny);
          // Bias toward remembered breakthrough location (power spot attraction)
          if (powerSpot && powerSpot.cellIdx !== -1) {
            const psx = powerSpot.cellIdx % MAP_SIZE;
            const psy = (powerSpot.cellIdx - psx) / MAP_SIZE;
            const spotDist = toroidalDist(nx, ny, psx, psy);
            const curDist = toroidalDist(c.x, c.y, psx, psy);
            if (spotDist < curDist) w *= (1 + mt.powerSpotAttraction);
          }
          return w;
        });
      } else {
        moveWeightedBy(engine, c, (nx, ny) => tags.getSpiritualEnergy(nx, ny));
      }
      continue;
    }

    // wandering
    const prob = tuning.spatial.wanderBaseProb + c.level * tuning.spatial.wanderLevelBonus;
    if (prng() >= prob) continue;

    if (mem && mem.bloodlust > 0.3) {
      // High bloodlust: wander toward danger
      moveWeightedBy(engine, c, (nx, ny) => {
        const danger = tags.getTerrainDanger(nx, ny);
        return 1 + danger * mt.bloodlustDangerAttraction * mem.bloodlust;
      });
    } else {
      moveToRandomDir(engine, c);
    }
  }
  profiler.end('moveCultivators');
}

export function breakthroughMove(engine: SimulationEngine, c: Cultivator): void {
  const prng = engine.prng;
  const { breakthroughMove } = getSimTuning().spatial;
  const dist = breakthroughMove[0] + Math.floor(prng() * (breakthroughMove[1] - breakthroughMove[0] + 1));
  const dir = Math.floor(prng() * 8);
  const nx = wrapCoord(c.x + DX[dir] * dist);
  const ny = wrapCoord(c.y + DY[dir] * dist);

  engine.spatialIndex.remove(c.id, c.level, c.x, c.y);
  c.x = nx;
  c.y = ny;
  engine.spatialIndex.add(c.id, c.level, c.x, c.y);
}

export function findSpatialOpponent(
  engine: SimulationEngine, c: Cultivator,
): Cultivator | null {
  const radius = getSimTuning().spatial.encounterRadius[c.level];
  const arr = engine.levelArrayCache[c.level];
  if (arr.length < 2) return null;

  const maxAttempts = Math.min(100, arr.length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const oppId = arr[Math.floor(engine.prng() * arr.length)];
    if (oppId === c.id || engine._defeatedBuf[oppId]) continue;
    const opp = engine.cultivators[oppId];
    if (!opp.alive || opp.level !== c.level) continue;
    const dx = Math.abs(c.x - opp.x);
    const dy = Math.abs(c.y - opp.y);
    if (Math.min(dx, MAP_SIZE - dx) <= radius && Math.min(dy, MAP_SIZE - dy) <= radius) return opp;
  }
  return null;
}

const _encounterProbCache = new Float64Array(LEVEL_COUNT * CELLS);
let _encounterProbCacheYear = -1;

export function buildEncounterProbCache(engine: SimulationEngine): void {
  if (_encounterProbCacheYear === engine.year) return;
  _encounterProbCacheYear = engine.year;
  _encounterProbCache.fill(0);

  const si = engine.spatialIndex;
  const tags = engine.areaTags;
  const tuning = getSimTuning();
  for (let level = 1; level < LEVEL_COUNT; level++) {
    const radius = tuning.spatial.encounterRadius[level];
    const base = level * CELLS;
    const plane = si.grid[level];
    for (let cellIdx = 0; cellIdx < CELLS; cellIdx++) {
      if (plane[cellIdx].size === 0) continue;
      const cx = cellIdx & MAP_MASK;
      const cy = cellIdx >> 5;
      const sameLevelCount = si.countNeighbors(level, cx, cy, radius);
      if (sameLevelCount <= 1) continue;
      const totalCount = si.queryAllInRadius(cx, cy, radius);
      if (totalCount === 0) continue;
      const dangerFactor = tuning.terrain.terrainDangerEncounterFactor[tags.getTerrainDanger(cx, cy)];
      _encounterProbCache[base + cellIdx] = (sameLevelCount / totalCount) * dangerFactor;
    }
  }
}

export function localEncounterProbability(c: Cultivator): number {
  return _encounterProbCache[c.level * CELLS + c.y * MAP_SIZE + c.x];
}
