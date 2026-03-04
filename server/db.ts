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

export interface DailyReportRow {
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
}

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!_db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    _db = new Database(config.dbPath);
    _db.pragma('journal_mode = WAL');
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
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_real_ts ON events(real_ts);
      CREATE INDEX IF NOT EXISTS idx_events_rank ON events(rank);
      CREATE TABLE IF NOT EXISTS daily_reports (
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
    `);
  }
  return _db;
}

export function closeDB(): void {
  _db?.close();
  _db = null;
}

// --- Events ---

export function insertEvents(events: Omit<EventRow, 'id'>[]): void {
  if (!events.length) return;
  const stmt = getDB().prepare(
    'INSERT INTO events (year, type, rank, real_ts, payload) VALUES (?, ?, ?, ?, ?)'
  );
  for (const e of events) stmt.run(e.year, e.type, e.rank, e.real_ts, e.payload);
}

export function queryEventsByDateRange(fromTs: number, toTs: number): EventRow[] {
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
      `INSERT INTO named_cultivators (id, name, named_at_year, peak_level, peak_cultivation, promotion_years)
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

// --- Daily Reports ---

export function upsertDailyReport(data: {
  date: string;
  yearFrom: number;
  yearTo: number;
  prompt: string;
  report: string | null;
}): number {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO daily_reports (date, year_from, year_to, prompt, report, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       year_from = excluded.year_from, year_to = excluded.year_to,
       prompt = excluded.prompt, report = excluded.report,
       created_at = excluded.created_at`
  ).run(data.date, data.yearFrom, data.yearTo, data.prompt, data.report, now);
  const row = db.prepare('SELECT id FROM daily_reports WHERE date = ?').get(data.date) as { id: number };
  return row.id;
}

export function clearSimData(): void {
  getDB().exec('DELETE FROM named_cultivators; DELETE FROM events; DELETE FROM sim_state;');
}

// --- Simulation State ---

export function getSimState(): SimStateRow | undefined {
  return getDB()
    .prepare('SELECT current_year, seed, speed, running, highest_levels_ever FROM sim_state WHERE id = 1')
    .get() as SimStateRow | undefined;
}

export function setSimState(data: {
  currentYear: number;
  seed: number;
  speed: number;
  running: boolean;
  highestLevelsEver: string;
}): void {
  getDB()
    .prepare(
      `INSERT INTO sim_state (id, current_year, seed, speed, running, highest_levels_ever)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         current_year = excluded.current_year, seed = excluded.seed,
         speed = excluded.speed, running = excluded.running,
         highest_levels_ever = excluded.highest_levels_ever`
    )
    .run(data.currentYear, data.seed, data.speed, data.running ? 1 : 0, data.highestLevelsEver);
}
