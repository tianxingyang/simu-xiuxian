# 角色智能决策系统（RL）

## Goal

用 RL 训练小型神经网络替换当前硬编码规则系统 `evaluateBehaviorStates()`，使修仙者角色能根据环境输入产生涌现式智慧行为。配置驱动架构，方便未来扩展输入/行动维度。

## Requirements

- Python 侧：简化版模拟引擎 + stable-baselines3 训练管线
- TS 侧：零依赖通用 MLP 前向传播推理，从 config 读取网络结构
- 单一 `config.json` 同时驱动训练和推理，定义 features / actions / rewards / network
- 权重导出为 JSON，内嵌版本号，TS 侧加载时校验版本
- 模型加载失败时 fallback 到当前规则系统

## Acceptance Criteria

- [ ] Python 训练环境能独立运行，产出权重 JSON
- [ ] TS 推理能加载权重并对每个 cultivator 输出行为概率分布
- [ ] 推理性能 <1ms / 1000 角色
- [ ] config.json 新增 feature/action 后，只需两侧各加一行取值逻辑 + 重训练
- [ ] fallback：权重缺失或版本不匹配时退回规则系统，模拟不中断
- [ ] 训练出的策略在模拟中行为合理（不全逃跑、不全送死）

## Definition of Done

- 训练脚本可运行，产出可用权重
- TS 推理集成到 SimulationEngine，可切换 RL / 规则模式
- lint / typecheck 通过
- benchmark 验证性能无回退

## Decisions (ADR)

### D1: 技术路线 → RL 自训练
- **Context**: 需要涌现式智慧行为，不满足于模仿规则
- **Decision**: 离线 Python RL 训练 + 在线 TS 推理
- **Consequences**: 前期投入大（Python 训练环境），但行为质量上限高

### D2: 奖励函数 → 综合加权
- **Context**: 单一目标（纯生存/纯成长）会产生极端行为
- **Decision**: 多维奖励加权：存活 + 修为增长 + 突破 + 战斗胜利 + 伤害惩罚 + 死亡惩罚
- **Consequences**: 调参空间大，但可用 config 管理权重

### D3: 训练环境 → Python 简化版引擎
- **Context**: TS↔Python 桥接通信开销大，训练速度慢
- **Decision**: Python 重写核心机制（修炼/突破/战斗/移动/死亡），~300-500 行
- **Consequences**: 需维护两套逻辑，但训练速度快、和 Gymnasium 对接简单

### D4: 推理运行时 → 纯 TS 手写 forward()
- **Context**: ONNX Runtime ~50-100MB 依赖，brain.js 无法直接导入 PyTorch 权重
- **Decision**: 手写 ~20 行通用 MLP forward pass，从 JSON 加载权重
- **Consequences**: 零依赖，微秒级推理，完全可控

### D5: 架构 → 配置驱动
- **Context**: 未来会新增门派、社交、装备等输入维度和行动类型
- **Decision**: 单一 config.json 定义 features/actions/rewards/network，两端共读
- **Consequences**: 扩展时只需改 config + 两侧各加取值逻辑 + 重训练

## Technical Design

### 目录结构

```
ai-policy/
├── config.json              # 唯一配置源
├── weights/
│   └── v1.json              # 训练产物（权重 + config version）
├── train/                   # Python 训练环境
│   ├── env.py               # Gymnasium 环境（简化版引擎，读 config）
│   ├── train.py             # stable-baselines3 PPO 训练
│   └── export.py            # 导出权重为 JSON
└── README.md

src/engine/
├── ai-policy.ts             # 通用推理：读 config → 读 weights → forward()
└── ai-state-extract.ts      # extractState(cultivator, cell) → number[]
```

### config.json 结构

```jsonc
{
  "version": 1,
  "features": [
    { "name": "remaining_lifespan_ratio", "source": "derived", "range": [0, 1] },
    { "name": "cultivation_progress",     "source": "derived", "range": [0, 1] },
    { "name": "level_normalized",         "source": "derived", "range": [0, 1] },
    { "name": "courage",                  "source": "field",   "range": [0, 1] },
    { "name": "is_heavy_injured",         "source": "derived", "range": [0, 1] },
    { "name": "is_light_injured",         "source": "derived", "range": [0, 1] },
    { "name": "is_meridian_damaged",      "source": "derived", "range": [0, 1] },
    { "name": "breakthrough_ready",       "source": "derived", "range": [0, 1] },
    { "name": "spiritual_energy",         "source": "cell",    "range": [0, 1] },
    { "name": "danger_level",             "source": "cell",    "range": [0, 1] },
    { "name": "breakthrough_cooldown",    "source": "derived", "range": [0, 1] },
    { "name": "age_ratio",                "source": "derived", "range": [0, 1] }
  ],
  "actions": [
    "wandering",
    "seeking_breakthrough",
    "settling",
    "escaping",
    "recuperating"
  ],
  "rewards": [
    { "event": "survive_year",     "weight": 1.0 },
    { "event": "cultivation_gain", "weight": 2.0 },
    { "event": "breakthrough",     "weight": 100.0, "scale_by": "level" },
    { "event": "combat_win",       "weight": 10.0 },
    { "event": "heavy_injury",     "weight": -5.0 },
    { "event": "death",            "weight": -50.0 }
  ],
  "network": {
    "hidden": [32, 16],
    "activation": "relu"
  }
}
```

### 状态空间（12 维，全部归一化到 [0, 1]）

| # | Feature | 来源 | 归一化方式 |
|---|---------|------|-----------|
| 0 | remaining_lifespan_ratio | (maxAge - age) / maxAge | 直接 |
| 1 | cultivation_progress | cultivation / threshold(level+1) | clamp [0,1] |
| 2 | level_normalized | level / 7 | 直接 |
| 3 | courage | cultivator.courage | 已在 [0,1] |
| 4 | is_heavy_injured | injuredUntil > year ? 1 : 0 | 布尔 |
| 5 | is_light_injured | lightInjuryUntil > year ? 1 : 0 | 布尔 |
| 6 | is_meridian_damaged | meridianDamagedUntil > year ? 1 : 0 | 布尔 |
| 7 | breakthrough_ready | cultivation >= threshold && !cooldown ? 1 : 0 | 布尔 |
| 8 | spiritual_energy | cell.spiritualEnergy / 5 | 归一化 |
| 9 | danger_level | cell.danger / 5 | 归一化 |
| 10 | breakthrough_cooldown | cooldown > 0 ? remaining/max : 0 | 归一化 |
| 11 | age_ratio | age / maxAge | 直接 |

### 网络架构

```
Input(12) → Dense(32, ReLU) → Dense(16, ReLU) → Dense(5, Softmax)
```

参数量：12×32 + 32 + 32×16 + 16 + 16×5 + 5 = 1013 个浮点数

### TS 推理核心（~30 行）

```typescript
// ai-policy.ts（伪代码）
interface PolicyConfig { version: number; features: Feature[]; actions: string[]; network: { hidden: number[] } }
interface PolicyWeights { version: number; layers: { w: number[][]; b: number[] }[] }

function forward(input: number[], weights: PolicyWeights): number[] {
  let x = input
  for (let i = 0; i < weights.layers.length - 1; i++) {
    const { w, b } = weights.layers[i]
    x = b.map((bj, j) => bj + x.reduce((s, xi, k) => s + xi * w[k][j], 0))
    x = x.map(v => Math.max(0, v)) // ReLU
  }
  // 最后一层 softmax
  const last = weights.layers.at(-1)!
  x = last.b.map((bj, j) => bj + x.reduce((s, xi, k) => s + xi * last.w[k][j], 0))
  const maxVal = Math.max(...x)
  const exp = x.map(v => Math.exp(v - maxVal))
  const sum = exp.reduce((a, b) => a + b)
  return exp.map(v => v / sum)
}
```

## Out of Scope

- 多智能体协作（角色间通信）
- 在线学习（运行时继续训练）
- GPU 推理
- 前端可视化训练过程

## Implementation Plan

- PR1: 基础设施 — config.json + TS 推理管线 (ai-policy.ts, ai-state-extract.ts) + fallback 机制
- PR2: Python 训练环境 — 简化版引擎 env.py + train.py + export.py
- PR3: 集成 — 训练首版模型 + 集成到 SimulationEngine + benchmark 验证
