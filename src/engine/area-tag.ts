import { MAP_SIZE } from '../constants/index.js';
import { createPRNG } from './prng.js';

export type AreaTagType = 'spiritualEnergy' | 'terrainDanger';

const CELLS = MAP_SIZE * MAP_SIZE;
const AREA_TAG_MIN = 1;
const AREA_TAG_MAX = 5;
const NOISE_GRID_SIZE = 8;
const NOISE_GRID_MASK = NOISE_GRID_SIZE - 1;
const SEED_OFFSET_TERRAIN = 0x5f3759df;


function clampTag(v: number): number {
  return v < AREA_TAG_MIN ? AREA_TAG_MIN : v > AREA_TAG_MAX ? AREA_TAG_MAX : v;
}

function generateNoiseGrid(seed: number): Float64Array {
  const prng = createPRNG(seed);
  const grid = new Float64Array(NOISE_GRID_SIZE * NOISE_GRID_SIZE);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = prng();
  }
  return grid;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function sampleNoise(noiseGrid: Float64Array, x: number, y: number): number {
  const cellSize = MAP_SIZE / NOISE_GRID_SIZE;
  const gx = x / cellSize;
  const gy = y / cellSize;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = smoothstep(gx - ix);
  const fy = smoothstep(gy - iy);

  const x0 = ix & NOISE_GRID_MASK;
  const x1 = (ix + 1) & NOISE_GRID_MASK;
  const y0 = iy & NOISE_GRID_MASK;
  const y1 = (iy + 1) & NOISE_GRID_MASK;

  const v00 = noiseGrid[y0 * NOISE_GRID_SIZE + x0];
  const v10 = noiseGrid[y0 * NOISE_GRID_SIZE + x1];
  const v01 = noiseGrid[y1 * NOISE_GRID_SIZE + x0];
  const v11 = noiseGrid[y1 * NOISE_GRID_SIZE + x1];

  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

function noiseToTag(noise: number): number {
  const raw = Math.floor(noise * 5) + 1;
  return clampTag(raw);
}

export class AreaTagSystem {
  private spiritualEnergy: Int8Array;
  private terrainDanger: Int8Array;

  constructor() {
    this.spiritualEnergy = new Int8Array(CELLS);
    this.terrainDanger = new Int8Array(CELLS);
  }

  generate(seed: number): void {
    const seGrid = generateNoiseGrid(seed);
    const tdGrid = generateNoiseGrid(seed ^ SEED_OFFSET_TERRAIN);

    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const idx = y * MAP_SIZE + x;
        this.spiritualEnergy[idx] = noiseToTag(sampleNoise(seGrid, x, y));
        this.terrainDanger[idx] = noiseToTag(sampleNoise(tdGrid, x, y));
      }
    }
  }

  get(x: number, y: number, tag: AreaTagType): number {
    const idx = y * MAP_SIZE + x;
    return tag === 'spiritualEnergy'
      ? this.spiritualEnergy[idx]
      : this.terrainDanger[idx];
  }

  set(x: number, y: number, tag: AreaTagType, value: number): void {
    const idx = y * MAP_SIZE + x;
    const clamped = clampTag(Math.round(value));
    if (tag === 'spiritualEnergy') {
      this.spiritualEnergy[idx] = clamped;
    } else {
      this.terrainDanger[idx] = clamped;
    }
  }

  modify(x: number, y: number, tag: AreaTagType, delta: number): void {
    const current = this.get(x, y, tag);
    this.set(x, y, tag, current + delta);
  }

  getSpiritualEnergy(x: number, y: number): number {
    return this.spiritualEnergy[y * MAP_SIZE + x];
  }

  getTerrainDanger(x: number, y: number): number {
    return this.terrainDanger[y * MAP_SIZE + x];
  }

  reset(): void {
    this.spiritualEnergy.fill(0);
    this.terrainDanger.fill(0);
  }

  serializeSize(): number {
    return CELLS * 2;
  }

  serializeTo(dv: DataView, off: number): number {
    for (let i = 0; i < CELLS; i++) {
      dv.setInt8(off, this.spiritualEnergy[i]); off += 1;
    }
    for (let i = 0; i < CELLS; i++) {
      dv.setInt8(off, this.terrainDanger[i]); off += 1;
    }
    return off;
  }

  static deserializeFrom(dv: DataView, off: number): { system: AreaTagSystem; offset: number } {
    const system = new AreaTagSystem();
    for (let i = 0; i < CELLS; i++) {
      system.spiritualEnergy[i] = dv.getInt8(off); off += 1;
    }
    for (let i = 0; i < CELLS; i++) {
      system.terrainDanger[i] = dv.getInt8(off); off += 1;
    }
    return { system, offset: off };
  }
}
