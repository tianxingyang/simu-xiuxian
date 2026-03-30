# Settlement Level Display Issue

## Problem

Web UI only shows two settlement types: "村落" (hamlet) and "城" (city).
The system defines 4 levels but "村庄" (village) and "镇" (town) are missing from the display.

## Root Cause

Simulation logic issue in `simulation.ts:570-583`: **every household split creates a new settlement**.

A settlement's households grow to splitThreshold (50), then ALL split out to create new settlements
in the same tick. The settlement goes to 0 pop and gets pruned. `recountTypes` runs after splits,
so village/town states are never observed.

Settlement lifecycle:
1. Created with 5 households (50 pop) = hamlet
2. ~78 years later, all 5 reach 50, total ~250 (village level)
3. Same tick: all 5 split OUT, creating 5 new settlements
4. Original settlement pruned (0 pop)
5. recountTypes sees only hamlets and occasional cities

## Fix

When a household **already belongs to a settlement**, its split should:
- Keep new households in the **same settlement** (settlement expands to new cell)
- NOT create a new settlement

Only **unaffiliated** households (settlementId = -1) should create new settlements on split.

## Key Files

- `src/engine/simulation.ts:570-583` - Split handling (main change)
- `src/engine/settlement.ts` - tryExpand / cell management
- `src/engine/household.ts` - splitHousehold
- `src/constants/settlement.ts` - Population thresholds

## Acceptance Criteria

- [ ] Household splits within settlements grow the settlement instead of creating new ones
- [ ] Only unaffiliated household splits create new settlements
- [ ] All 4 settlement types (hamlet, village, town, city) appear in simulation runs
- [ ] Existing tests pass
