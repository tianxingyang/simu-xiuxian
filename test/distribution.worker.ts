import { parentPort, workerData } from 'node:worker_threads';
import { SimulationEngine } from '../src/engine/simulation.ts';
import { LEVEL_COUNT } from '../src/constants';

type DistributionWorkerInput = {
  seed: number;
  totalYears: number;
  warmupYears: number;
  initialPop: number;
};

type DistributionWorkerOutput = {
  seed: number;
  sampleCount: number;
  distSums: number[];
};

function collectDistributionPartial({
  seed,
  totalYears,
  warmupYears,
  initialPop,
}: DistributionWorkerInput): DistributionWorkerOutput {
  const engine = new SimulationEngine(seed, initialPop);
  const distSums = new Array(LEVEL_COUNT).fill(0);
  let sampleCount = 0;

  for (let year = 0; year < totalYears; year++) {
    engine.tickYear(false);
    if (year < warmupYears) continue;

    const totalPopulation = engine.aliveCount;
    if (totalPopulation <= 0) continue;

    for (let level = 0; level < LEVEL_COUNT; level++) {
      distSums[level] += (engine.levelGroups[level].size / totalPopulation) * 100;
    }
    sampleCount++;
  }

  return { seed, sampleCount, distSums };
}

if (!parentPort) {
  throw new Error('distribution worker must run inside a worker thread');
}

parentPort.postMessage(collectDistributionPartial(workerData as DistributionWorkerInput));
