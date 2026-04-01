# Analytical Balance Derivation

## Goal

Replace the current brute-force parameter search approach with an analytical derivation system. Instead of randomly searching ~100 parameters hoping to match a target distribution, we derive game parameters mathematically from the target distribution using birth-death process theory.

## Problem

Current approach (search-balance.ts):
- Randomly perturbs ~100 parameters
- Runs expensive simulations (~70ms/year) to evaluate each candidate
- Takes hours to find decent solutions
- Results are fragile and often regress when other parameters change
- Current preset (v2026-03-09) produces: 炼气=42%, 筑基=37.5% (inverted!)
- Root cause: breakthrough a=0.454, b=0.085 too low, lv0 breakthrough rate = 58.3%

## Approach: Semi-Markov Chain + Birth-Death Process

### Theoretical Basis

The system is a **finite-state birth-death process** (ref: MIT 6.436J, Columbia BD paper). The steady-state distribution has a closed-form solution. Given the target distribution, we can analytically derive the needed transition rates.

### Per-Level State Model

For each level L, define:

```
λ_L     = effective attempt opportunity rate (per year)
s_L     = success probability per attempt (raw breakthrough chance)
k_L     = death probability per attempt (breakthrough/tribulation death)
f_L     = 1 - s_L - k_L (survived failure probability)
τ_L     = cooldown years after survived failure
d_bg,L  = background death rate (natural + combat, excluding breakthrough death)
```

Cooldown occupancy fraction:
```
F_L = 1 / (1 + τ_L × λ_L × f_L)
```

Effective rates:
```
attemptThroughput_L = λ_L × F_L
p_L  = attemptThroughput_L × s_L          (effective breakthrough rate)
d_att,L = attemptThroughput_L × k_L       (attempt death rate)
d_L  = d_bg,L + d_att,L                   (total death rate)
```

### Steady-State Equations

```
Level 0:  A = N_0 × (p_0 + d_0)
Level L:  p_{L-1} × N_{L-1} = N_L × (p_L + d_L)
```

Target population ratios R_L = N_{L+1}/N_L:

| L→L+1 | R_L   | Meaning |
|--------|-------|---------|
| 0→1    | 0.472 | ~2 练气 per 1 筑基 |
| 1→2    | 0.350 | ~3 筑基 per 1 结丹 |
| 2→3    | 0.260 | ~4 结丹 per 1 元婴 |
| 3→4    | 0.192 | ~5 元婴 per 1 化神 |
| 4→5    | 0.142 | ~7 化神 per 1 炼虚 |
| 5→6    | 0.101 | ~10 炼虚 per 1 合体 |
| 6→7    | 0.143 | ~7 合体 per 1 大乘 |

From conservation: `p_L = R_L × (p_{L+1} + d_{L+1})`

### Key Inversion Formula

Given target p_L, solve for raw success probability s_L:

```
s_L = p_L × (1 + τ_L × λ_L × (1 - k_L)) / (λ_L × (1 + τ_L × p_L))
```

**Built-in feasibility check**: if s_L < 0 or s_L > 1 - k_L, the assumptions are inconsistent.

### Fitting to Breakthrough Formula

The existing game formula: `chance = exp(-(a + b*(2L+1) + tailPenalty(L) + gatePenalty(L)))`

Fit on log scale: `y_L = -ln(s_L) = a + b*(2L+1) + penalties`

Approach:
- Fix penalty shape locations/widths from design intent
- Fit amplitudes + a + b via bounded linear least squares
- Constraints: s monotonically decreasing, a/b >= 0, amplitudes >= 0

### Death Rate Curve Design

Decompose, don't use one monolithic curve:

```
d_bg,L = d_nat,L + d_combat,L
d_nat,L = 1 / T_life(L)                          (natural death from lifespan)
d_combat,L = c_floor + c0 × exp(-γ × L)          (combat death, decreasing with level)
```

T_life(L) comes from the lifespan table (design/lore driven).

### Attempt Frequency Model

```
λ_L = readinessRate_L × willingness_L × terrainAccess_L
```

- readinessRate: ~1/E[time to fill cultivation threshold]
- willingness: courage/behavior factor
- terrainAccess: spatial gating factor

Calibrate from short simulation measurement, not guesswork.

### Feedback Loop Handling

Fixed-point iteration with damping:

```
1. Assume d_bg,L and λ_L (initial estimates)
2. Derive target p_L from steady-state equations
3. Invert to get s_L
4. Fit formula params (a, b, penalties)
5. Run short validation sim, measure empirical d_bg,L and λ_L
6. Damp-update: x_new = 0.7 × x_old + 0.3 × x_measured
7. Repeat until convergence (expect 2-4 iterations)
```

## Implementation Plan

### Phase 1: Instrumentation (~1h)

Add measurement hooks to the simulation engine to collect per-level:
- Attempt count per year (→ λ_L)
- Cooldown occupancy fraction (→ F_L)
- Background death count (combat + natural → d_bg,L)
- Breakthrough death count (→ k_L)
- Breakthrough success count (→ s_L empirical)

Output: per-level rate table from a short sim run.

### Phase 2: Steady-State Solver (~2h)

`scripts/derive-params.ts`:
- Input: target distribution, lifespan table, combat death model, cooldown config, measured λ/d_bg
- Processing:
  1. Compute R_L from target
  2. Compute d_bg,L from death model
  3. Solve recurrence top-down: p_L = R_L × (p_{L+1} + d_{L+1})
  4. Invert each p_L to s_L
  5. Fit breakthrough formula params via bounded least squares
  6. Feasibility check at every step
- Output: JSON preset (BalanceProfile + SimTuning) + diagnostics + fit residuals

### Phase 3: Calibration Loop (~30min)

`scripts/calibrate-balance.ts`:
- derive → short sim (500 years) → measure rates → re-derive
- Damped iteration, expect 2-4 rounds
- Output: calibrated preset

### Phase 4: Validation (~30min)

Use existing search-balance.ts in evaluation mode:
```
npx tsx scripts/search-balance.ts --base=<derived-preset> --iterations=1 --refinements=0
```

Demote search-balance.ts to:
- Sensitivity analysis
- Local stress test around derived preset
- NOT primary optimizer

## Acceptance Criteria

- [ ] derive-params.ts computes theoretical s_L from target distribution
- [ ] Feasibility check passes for all 8 levels (no impossible rates)
- [ ] Calibration loop converges within 4 iterations
- [ ] Generated parameters produce 炼气 > 筑基 (basic sanity)
- [ ] All 8 levels have non-zero population in validation
- [ ] Score < 200 (search-balance evaluation) without manual search
- [ ] Total derivation + validation time < 10 minutes (vs hours for search)

## References

- [MIT 6.436J Lecture 26: Birth-death processes](https://dspace.mit.edu/bitstream/handle/1721.1/121170/6-436j-fall-2008/contents/lecture-notes/MIT6_436JF08_lec26.pdf)
- [Columbia: Using BD to estimate steady-state distribution](http://www.columbia.edu/~ww2040/UsingBD.pdf)
- [Wikipedia: Birth-death process](https://en.wikipedia.org/wiki/Birth%E2%80%93death_process)
- [Evolutionary Game Theory and Population Dynamics](https://www.mimuw.edu.pl/~miekisz/cime.pdf)
