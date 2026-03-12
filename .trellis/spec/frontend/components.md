# Component Guidelines

## Component Patterns

### All components are function components

No class components. Use `export default function` or `export default memo(function ...)`.

### Props Pattern

Define props as inline `interface Props` at the top of each component file:

```tsx
// src/components/LevelChart.tsx
interface Props {
  summary: YearSummary | null;
}

export default memo(function LevelChart({ summary }: Props) {
  // ...
});
```

### memo() for Heavy Render Components

Wrap chart and list components with `memo()` to prevent unnecessary re-renders:

```tsx
// Existing pattern — LevelChart.tsx, TrendChart.tsx, EventLog.tsx, StatsPanel.tsx
export default memo(function LevelChart({ summary }: Props) {
  // ...
});
```

**When to use `memo()`:**
- Components receiving data arrays (chart data, event lists)
- Components with expensive render logic (Recharts components)
- Leaf components that re-render frequently due to parent state changes

**When NOT to use `memo()`:**
- Simple stateless components (Dashboard layout)
- Components with few props that change every render anyway

### Dashboard: Render-Props Layout

The Dashboard component uses named slots (render-props pattern) for layout composition:

```tsx
// src/components/Dashboard.tsx
interface Props {
  controls: ReactNode;
  levelChart: ReactNode;
  trendChart: ReactNode;
  eventLog: ReactNode;
  statsPanel: ReactNode;
}

export default function Dashboard({ controls, levelChart, ... }: Props) {
  return (
    <div className="dashboard">
      <header className="dashboard-controls">{controls}</header>
      <main className="dashboard-grid">
        <section className="panel">{levelChart}</section>
        ...
      </main>
    </div>
  );
}
```

Usage in `App.tsx`:

```tsx
<Dashboard
  controls={<Controls year={year} connectionStatus={sim.connectionStatus} ... />}
  levelChart={<LevelChart summary={sim.yearSummary} />}
  ...
```

### Private Helper Components

Small helper components used only within a single file are defined as plain functions at the bottom:

```tsx
// src/components/StatsPanel.tsx — Stat is a local helper
function Stat({ label, value, sub, highlight }: {
  label: string; value: string; sub?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`stat-item${sub ? ' stat-sub' : ''}${highlight ? ' stat-highlight' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
```

### Private Helper Functions

Formatting utilities are defined as plain functions at the bottom of the file:

```tsx
// src/components/StatsPanel.tsx
function fmt(n: number) {
  return n.toLocaleString();
}
```

---

## Recharts Patterns

### Chart Container Layout

All chart components follow this structure:

```tsx
<div className="chart-container">
  <div className="chart-header">
    <span className="chart-title">Title</span>
    {/* optional toggle/tabs */}
  </div>
  <div className="chart-body">
    <ResponsiveContainer width="100%" height="100%">
      {/* chart */}
    </ResponsiveContainer>
  </div>
</div>
```

### Recharts Configuration

- **Animation**: Always `isAnimationActive={false}` for real-time data
- **Colors**: Use `LEVEL_COLORS` from constants for per-level coloring
- **Tooltip**: Use CSS custom properties for consistent dark theme styling
- **Labels**: Use Chinese labels for user-facing text (`人数`, `第 N 年`)

```tsx
<Tooltip
  contentStyle={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4 }}
  labelStyle={{ color: 'var(--text)' }}
/>
```

---

## Anti-Patterns

- Do NOT use class components
- Do NOT put simulation logic inside components — delegate to the hook
- Do NOT create wrapper components just for styling — use CSS classes
- Do NOT use third-party UI libraries (no MUI, no shadcn) — plain HTML + CSS
