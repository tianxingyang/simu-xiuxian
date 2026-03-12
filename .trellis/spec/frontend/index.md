# Frontend Development Guidelines

> **Tech Stack**: React 19 + Vite 6 + TypeScript 5.8 + Recharts + WebSocket

## Documentation Files

| File                                               | Description                                    | Priority      |
| -------------------------------------------------- | ---------------------------------------------- | ------------- |
| [directory-structure.md](./directory-structure.md)  | Project structure and module organization      | **Must Read** |
| [components.md](./components.md)                   | Component patterns, memo, render-props layout  | **Must Read** |
| [hooks.md](./hooks.md)                             | Custom hook patterns, WebSocket communication  | **Must Read** |
| [state-management.md](./state-management.md)       | State strategy, rAF buffering, WS protocol     | **Must Read** |
| [type-safety.md](./type-safety.md)                 | Discriminated unions, `as const`, central types| Reference     |
| [css-design.md](./css-design.md)                   | CSS custom properties, dark theme, naming      | Reference     |
| [quality.md](./quality.md)                         | Performance patterns, testing, lint            | Reference     |

---

## Architecture Overview

```
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│        Browser (Frontend)        │     │     Node.js Backend (server/)    │
│  ┌────────────┐                  │     │  ┌────────────────────────────┐  │
│  │  React UI  │  useSimulation   │ WS  │  │  SimulationEngine          │  │
│  │ components ├─── hook ─────────┼─────┤  │  runner.ts + identity.ts   │  │
│  │  + charts  │  (rAF buffer)    │     │  │  events.ts + reporter.ts   │  │
│  └────────────┘                  │     │  └────────────────────────────┘  │
│       │              │           │     │       │              │           │
│  ToServer        FromServer      │     │  SQLite (db.ts)  DeepSeek API   │
│  (ws.send)       (ws.onmessage)  │     │                  QQ Bot (bot.ts)│
└──────────────────────────────────┘     └──────────────────────────────────┘
```

---

## Core Rules Summary

| Rule                                                      | Reference                                    |
| --------------------------------------------------------- | -------------------------------------------- |
| **All components are function components**                | [components.md](./components.md)             |
| **Heavy render components use `memo()`**                  | [components.md](./components.md)             |
| **Dashboard uses render-props (named slots)**             | [components.md](./components.md)             |
| **All types defined in central `src/types.ts`**           | [type-safety.md](./type-safety.md)           |
| **Discriminated unions for WebSocket messages**              | [type-safety.md](./type-safety.md)           |
| **`as const` for readonly constant arrays**               | [type-safety.md](./type-safety.md)           |
| **`useRef` for mutable values, `useState` for UI**       | [state-management.md](./state-management.md) |
| **rAF buffering for WebSocket message batching**             | [hooks.md](./hooks.md)                       |
| **`startTransition` for chart updates**                   | [hooks.md](./hooks.md)                       |
| **Single `index.css` with CSS custom properties**         | [css-design.md](./css-design.md)             |
| **No non-null assertions `!`** (except React root)        | [quality.md](./quality.md)                   |

---

**Language**: All documentation must be written in **English**.
