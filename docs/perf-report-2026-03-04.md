# 性能测试报告（2026-03-04）

## 目标
你提出了明确要求：`getSummary()` 至少 **20%** 性能提升。为此，本次对比：

- **基线版本**：`5b61985`（上一版“缓冲复用”优化）
- **当前版本**：`HEAD`（本次新增 `getSummary` 中位数算法优化）

## 本次优化点
核心改动：将 `getSummary()` 中的中位数计算从“全量排序”改为“快速选择（Quickselect）”。

- 旧实现：`median(arr)` 内部 `arr.sort((a, b) => a - b)`，时间复杂度约 `O(n log n)`。
- 新实现：
  - `quickselect(arr, k)` 找到第 `k` 小值，平均 `O(n)`；
  - 奇数长度只选一次；偶数长度选两次取均值。

这直接降低了 `getSummary()` 在高人口下的统计开销（尤其是每个境界分组的中位数求解）。

## 测试环境与参数
- Node.js + `tsx`
- 同机对比（同一环境、同一 seed）
- 参数：
  - `SEED=42`
  - `INITIAL=5000`
  - `WARMUP=400`
  - `ROUNDS=1200`
  - `REPEATS=5`

> 说明：只测试 `getSummary()`，因为目标是该函数的性能达标。

## 测试命令
在两个版本分别执行完全相同命令：

```bash
node --import tsx -e "import { SimulationEngine } from './src/engine/simulation.ts'; const SEED=42, INITIAL=5000, WARMUP=400, ROUNDS=1200, REPEATS=5; function runOnce(){ const e=new SimulationEngine(SEED,INITIAL); for(let i=0;i<WARMUP;i++) e.tickYear(); const pop=e.aliveCount; let t0=performance.now(); for(let i=0;i<ROUNDS;i++) e.getSummary(); const summaryMs=(performance.now()-t0)/ROUNDS; return {summaryMs,pop,year:e.year}; } const rs=[]; for(let i=0;i<REPEATS;i++) rs.push(runOnce()); const avg=rs.reduce((s,r)=>s+r.summaryMs,0)/rs.length; const med=[...rs].map(r=>r.summaryMs).sort((a,b)=>a-b)[Math.floor(rs.length/2)]; console.log(JSON.stringify({params:{SEED,INITIAL,WARMUP,ROUNDS,REPEATS},results:rs,avg,med}));"
```

## 结果

### 基线（`5b61985`）
- avg: **12.0682 ms/iter**
- median: **12.0801 ms/iter**

### 当前（`HEAD`）
- avg: **2.5154 ms/iter**
- median: **2.5989 ms/iter**

## 提升幅度
按 avg 计算：

\[
\text{speedup} = \frac{12.0682 - 2.5154}{12.0682} \approx 79.16\%
\]

即：`getSummary()` **约提升 79.2%**，远超 20% 目标。

## 结论
- 本次优化已满足并显著超过“`getSummary()` 至少 20% 提升”的要求。
- 优化主要来自中位数计算算法降复杂度（排序 -> Quickselect）。
