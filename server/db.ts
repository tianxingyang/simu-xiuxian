import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

export interface EventRow {
  id: number;
  year: number;
  type: string;
  rank: string;
  real_ts: number;
  payload: string;
  protected: number;
}

export interface NamedCultivatorRow {
  id: number;
  name: string;
  named_at_year: number;
  kill_count: number;
  combat_wins: number;
  combat_losses: number;
  promotion_years: string;
  peak_level: number;
  peak_cultivation: number;
  death_year: number | null;
  death_cause: string | null;
  killed_by: string | null;
}

export interface ReportRow {
  id: number;
  date: string;
  year_from: number;
  year_to: number;
  prompt: string;
  report: string | null;
  world_context: string | null;
  created_at: number;
}

export interface SimStateRow {
  current_year: number;
  seed: number;
  speed: number;
  running: number;
  highest_levels_ever: string;
  snapshot: Buffer | null;
}

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!_db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    _db = new Database(config.dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('busy_timeout = 5000');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS named_cultivators (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        named_at_year INTEGER NOT NULL,
        kill_count INTEGER NOT NULL DEFAULT 0,
        combat_wins INTEGER NOT NULL DEFAULT 0,
        combat_losses INTEGER NOT NULL DEFAULT 0,
        promotion_years TEXT NOT NULL DEFAULT '[]',
        peak_level INTEGER NOT NULL DEFAULT 0,
        peak_cultivation REAL NOT NULL DEFAULT 0,
        death_year INTEGER,
        death_cause TEXT,
        killed_by TEXT,
        forgotten INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        type TEXT NOT NULL,
        rank TEXT NOT NULL,
        real_ts INTEGER NOT NULL,
        payload TEXT NOT NULL,
        protected INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_events_real_ts ON events(real_ts);
      CREATE INDEX IF NOT EXISTS idx_events_rank ON events(rank);
      CREATE INDEX IF NOT EXISTS idx_events_evict ON events(protected, rank, year);
      CREATE TABLE IF NOT EXISTS event_cultivators (
        cultivator_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        PRIMARY KEY (cultivator_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ec_event_id ON event_cultivators(event_id);
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        year_from INTEGER NOT NULL,
        year_to INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        report TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sim_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        current_year INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        speed INTEGER NOT NULL,
        running INTEGER NOT NULL DEFAULT 0,
        highest_levels_ever TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS bot_request_log (
        group_openid TEXT PRIMARY KEY,
        last_request_ts INTEGER NOT NULL
      );
    `);
    // Migration: move daily_reports → reports
    const oldTable = _db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='daily_reports'").get();
    if (oldTable) {
      _db.exec(`
        INSERT OR IGNORE INTO reports (id, date, year_from, year_to, prompt, report, created_at)
          SELECT id, date, year_from, year_to, prompt, report, created_at FROM daily_reports;
        DROP TABLE daily_reports;
      `);
    }
    // Migration: add protected column to events if missing
    const eventCols = _db.pragma('table_info(events)') as Array<{ name: string }>;
    if (!eventCols.some(c => c.name === 'protected')) {
      _db.exec('ALTER TABLE events ADD COLUMN protected INTEGER NOT NULL DEFAULT 0');
      _db.exec('CREATE INDEX IF NOT EXISTS idx_events_evict ON events(protected, rank, year)');
    }
    // Migration: add snapshot column if missing
    const cols = _db.pragma('table_info(sim_state)') as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'snapshot')) {
      _db.exec('ALTER TABLE sim_state ADD COLUMN snapshot BLOB');
    }
    // Migration: add forgotten column + reverse index for memory decay optimization
    const ncCols = _db.pragma('table_info(named_cultivators)') as Array<{ name: string }>;
    if (!ncCols.some(c => c.name === 'forgotten')) {
      _db.exec('ALTER TABLE named_cultivators ADD COLUMN forgotten INTEGER NOT NULL DEFAULT 0');
    }
    // Migration: add world_context column to reports
    const reportCols = _db.pragma('table_info(reports)') as Array<{ name: string }>;
    if (!reportCols.some(c => c.name === 'world_context')) {
      _db.exec('ALTER TABLE reports ADD COLUMN world_context TEXT');
    }
  }
  return _db;
}

export function closeDB(): void {
  _db?.close();
  _db = null;
}

// --- Events ---

export function insertEvents(events: (Omit<EventRow, 'id'> & { cultivatorIds?: number[] })[]): void {
  if (!events.length) return;
  const db = getDB();
  const evtStmt = db.prepare(
    'INSERT INTO events (year, type, rank, real_ts, payload, protected) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const linkStmt = db.prepare(
    'INSERT OR IGNORE INTO event_cultivators (event_id, cultivator_id) VALUES (?, ?)'
  );
  for (const e of events) {
    const result = evtStmt.run(e.year, e.type, e.rank, e.real_ts, e.payload, e.protected ?? 0);
    if (e.cultivatorIds?.length) {
      const eventId = Number(result.lastInsertRowid);
      for (const cid of e.cultivatorIds) linkStmt.run(eventId, cid);
    }
  }
}


const EVICT_BATCH_LIMIT = 5000;

export function evictExpiredEvents(currentYear: number, retention: Record<string, number>): number {
  const db = getDB();
  let total = 0;
  for (const [rank, years] of Object.entries(retention)) {
    const threshold = currentYear - years;
    if (threshold <= 0) continue;
    const result = db.prepare(
      'DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE protected = 0 AND rank = ? AND year < ? LIMIT ?)'
    ).run(rank, threshold, EVICT_BATCH_LIMIT);
    total += result.changes;
  }
  return total;
}

export function processMemoryDecayBatch(
  currentYear: number,
  memoryYears: Record<number, number>,
): { marked: number; unprotected: number; purged: number } {
  const db = getDB();
  const caseParts = Object.entries(memoryYears)
    .map(([level, years]) => `WHEN ${Number(level)} THEN ${Number(years)}`)
    .join(' ');
  const caseExpr = `CASE peak_level ${caseParts} ELSE 50 END`;

  const txn = db.transaction(() => {
    const markResult = db.prepare(`
      UPDATE named_cultivators SET forgotten = 1
      WHERE forgotten = 0
        AND death_year IS NOT NULL
        AND death_cause != 'ascension'
        AND (? - death_year) > ${caseExpr}
    `).run(currentYear);

    if (markResult.changes === 0) {
      const purgeResult = db.prepare('DELETE FROM named_cultivators WHERE forgotten = 1').run();
      return { marked: 0, unprotected: 0, purged: purgeResult.changes };
    }

    const orphaned = db.prepare(`
      SELECT DISTINCT ec.event_id FROM event_cultivators ec
      JOIN named_cultivators nc ON ec.cultivator_id = nc.id
      WHERE nc.forgotten = 1
      AND NOT EXISTS (
        SELECT 1 FROM event_cultivators ec2
        JOIN named_cultivators nc2 ON ec2.cultivator_id = nc2.id
        WHERE ec2.event_id = ec.event_id AND nc2.forgotten = 0
      )
    `).all() as { event_id: number }[];

    if (!orphaned.length) {
      const purgeResult = db.prepare('DELETE FROM named_cultivators WHERE forgotten = 1').run();
      return { marked: markResult.changes, unprotected: 0, purged: purgeResult.changes };
    }

    const ids = orphaned.map(r => r.event_id);
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      db.prepare(`UPDATE events SET protected = 0 WHERE id IN (${ph})`).run(...chunk);
      db.prepare(`DELETE FROM event_cultivators WHERE event_id IN (${ph})`).run(...chunk);
    }

    const purgeResult = db.prepare('DELETE FROM named_cultivators WHERE forgotten = 1').run();
    return { marked: markResult.changes, unprotected: ids.length, purged: purgeResult.changes };
  });

  return txn();
}

export function queryEventsByDateRange(fromTs: number, toTs: number, ranks?: string[]): EventRow[] {
  if (ranks && ranks.length) {
    const placeholders = ranks.map(() => '?').join(',');
    return getDB()
      .prepare(`SELECT * FROM events WHERE real_ts >= ? AND real_ts < ? AND rank IN (${placeholders}) ORDER BY id`)
      .all(fromTs, toTs, ...ranks) as EventRow[];
  }
  return getDB()
    .prepare('SELECT * FROM events WHERE real_ts >= ? AND real_ts < ? ORDER BY id')
    .all(fromTs, toTs) as EventRow[];
}

// --- Named Cultivators ---

export function insertNamedCultivator(data: {
  id: number;
  name: string;
  namedAtYear: number;
  peakLevel: number;
  peakCultivation: number;
  promotionYears: string;
}): void {
  getDB()
    .prepare(
      `INSERT OR IGNORE INTO named_cultivators (id, name, named_at_year, peak_level, peak_cultivation, promotion_years)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(data.id, data.name, data.namedAtYear, data.peakLevel, data.peakCultivation, data.promotionYears);
}

export function updateNamedCultivators(
  updates: Array<{
    id: number;
    killCount: number;
    combatWins: number;
    combatLosses: number;
    promotionYears: string;
    peakLevel: number;
    peakCultivation: number;
    deathYear?: number | null;
    deathCause?: string | null;
    killedBy?: string | null;
  }>
): void {
  if (!updates.length) return;
  const stmt = getDB().prepare(
    `UPDATE named_cultivators SET
       kill_count = ?, combat_wins = ?, combat_losses = ?,
       promotion_years = ?, peak_level = ?, peak_cultivation = ?,
       death_year = ?, death_cause = ?, killed_by = ?
     WHERE id = ?`
  );
  for (const u of updates) {
    stmt.run(
      u.killCount, u.combatWins, u.combatLosses,
      u.promotionYears, u.peakLevel, u.peakCultivation,
      u.deathYear ?? null, u.deathCause ?? null, u.killedBy ?? null,
      u.id
    );
  }
}

export function queryNamedCultivator(id: number): NamedCultivatorRow | undefined {
  return getDB()
    .prepare('SELECT * FROM named_cultivators WHERE id = ?')
    .get(id) as NamedCultivatorRow | undefined;
}

export function queryNamedCultivatorByName(name: string): NamedCultivatorRow | undefined {
  return getDB()
    .prepare('SELECT * FROM named_cultivators WHERE name = ?')
    .get(name) as NamedCultivatorRow | undefined;
}

export function queryEventsForCultivator(cultivatorId: number): EventRow[] {
  return getDB()
    .prepare(
      `SELECT * FROM events WHERE
        json_extract(payload, '$.winner.id') = ?
        OR json_extract(payload, '$.loser.id') = ?
        OR json_extract(payload, '$.subject.id') = ?
        OR json_extract(payload, '$.detail.cultivatorId') = ?
      ORDER BY year, id`
    )
    .all(cultivatorId, cultivatorId, cultivatorId, cultivatorId) as EventRow[];
}

// --- Reports ---

export function queryLastReportTs(): number | null {
  const row = getDB().prepare('SELECT MAX(created_at) as ts FROM reports').get() as { ts: number | null };
  return row.ts;
}

export function upsertReport(data: {
  date: string;
  yearFrom: number;
  yearTo: number;
  prompt: string;
  report: string | null;
  worldContext?: string | null;
}): number {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO reports (date, year_from, year_to, prompt, report, world_context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       year_from = excluded.year_from, year_to = excluded.year_to,
       prompt = excluded.prompt, report = excluded.report,
       world_context = excluded.world_context,
       created_at = excluded.created_at`
  ).run(data.date, data.yearFrom, data.yearTo, data.prompt, data.report, data.worldContext ?? null, now);
  const row = db.prepare('SELECT id FROM reports WHERE date = ?').get(data.date) as { id: number };
  return row.id;
}

export function queryRecentWorldContexts(n: number): string[] {
  const rows = getDB()
    .prepare('SELECT world_context FROM reports WHERE world_context IS NOT NULL ORDER BY created_at DESC LIMIT ?')
    .all(n) as { world_context: string }[];
  return rows.map(r => r.world_context);
}

export function clearSimData(): void {
  getDB().exec('DELETE FROM named_cultivators; DELETE FROM events; DELETE FROM sim_state;');
}

// --- Simulation State ---

export function getSimState(): SimStateRow | undefined {
  return getDB()
    .prepare('SELECT current_year, seed, speed, running, highest_levels_ever, snapshot FROM sim_state WHERE id = 1')
    .get() as SimStateRow | undefined;
}

export function setSimState(data: {
  currentYear: number;
  seed: number;
  speed: number;
  running: boolean;
  highestLevelsEver: string;
  snapshot?: Buffer;
}): void {
  getDB()
    .prepare(
      `INSERT INTO sim_state (id, current_year, seed, speed, running, highest_levels_ever, snapshot)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         current_year = excluded.current_year, seed = excluded.seed,
         speed = excluded.speed, running = excluded.running,
         highest_levels_ever = excluded.highest_levels_ever,
         snapshot = excluded.snapshot`
    )
    .run(data.currentYear, data.seed, data.speed, data.running ? 1 : 0, data.highestLevelsEver, data.snapshot ?? null);
}

// --- Bot Request Log ---

export function getLastRequestTs(groupOpenid: string): number | null {
  const row = getDB()
    .prepare('SELECT last_request_ts FROM bot_request_log WHERE group_openid = ?')
    .get(groupOpenid) as { last_request_ts: number } | undefined;
  return row?.last_request_ts ?? null;
}

export function setLastRequestTs(groupOpenid: string, ts: number): void {
  getDB()
    .prepare(
      `INSERT INTO bot_request_log (group_openid, last_request_ts) VALUES (?, ?)
       ON CONFLICT(group_openid) DO UPDATE SET last_request_ts = excluded.last_request_ts`
    )
    .run(groupOpenid, ts);
}
