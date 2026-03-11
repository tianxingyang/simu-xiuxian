# Type Safety Guidelines

## Central Type File

All TypeScript interfaces and type unions are defined in `src/types.ts`. Do NOT scatter type definitions across component or engine files.

```
src/types.ts  →  Cultivator, YearSummary, SimEvent, RichEvent, ToWorker, FromWorker, ...
```

---

## Key Patterns

### Discriminated Unions

Worker messages use discriminated unions on the `type` field:

```typescript
// Worker input messages
type ToWorker =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'reset'; seed: number; initialPop: number }
  | { type: 'ack' };

// Worker output messages
type FromWorker =
  | { type: 'tick'; summaries: YearSummary[]; events: SimEvent[] }
  | { type: 'paused'; reason: 'manual' | 'extinction' }
  | { type: 'reset-done' };
```

Rich events also use discriminated unions:

```typescript
type RichEvent =
  | RichCombatEvent
  | RichPromotionEvent
  | RichExpiryEvent
  | RichMilestoneEvent
  | RichBreakthroughEvent;
```

### `as const` for Readonly Arrays

Use `as const` for constant arrays that should be readonly:

```typescript
export const LEVEL_NAMES = [
  '炼气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘',
] as const;

export const LEVEL_COLORS = [
  '#555', '#7fb069', '#5ab0c4', '#6c8cff', '#a67bff', '#ff9b4e', '#ff5c5c', '#ffd700',
] as const;
```

### `satisfies` for Type Checking

Use `satisfies` to type-check values without widening:

```typescript
worker.postMessage({ type: 'ack' } satisfies ToWorker);
```

### `readonly` Modifier

Use `readonly` on interface fields that should not be mutated:

```typescript
export interface Cultivator {
  id: number;
  readonly courage: number;  // base courage never changes after creation
  // ...
}
```

### `Object.freeze()` for Immutable Data

Freeze computed constant arrays and objects:

```typescript
export const SUSTAINABLE_MAX_AGE: readonly number[] = Object.freeze(
  Array.from({ length: LEVEL_COUNT }, (_, level) => sustainableMaxAge(level)),
);
```

---

## Import Conventions

### Type-Only Imports

Use `import type` for type-only imports:

```typescript
import type { Cultivator, YearSummary, SimEvent } from '../types';
import type { ReactNode } from 'react';
```

### No Path Aliases

This project uses relative imports. No `@/` or `@shared/` aliases are configured.

```typescript
// From components
import type { YearSummary } from '../types';
import { LEVEL_NAMES, LEVEL_COLORS } from '../constants';

// From engine
import type { Cultivator, EngineHooks } from '../types';
import { LEVEL_COUNT, threshold } from '../constants';
```

---

## Type Organization

| Type Category       | Location             | Examples                              |
| ------------------- | -------------------- | ------------------------------------- |
| Domain entities     | `src/types.ts`       | `Cultivator`, `LevelStat`            |
| Data summaries      | `src/types.ts`       | `YearSummary`, `SimEvent`            |
| Rich events         | `src/types.ts`       | `RichCombatEvent`, `RichEvent`       |
| Worker messages     | `src/types.ts`       | `ToWorker`, `FromWorker`             |
| Engine hooks        | `src/types.ts`       | `EngineHooks`                        |
| Balance types       | `src/balance.ts`     | `BalanceProfile`, `SigmoidCurve`     |
| Component props     | Each component file  | `interface Props { ... }`            |

---

## Anti-Patterns

- Do NOT use `any` — use proper types or `unknown`
- Do NOT use non-null assertions `!` — except `document.getElementById('root')!` in `main.tsx`
- Do NOT define types in component files (except Props) — use `src/types.ts`
- Do NOT use TypeScript enums — use string literal unions or `as const` arrays
