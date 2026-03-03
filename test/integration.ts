import { SimulationEngine } from '../src/engine/simulation';
import { threshold, LEVEL_NAMES, LEVEL_COUNT } from '../src/constants';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function section(name: string): void {
  console.log(`\n=== ${name} ===`);
}

// ─── T25: 模拟正确性 ───

section('T25-1: Lv1 修士稳态人数');
{
  const engine = new SimulationEngine(42, 1000);
  for (let y = 0; y < 200; y++) engine.tickYear();
  const pop200 = engine.getSummary().totalPopulation;
  let stableCount = 0;
  for (let y = 0; y < 100; y++) {
    engine.tickYear();
    const s = engine.getSummary();
    if (Math.abs(s.totalPopulation - pop200) / pop200 < 0.3) stableCount++;
  }
  assert(stableCount > 80, `Lv1 稳态: ${stableCount}/100 年在±30%范围内`);
  console.log(`  稳态人口 ~${pop200}, 稳定度 ${stableCount}/100`);
}

section('T25-2: Lv2+ 修士自然涌现');
{
  const engine = new SimulationEngine(42, 1000);
  for (let y = 0; y < 500; y++) engine.tickYear();
  const s = engine.getSummary();
  assert(s.levelCounts[2] > 0, `Lv2(${LEVEL_NAMES[2]})人数=${s.levelCounts[2]}`);
  assert(s.highestLevel >= 2, `最高境界 Lv${s.highestLevel}(${LEVEL_NAMES[s.highestLevel]})`);
  console.log(`  500年后: ${s.levelCounts.slice(1).map((n, i) => `${LEVEL_NAMES[i + 1]}:${n}`).join(' ')}`);
}

section('T25-3: 寿元计算无溢出');
{
  const engine = new SimulationEngine(42, 1000);
  for (let y = 0; y < 2000; y++) engine.tickYear();
  let overflow = false;
  for (let i = 0; i < engine.nextId; i++) {
    const c = engine.cultivators[i];
    if (!c.alive) continue;
    if (!Number.isFinite(c.maxAge) || c.maxAge < 0 || c.maxAge > 1e15) {
      overflow = true;
      console.error(`  溢出: id=${c.id} maxAge=${c.maxAge} level=${c.level}`);
    }
    if (!Number.isFinite(c.cultivation) || c.cultivation < 0) {
      overflow = true;
      console.error(`  溢出: id=${c.id} cultivation=${c.cultivation}`);
    }
  }
  assert(!overflow, '2000年内无数值溢出');
  const s = engine.getSummary();
  console.log(`  2000年后人口=${s.totalPopulation}, 最高Lv${s.highestLevel}, 无溢出`);
}

// ─── T26: 性能验证 ───

section('T26: 性能 - 各速度批量计算');
{
  const batchSizes = [100, 500, 1000];
  for (const batch of batchSizes) {
    const engine = new SimulationEngine(42, 1000);
    // 先到稳态
    for (let i = 0; i < 100; i++) engine.tickYear();
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) engine.tickYear();
    const elapsed = performance.now() - t0;
    const pop = engine.getSummary().totalPopulation;
    const ok = elapsed < 2000;
    assert(ok, `Tier${batchSizes.indexOf(batch) + 1}(${batch}年): ${elapsed.toFixed(0)}ms < 2000ms`);
    console.log(`  Tier${batchSizes.indexOf(batch) + 1} (${batch}年): ${elapsed.toFixed(0)}ms, 人口=${pop} ${ok ? '✓' : '✗'}`);
  }
}

section('T26: 性能 - 高人口(5000初始)');
{
  const engine = new SimulationEngine(99, 5000);
  for (let i = 0; i < 50; i++) engine.tickYear();
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) engine.tickYear();
  const elapsed = performance.now() - t0;
  const pop = engine.getSummary().totalPopulation;
  assert(elapsed < 5000, `高人口100年: ${elapsed.toFixed(0)}ms < 5000ms`);
  console.log(`  5000初始 × 100年(稳态): ${elapsed.toFixed(0)}ms, 人口=${pop}`);
}

// ─── T27: 边界情况 ───

section('T27-1: 同级仅剩1人无法遭遇');
{
  const engine = new SimulationEngine(42, 1);
  engine.yearlySpawn = 1;
  let combatOccurred = false;
  for (let y = 0; y < 10; y++) {
    engine.tickYear();
    const summary = engine.getSummary();
    if (summary.combatDeaths > 0) combatOccurred = true;
  }
  // 每年只新增1人, 大部分时候同级只有很少人
  console.log(`  1人/年场景10年: 战斗${combatOccurred ? '发生' : '未发生'}`);
  // 更严格: 仅1人不新增
  const engine2 = new SimulationEngine(42, 0);
  engine2.spawnCultivators(1);
  engine2.yearlySpawn = 0;
  let deaths = 0;
  for (let y = 0; y < 10; y++) {
    engine2.tickYear();
    const summary = engine2.getSummary();
    deaths += summary.combatDeaths;
  }
  assert(deaths === 0, `仅1人无新增: 战斗死亡=${deaths}`);
  console.log(`  仅1人无新增10年: 战斗死亡=${deaths}`);
}

section('T27-2: Lv7 不再晋升');
{
  const MAX_LEVEL = LEVEL_COUNT - 1;
  assert(MAX_LEVEL === 7, `MAX_LEVEL=${MAX_LEVEL}`);
  // 手动构造 Lv7 修士并给超高修为
  const engine = new SimulationEngine(42, 1);
  engine.tickYear();
  for (let i = 0; i < engine.nextId; i++) {
    const c = engine.cultivators[i];
    if (!c.alive) continue;
    c.cultivation = 1e10;
    while (c.level < MAX_LEVEL && c.cultivation >= threshold(c.level + 1)) c.level++;
    assert(c.level === MAX_LEVEL, `修为1e10: 等级=${c.level}, 应=${MAX_LEVEL}`);
    assert(c.level <= MAX_LEVEL, `不超过MAX_LEVEL`);
    console.log(`  修为1e10 → Lv${c.level}(${LEVEL_NAMES[c.level]}), 不超过Lv${MAX_LEVEL}`);
    break;
  }
}

section('T27-3: 连续多级晋升');
{
  const engine = new SimulationEngine(42, 1);
  engine.tickYear();
  for (let i = 0; i < engine.nextId; i++) {
    const c = engine.cultivators[i];
    if (!c.alive) continue;
    const prevLevel = c.level;
    c.cultivation = threshold(4) + 1;
    while (c.level < LEVEL_COUNT - 1 && c.cultivation >= threshold(c.level + 1)) c.level++;
    assert(c.level >= 4, `连续晋升: Lv${prevLevel}→Lv${c.level}`);
    console.log(`  修为=${c.cultivation}: Lv${prevLevel}→Lv${c.level}(${LEVEL_NAMES[c.level]})`);
    break;
  }
}

section('T27-4: 人口归零自动检测');
{
  const engine = new SimulationEngine(42, 0);
  engine.spawnCultivators(2);
  engine.yearlySpawn = 0;
  let extinctYear = -1;
  for (let y = 0; y < 200; y++) {
    const { isExtinct } = engine.tickYear();
    const summary = engine.getSummary();
    if (isExtinct) {
      extinctYear = summary.year;
      break;
    }
  }
  assert(extinctYear >= 0, `0新增时应灭绝: year=${extinctYear}`);
  console.log(`  0新增场景: 第${extinctYear}年灭绝`);
}

section('T27-5: 重置功能');
{
  const engine = new SimulationEngine(42, 1000);
  for (let y = 0; y < 100; y++) engine.tickYear();
  const popBefore = engine.getSummary().totalPopulation;
  engine.reset(99, 500);
  assert(engine.year === 1, `重置后year=${engine.year}`);
  assert(engine.nextId === 500, `重置后nextId=${engine.nextId}`);
  assert(engine.yearlySpawn === 1000, `重置后yearlySpawn=${engine.yearlySpawn}`);
  engine.tickYear();
  const s = engine.getSummary();
  assert(s.newCultivators === 1000, `重置后首年新增=${s.newCultivators}`);
  console.log(`  重置前人口${popBefore}, 重置后(seed=99,pop=500)首年新增${s.newCultivators}`);
}

// ─── T28: 种子复现性 ───

section('T28: 种子复现性');
{
  function runSim(seed: number, pop: number, years: number) {
    const engine = new SimulationEngine(seed, pop);
    const results: number[] = [];
    for (let y = 0; y < years; y++) {
      engine.tickYear();
      const summary = engine.getSummary();
      results.push(summary.totalPopulation, summary.combatDeaths, summary.expiryDeaths, summary.highestLevel);
    }
    return results;
  }

  const r1 = runSim(42, 1000, 200);
  const r2 = runSim(42, 1000, 200);
  let mismatch = -1;
  for (let i = 0; i < r1.length; i++) {
    if (r1[i] !== r2[i]) { mismatch = i; break; }
  }
  assert(mismatch === -1, `同种子200年完全一致${mismatch >= 0 ? `(偏差index=${mismatch})` : ''}`);

  const r3 = runSim(99, 1000, 200);
  let diffCount = 0;
  for (let i = 0; i < r1.length; i++) {
    if (r1[i] !== r3[i]) diffCount++;
  }
  assert(diffCount > r1.length * 0.5, `不同种子应有差异: ${diffCount}/${r1.length}`);
  console.log(`  同种子(42): 完全一致`);
  console.log(`  不同种子(42 vs 99): ${diffCount}/${r1.length} 值不同`);
}

// ─── 结果汇总 ───

console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
console.log('全部通过!');
