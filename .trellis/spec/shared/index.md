# Shared Development Guidelines

> These guidelines apply to all code in this project.

---

## Documentation Files

| File                                           | Description                       | When to Read           |
| ---------------------------------------------- | --------------------------------- | ---------------------- |
| [code-quality.md](./code-quality.md)           | Code quality mandatory rules      | Always                 |
| [typescript.md](./typescript.md)               | TypeScript best practices         | Type-related decisions |
| [git-conventions.md](./git-conventions.md)     | Git commit conventions            | Before committing      |

---

## Core Rules (MANDATORY)

| Rule                                 | File                                       |
| ------------------------------------ | ------------------------------------------ |
| No non-null assertions (`!`)         | [code-quality.md](./code-quality.md)       |
| No `any` type                        | [code-quality.md](./code-quality.md)       |
| `import type` for type-only imports  | [typescript.md](./typescript.md)           |
| Follow commit message format         | [git-conventions.md](./git-conventions.md) |

---

## Before Every Commit

- [ ] `npm run build` - 0 type errors
- [ ] `npm run test` - All tests pass
- [ ] No non-null assertions (`!`)
- [ ] Commit message follows `type(scope): description` format

---

**Language**: All documentation must be written in **English**.
