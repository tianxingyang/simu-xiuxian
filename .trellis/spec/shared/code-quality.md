# Code Quality Guidelines

## No Non-Null Assertions

**NEVER** use `!` except for `document.getElementById('root')!` in `main.tsx` (standard React pattern).

```typescript
// FORBIDDEN
const name = user!.name;

// REQUIRED
if (user) {
  const name = user.name;
}
const value = data?.items?.[0] ?? defaultValue;
```

---

## Avoid `any` Type

```typescript
// BAD
function process(data: any) { ... }

// GOOD
function process(data: ProcessInput) { ... }
function process(data: unknown) { ... }
```

---

## Lint and Type Check

```bash
npm run build    # tsc -b && vite build (catches type errors)
npm run test     # vitest run
```

---

## Naming Conventions

| Type            | Convention                  | Example                           |
| --------------- | --------------------------- | --------------------------------- |
| Component       | PascalCase.tsx              | `LevelChart.tsx`                  |
| Hook            | camelCase with `use`        | `useSimulation.ts`                |
| Engine module   | camelCase.ts                | `simulation.ts`, `combat.ts`      |
| Type file       | camelCase.ts                | `types.ts`                        |
| Test file       | name.test.ts                | `distribution.test.ts`            |
| Directory       | kebab-case                  | `balance-presets/`                |
| Constants       | UPPER_SNAKE_CASE            | `LEVEL_COUNT`, `MAX_EVENTS`       |
| Type/Interface  | PascalCase                  | `Cultivator`, `YearSummary`       |
| CSS class       | kebab-case                  | `chart-container`, `stat-item`    |

### Boolean Variables

Use `is`, `has` prefixes:

```typescript
const isRunning = true;
const isPaused = false;
const extinctionNotice = true;  // acceptable for domain-specific flags
```

---

## Error Handling

This project is a simulation — errors in the engine should fail fast:

```typescript
// Engine code: let errors propagate naturally
// No try-catch wrappers in hot simulation loops

// UI code: handle edge cases gracefully
const data = Array.from({ length: 8 }, (_, i) => {
  const raw = summary?.levelCounts[i] ?? 0;
  return { name: LEVEL_NAMES[i], count: raw };
});
```

---

## Summary

| Rule                    | Reason              |
| ----------------------- | ------------------- |
| No `!` assertions       | Runtime errors      |
| No `any` type           | Type safety         |
| Build before commit     | Catch type errors   |
| Test before commit      | Catch regressions   |
| Consistent naming       | Readability         |
