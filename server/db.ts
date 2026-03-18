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
        killed_by TEXT
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

export function queryProtectedEventIdsForCultivator(cultivatorId: number): number[] {
  const rows = getDB().prepare(
    'SELECT event_id FROM event_cultivators WHERE cultivator_id = ?'
  ).all(cultivatorId) as { event_id: number }[];
  return rows.map(r => r.event_id);
}

export function queryEventCultivatorIds(eventId: number): number[] {
  const rows = getDB().prepare(
    'SELECT cultivator_id FROM event_cultivators WHERE event_id = ?'
  ).all(eventId) as { cultivator_id: number }[];
  return rows.map(r => r.cultivator_id);
}

export function unprotectEventsByIds(ids: number[]): void {
  if (!ids.length) return;
  const db = getDB();
  const stmt = db.prepare('UPDATE events SET protected = 0 WHERE id = ?');
  const delStmt = db.prepare('DELETE FROM event_cultivators WHERE event_id = ?');
  for (const id of ids) {
    stmt.run(id);
    delStmt.run(id);
  }
}

export function queryDeadCultivators(): { id: number; peak_level: number; death_year: number }[] {
  return getDB().prepare(
    'SELECT id, peak_level, death_year FROM named_cultivators WHERE death_year IS NOT NULL AND death_cause != ?'
  ).all('ascension') as { id: number; peak_level: number; death_year: number }[];
}

export function queryRememberedCultivatorIds(): Set<number> {
  const rows = getDB().prepare(
    'SELECT id FROM named_cultivators WHERE death_year IS NULL OR death_cause = ?'
  ).all('ascension') as { id: number }[];
  return new Set(rows.map(r => r.id));
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

export function queryEventStats(fromTs: number, toTs: number): { type: string; rank: string; cnt: number }[] {
  return getDB()
    .prepare(`SELECT type, rank, COUNT(*) as cnt FROM events WHERE real_ts >= ? AND real_ts < ? AND rank = 'B' GROUP BY type, rank`)
    .all(fromTs, toTs) as { type: string; rank: string; cnt: number }[];
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
}): number {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO reports (date, year_from, year_to, prompt, report, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       year_from = excluded.year_from, year_to = excluded.year_to,
       prompt = excluded.prompt, report = excluded.report,
       created_at = excluded.created_at`
  ).run(data.date, data.yearFrom, data.yearTo, data.prompt, data.report, now);
  const row = db.prepare('SELECT id FROM reports WHERE date = ?').get(data.date) as { id: number };
  return row.id;
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
