import type { Cultivator } from '../types';
import {
  BREAKTHROUGH_MOVE,
  ENCOUNTER_RADIUS,
  FLEE_DISTANCE,
  LEVEL_COUNT,
  MAP_MASK,
  MAP_SIZE,
  WANDER_BASE_PROB,
  WANDER_LEVEL_BONUS,
} from '../constants';
import type { SimulationEngine } from './simulation';
import { profiler } from './profiler';
import { TERRAIN_DANGER_ENCOUNTER_FACTOR } from './area-tag';

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

export function moveCultivators(engine: SimulationEngine): void {
  profiler.start('moveCultivators');
  const prng = engine.prng;
  const spatial = engine.spatialIndex;
  const tags = engine.areaTags;

  for (let i = 0; i < engine.nextId; i++) {
    const c = engine.cultivators[i];
    if (!c.alive) continue;
    if (c.reachedMaxLevelAt > 0) continue;

    const prob = WANDER_BASE_PROB + c.level * WANDER_LEVEL_BONUS;
    if (prng() >= prob) continue;

    let totalWeight = 0;
    for (let d = 0; d < 8; d++) {
      const nx = wrapCoord(c.x + DX[d]);
      const ny = wrapCoord(c.y + DY[d]);
      const w = tags.getSpiritualEnergy(nx, ny);
      _moveWeights[d] = w;
      totalWeight += w;
    }

    const r = prng() * totalWeight;
    let cumulative = 0;
    let dir = 7;
    for (let d = 0; d < 8; d++) {
      cumulative += _moveWeights[d];
      if (r < cumulative) { dir = d; break; }
    }

    const nx = wrapCoord(c.x + DX[dir]);
    const ny = wrapCoord(c.y + DY[dir]);

    spatial.remove(c.id, c.level, c.x, c.y);
    c.x = nx;
    c.y = ny;
    spatial.add(c.id, c.level, c.x, c.y);
  }
  profiler.end('moveCultivators');
}

function toroidalDelta(a: number, b: number): number {
  const half = MAP_SIZE >> 1;
  const raw = a - b;
  return ((raw % MAP_SIZE) + MAP_SIZE + half) % MAP_SIZE - half;
}

export function fleeCultivator(
  engine: SimulationEngine, c: Cultivator, fromX: number, fromY: number,
): void {
  const prng = engine.prng;
  const dist = FLEE_DISTANCE[0] + Math.floor(prng() * (FLEE_DISTANCE[1] - FLEE_DISTANCE[0] + 1));

  let dx = toroidalDelta(c.x, fromX);
  let dy = toroidalDelta(c.y, fromY);

  if (dx === 0 && dy === 0) {
    const dir = Math.floor(prng() * 8);
    dx = DX[dir];
    dy = DY[dir];
  }

  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = wrapCoord(c.x + Math.round((dx / len) * dist));
  const ny = wrapCoord(c.y + Math.round((dy / len) * dist));

  engine.spatialIndex.remove(c.id, c.level, c.x, c.y);
  c.x = nx;
  c.y = ny;
  engine.spatialIndex.add(c.id, c.level, c.x, c.y);
}

export function breakthroughMove(engine: SimulationEngine, c: Cultivator): void {
  const prng = engine.prng;
  const dist = BREAKTHROUGH_MOVE[0] + Math.floor(prng() * (BREAKTHROUGH_MOVE[1] - BREAKTHROUGH_MOVE[0] + 1));
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
  const radius = ENCOUNTER_RADIUS[c.level];
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
  for (let level = 1; level < LEVEL_COUNT; level++) {
    const radius = ENCOUNTER_RADIUS[level];
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
      const dangerFactor = TERRAIN_DANGER_ENCOUNTER_FACTOR[tags.getTerrainDanger(cx, cy)];
      _encounterProbCache[base + cellIdx] = (sameLevelCount / totalCount) * dangerFactor;
    }
  }
}

export function localEncounterProbability(c: Cultivator): number {
  return _encounterProbCache[c.level * CELLS + c.y * MAP_SIZE + c.x];
}
