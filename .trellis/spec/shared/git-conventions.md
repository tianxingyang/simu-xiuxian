# Git Conventions

## Commit Message Format

```
type(scope): description
```

### Types

| Type       | Description                     |
| ---------- | ------------------------------- |
| `feat`     | New feature                     |
| `fix`      | Bug fix                         |
| `docs`     | Documentation only              |
| `refactor` | Code restructuring              |
| `test`     | Adding or updating tests        |
| `chore`    | Build, dependencies, tooling    |
| `perf`     | Performance improvement         |
| `tune`     | Balance parameter tuning        |

### Scopes

| Scope        | Description                    |
| ------------ | ------------------------------ |
| `engine`     | Simulation engine              |
| `combat`     | Combat system                  |
| `threshold`  | Level thresholds               |
| `balance`    | Balance profiles               |
| `ui`         | React components               |
| `worker`     | Web Worker                     |

### Examples (from actual commits)

```
refactor(threshold): replace hardcoded thresholds with formula-based computation
perf: skip unused event collection (#4)
tune lv4 threshold for steady-state distribution
Add versioned balance presets and tune high-level distribution
```

---

## Pre-Commit Checklist

- [ ] `npm run build` passes
- [ ] `npm run test` passes
- [ ] Changes are atomic (one logical change per commit)
