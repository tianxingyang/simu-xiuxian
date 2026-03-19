# Cultivator Behavior State System

## Goal

Replace the current implicit, probability-based random movement with an explicit behavior state machine. Each cultivator has a `behaviorState` field that determines movement strategy and courage modifier for combat decisions.

## Requirements

### Behavior States

| State | Trigger | Persistence | Movement | Courage Modifier |
|-------|---------|-------------|----------|------------------|
| `escaping` | Heavy injury (`injuredUntil > year`) | Until injury heals | 100% move, toward low `terrainDanger` | Significantly reduced |
| `recuperating` | Light injury (`lightInjuryUntil > year`) | Until injury heals | Very low movement probability | Slightly reduced |
| `seeking_breakthrough` | Remaining lifespan insufficient for natural breakthrough at current spiritual energy | Until current cell has sufficient spiritual energy | Toward high `spiritualEnergy` | Unchanged |
| `settling` | Random (frequency tied to lifespan) OR arrived from `seeking_breakthrough` | Duration tied to lifespan | No movement | Unchanged |
| `wandering` | Default state | Re-evaluated at frequency tied to lifespan | Pure random 8-direction (NO spiritual energy weighting) | Unchanged |

### Priority (highest first)

`escaping` > `recuperating` > `seeking_breakthrough` > `settling` > `wandering`

### State Transition Rules

**Condition-driven (forced, persist until condition clears):**
- Heavy injury → `escaping` (overrides everything)
- Light injury → `recuperating` (overrides non-injury states)

**Re-evaluated (frequency tied to lifespan — higher realm = slower rhythm):**
- Remaining lifespan insufficient for breakthrough at current spiritual energy → `seeking_breakthrough`
- `seeking_breakthrough` + arrived at sufficient spiritual energy → `settling`
- Random chance (lifespan-scaled) → `settling`
- Default → `wandering`

### Breaking Changes

- `fleeCultivator` instant teleport mechanism is REMOVED, replaced by `escaping` sustained state
- `moveCultivators` spiritual energy weighting is removed from default movement (only `seeking_breakthrough` uses it)

## Acceptance Criteria

- [ ] `behaviorState` field added to Cultivator type
- [ ] State transitions follow priority and trigger rules
- [ ] Each state has distinct movement behavior
- [ ] Courage modifiers applied per state
- [ ] `fleeCultivator` replaced by `escaping` state
- [ ] `wandering` uses pure random direction (no spiritual energy weighting)
- [ ] State evaluation frequency scales with cultivator lifespan
- [ ] No regression in simulation performance
- [ ] Lint / typecheck pass

## Definition of Done

- Lint / typecheck green
- No performance regression (32x32 map, thousands of cultivators per tick)

## Out of Scope

- New states beyond the 5 defined (e.g., alliance, treasure seeking)
- Changes to core cultivation growth, breakthrough, or combat mechanics
- Changes to AreaTag system itself
- UI changes for displaying behavior state

## Technical Notes

- Key files: `src/types.ts`, `src/engine/spatial.ts`, `src/engine/area-tag.ts`, `src/engine/simulation.ts`, `src/constants.ts`, `src/engine/combat.ts`
- Movement happens at step 4 of `tickYear()` (after cultivation growth, before encounters)
- State evaluation should happen BEFORE movement in the tick order
- Map is 32x32 toroidal (wrap-around)
- Performance critical: iterating all cultivators every tick, avoid allocations in hot path
- `breakthroughMove` (random 2-4 cells after successful breakthrough) remains unchanged
