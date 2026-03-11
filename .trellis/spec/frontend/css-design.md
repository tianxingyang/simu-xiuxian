# CSS & Design System

## Single CSS File

All styles live in `src/index.css`. No CSS modules, no CSS-in-JS, no Tailwind.

```
src/index.css   ← single file, imported in main.tsx
```

---

## CSS Custom Properties (Design Tokens)

Defined in `:root` with dark-only color scheme:

```css
:root {
  color-scheme: dark;
  --bg-primary: #0a0a0f;
  --bg-panel: #12121a;
  --bg-input: #1a1a26;
  --border: #2a2a3a;
  --text: #e0e0e0;
  --text-dim: #888;
  --accent: #6c8cff;
  --accent-hover: #8aa4ff;
  --danger: #ff4d4d;
  --speed-active: #6c8cff;
}
```

**Usage in CSS:**
```css
background: var(--bg-panel);
color: var(--text-dim);
border: 1px solid var(--border);
```

**Usage in Recharts (inline styles):**
```tsx
contentStyle={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
```

---

## CSS Class Naming

Use **kebab-case**. No BEM, no module prefixes — the codebase is small enough for flat naming.

| Pattern               | Examples                                    |
| --------------------- | ------------------------------------------- |
| Layout                | `dashboard`, `dashboard-grid`, `panel`      |
| Component root        | `controls`, `chart-container`, `event-log`  |
| Component parts       | `chart-header`, `chart-title`, `chart-body` |
| State/variant         | `active`, `stat-sub`, `stat-highlight`      |
| Semantic              | `extinction`, `event-year`, `stat-value`    |

---

## Layout Patterns

### Dashboard Grid

```css
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.dashboard-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  background: var(--border);  /* gap acts as border */
  min-height: 0;
}
```

### Chart Container (flex-column fill)

```css
.chart-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.chart-body {
  flex: 1;
  min-height: 0;  /* critical for ResponsiveContainer */
}
```

---

## Typography

- **Font**: `system-ui, -apple-system, sans-serif`
- **Tabular numbers**: `font-variant-numeric: tabular-nums` on numeric displays
- **Sizes**: 11px (toggles), 12px (inputs, data), 13px (body), 15px (title)

---

## Button Patterns

```css
.controls button {
  padding: 4px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.controls button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

/* Active state for speed buttons */
.speed-group button.active {
  background: var(--speed-active);
  border-color: var(--speed-active);
  color: #fff;
}
```

---

## Anti-Patterns

- Do NOT create separate CSS files per component
- Do NOT use CSS modules or styled-components
- Do NOT use Tailwind utility classes
- Do NOT add light theme support (dark-only by design)
- Do NOT use `px` font-size on `:root` — let browser default apply
