# Blessed TUI: Widget Update Without screen.render()

> **Severity**: P1 — Feature appears broken (log panel shows nothing)

## Problem

In [blessed](https://github.com/chjj/blessed) TUI apps, calling widget methods like `logBox.log()` or `box.setContent()` **does not** automatically refresh the terminal display. A separate `screen.render()` call is required.

If `screen.render()` is missing, the widget's internal buffer is updated but the user sees nothing until the next render cycle (e.g., a periodic timer).

## Symptoms

- Widget content is logically correct (data is in the buffer) but the screen shows stale or empty content
- Content "suddenly appears" when an unrelated action triggers a render (e.g., key press, periodic refresh)
- Intermittent — sometimes visible (if another render happens nearby), sometimes not

## Root Cause

blessed separates content mutation from rendering. Unlike browser DOM which batches and auto-renders, blessed requires explicit `screen.render()` after any widget change.

## Pattern: Safe Widget Update

```typescript
// BAD — content added but screen not refreshed
logBox.log(`${tag} ${line}`);

// GOOD — always render after content change
logBox.log(`${tag} ${line}`);
screen.render();

// BEST — centralize through a helper
function logMsg(msg: string): void {
  logBox.log(msg);
  screen.render();
}
```

## Lesson

When updating blessed widgets outside of a centralized render function (e.g., in a `fs.watchFile` callback, WebSocket handler, or timer), always call `screen.render()` explicitly.

## Additional Pitfall: Incomplete Action Coverage

When multiple UI actions achieve similar goals (e.g., "Start All" vs "Start Backend"), ensure all paths call the same setup functions. In this case, `startLogTail()` was called from "Start All" but missing from "Start Backend Only".

**Rule**: When adding a new setup step to a composite action, grep for all individual actions that overlap and add the step there too.
