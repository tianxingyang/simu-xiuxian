# TypeScript Best Practices

## Type-Only Imports

Always use `import type` for type-only imports:

```typescript
import type { Cultivator, YearSummary, SimEvent } from '../types';
import type { ReactNode } from 'react';
```

---

## Discriminated Unions

Use string literal `type` field for exhaustive matching:

```typescript
type ToWorker =
  | { type: 'start'; speed: number; seed: number; initialPop: number }
  | { type: 'pause' }
  | { type: 'ack' };

// Use switch for exhaustive handling
switch (msg.type) {
  case 'start': { ... }
  case 'pause': { ... }
  case 'ack': { ... }
  default: return;
}
```

---

## `as const` Assertions

Use for readonly constant arrays:

```typescript
export const LEVEL_NAMES = [
  '炼气', '筑基', '结丹', '元婴', '化神', '炼虚', '合体', '大乘',
] as const;

const SPEED_LABELS = ['×1', '×5', '×10'] as const;
```

---

## `satisfies` Operator

Use for type checking without widening:

```typescript
worker.postMessage({ type: 'ack' } satisfies ToWorker);
```

---

## `Object.freeze()` for Immutable Data

Freeze computed constant objects and arrays:

```typescript
export const SUSTAINABLE_MAX_AGE: readonly number[] = Object.freeze(
  Array.from({ length: LEVEL_COUNT }, (_, level) => sustainableMaxAge(level)),
);
```

---

## Interface vs Type

This project uses `interface` for domain entities and `type` for unions:

```typescript
// Interface for entities
export interface Cultivator {
  id: number;
  age: number;
  level: number;
  readonly courage: number;
}

// Type for unions
export type DefeatOutcome =
  | 'death' | 'demotion' | 'injury'
  | 'cult_loss' | 'light_injury' | 'meridian_damage';

// Type for algebraic types
export type RichEvent =
  | RichCombatEvent
  | RichPromotionEvent
  | RichExpiryEvent;
```

---

## No Zod

This project does NOT use Zod. Types are plain TypeScript interfaces/types defined in `src/types.ts`. Runtime validation is not needed for internal simulation data.

---

## Anti-Patterns

- Do NOT use `any`
- Do NOT use `@ts-ignore` or `@ts-expect-error`
- Do NOT use TypeScript enums — use string literal unions
- Do NOT use non-null assertions `!` (except `main.tsx` React root)
