function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPRNG(seed: number): () => number {
  return mulberry32(seed);
}

function prngInt(prng: () => number, min: number, max: number): number {
  return Math.floor(prng() * (max - min + 1)) + min;
}

export function truncatedGaussian(
  prng: () => number, mu: number, sigma: number, lo: number, hi: number,
): number {
  for (;;) {
    let u1 = prng();
    const u2 = prng();
    if (u1 === 0) u1 = 1 - u1;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const x = mu + sigma * z;
    if (x >= lo && x <= hi) return x;
  }
}

export function prngShuffle<T>(prng: () => number, array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = prngInt(prng, 0, i);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
