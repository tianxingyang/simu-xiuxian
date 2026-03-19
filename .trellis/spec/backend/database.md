# Database Guidelines (Drizzle + SQLite)

> Guidelines for Drizzle ORM and SQLite development in Electron.

---

## Drizzle Client Setup

```typescript
// src/main/db/client.ts
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import * as schema from './schema';

const getDbPath = () => {
  if (process.env.NODE_ENV === 'development') {
    return './app-dev.db';
  }
  return path.join(app.getPath('userData'), 'app.db');
};

const sqlite = new Database(getDbPath());
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { sqlite };
```

---

## Schema Definition

```typescript
// src/main/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status', { enum: ['active', 'archived', 'draft'] })
    .default('active')
    .notNull(),
  // Use timestamp_ms for millisecond precision
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date()),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// Relations for db.query.* API
export const projectsRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
}));

// Export types
export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
```

---

## Timestamp Precision

**CRITICAL: Always use `{ mode: 'timestamp_ms' }` for timestamps.**

```typescript
// BAD: Using seconds mode
createdAt: integer('createdAt', { mode: 'timestamp' }); // Stores 1734019200

// GOOD: Using milliseconds mode
createdAt: integer('createdAt', { mode: 'timestamp_ms' }); // Stores 1734019200000
```

---

## Query Patterns

```typescript
// Single result
const user = db.select().from(users).where(eq(users.id, id)).get();

// Multiple results
const allUsers = db.select().from(users).all();

// Insert with return
const newUser = db.insert(users).values(data).returning().get();

// Relational queries
const projectsWithTasks = db.query.projects.findMany({
  with: { tasks: true },
});

// Transaction
db.transaction((tx) => {
  tx.insert(projects).values(projectData).run();
  tx.insert(tasks).values(taskData).run();
});

// Batch lookup (avoid N+1)
const results = db.select().from(items).where(inArray(items.id, ids)).all();
```

---

## Migrations

```typescript
// src/main/db/migrate.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client';
import { existsSync } from 'fs';
import path from 'path';

export function runMigrations() {
  const migrationsFolder =
    process.env.NODE_ENV === 'development'
      ? path.resolve(__dirname, '..', '..', 'drizzle')
      : path.join(process.resourcesPath, 'drizzle');

  if (!existsSync(migrationsFolder)) {
    return { success: false, reason: 'missing-folder' };
  }

  try {
    migrate(db, { migrationsFolder });
    return { success: true };
  } catch (error) {
    return { success: false, reason: 'error', error: error.message };
  }
}
```

---

## Quick Reference

| Operation     | Method                  |
| ------------- | ----------------------- |
| Single        | `.get()`                |
| Multiple      | `.all()`                |
| Insert/Update | `.run()`                |
| With return   | `.returning().get()`    |
| Relational    | `db.query.*.findMany()` |

| Rule               | Reason                |
| ------------------ | --------------------- |
| Use `timestamp_ms` | Match JavaScript Date |
| Use transactions   | Atomic operations     |
| Use `inArray`      | Avoid N+1 queries     |
| Filter `isDeleted` | Exclude soft-deleted  |

---

## Schema Ownership (Multi-Process)

When multiple processes (e.g., sim-worker, llm-worker) share the same SQLite database file:

| Concern | Owner | Others |
|---------|-------|--------|
| CREATE TABLE / migrations | **Single owner process** (sim-worker) | Never |
| Connection (`getDB()`) | Any process | Any process |
| Read / Write data | Any process | Any process |

**Rules:**

1. **Separate connection from initialization** — `getDB()` only opens a connection and sets pragmas. A dedicated `initSchema()` handles CREATE TABLE and ALTER TABLE migrations.
2. **Only one process calls `initSchema()`** — The "owner" process (sim-worker) calls `initSchema()` at startup before any other DB access.
3. **Other processes assume schema exists** — llm-worker and others connect lazily via `getDB()` without running migrations.

**Why:** `ALTER TABLE ADD COLUMN` with a check-then-act pattern (`pragma table_info` → `ALTER TABLE`) is not atomic. If two processes run this concurrently, both see the column as missing and both try to add it, causing `SQLITE_ERROR: duplicate column name`.

---

## Periodic Task Anti-Patterns (better-sqlite3)

Since better-sqlite3 is synchronous, periodic DB tasks can block the Node.js event loop. Follow these rules:

### 1. No N+1 in Loops

```typescript
// BAD: N+1 queries in a loop (O(N×M) DB calls)
for (const item of allItems) {
  const related = db.prepare('SELECT * FROM related WHERE item_id = ?').all(item.id);
  for (const r of related) {
    const others = db.prepare('SELECT * FROM others WHERE related_id = ?').all(r.id);
  }
}

// GOOD: Set-based SQL with JOINs (2-3 DB calls total)
const orphaned = db.prepare(`
  SELECT DISTINCT r.id FROM related r
  JOIN items i ON r.item_id = i.id
  WHERE i.status = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM related r2
    JOIN items i2 ON r2.item_id = i2.id
    WHERE r2.group_id = r.group_id AND i2.status != 'done'
  )
`).all();
```

### 2. Monotonic State → Use Incremental Flag

If a state transition is irreversible (e.g., alive → dead → forgotten), add a flag column to track completion. Only process the delta (newly transitioned items), not the full set.

```typescript
// BAD: Re-scan all dead items every cycle → O(total_dead), grows forever
const allDead = db.prepare('SELECT * FROM items WHERE dead = 1').all();
for (const item of allDead) { /* check if forgotten... */ }

// GOOD: Only process newly forgotten → O(new_forgotten), approaches 0
db.prepare(`
  UPDATE items SET forgotten = 1
  WHERE forgotten = 0 AND dead = 1 AND (? - death_year) > threshold
`).run(currentYear);
```

### 3. Reverse Indexes for Junction Tables

Junction tables with composite PK `(a_id, b_id)` only index lookups by `a_id`. Add a reverse index if you query by `b_id`.

```sql
CREATE INDEX IF NOT EXISTS idx_junction_b ON junction_table(b_id);
```
