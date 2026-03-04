/**
 * 性能基准测试脚本
 * 直接在 Node.js 环境运行，无需浏览器
 */

import { SimulationEngine } from './simulation.js';
import { profiler } from './profiler.js';

// 模拟 performance.now()
if (typeof performance === 'undefined') {
  (global as any).performance = {
    now: () => Date.now(),
  };
}

function runBenchmark(years: number, initialPop: number, seed = 42): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Benchmark: ${years} years, initial population ${initialPop}, seed ${seed}`);
  console.log('='.repeat(80));

  const engine = new SimulationEngine(seed, initialPop);

  profiler.reset();
  profiler.enable();

  const startTime = performance.now();

  for (let i = 0; i < years; i++) {
    engine.tickYear();

    if (i % 100 === 0 || i === years - 1) {
      engine.getSummary();
    }
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;

  profiler.disable();

  console.log(`\nTotal time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average per year: ${(totalTime / years).toFixed(3)}ms`);
  console.log(`Final population: ${engine.aliveCount}`);
  console.log(`Final year: ${engine.year}`);

  profiler.printResults();
}

// 运行多个场景
console.log('\n🔥 Performance Benchmark Suite\n');

// 场景1：早期（人口较少）
runBenchmark(1000, 1000, 42);

// 场景2：中期（人口增长）
runBenchmark(1000, 5000, 42);

// 场景3：后期（人口稳定）
const engine = new SimulationEngine(42, 1000);
for (let i = 0; i < 5000; i++) {
  engine.tickYear();
}
console.log(`\nWarming up to year ${engine.year}, population ${engine.aliveCount}...`);
runBenchmark(1000, 0, 42);
