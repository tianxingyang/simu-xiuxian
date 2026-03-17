import {
  evictExpiredEvents,
  queryDeadCultivators,
  queryRememberedCultivatorIds,
  queryProtectedEventIdsForCultivator,
  queryEventCultivatorIds,
  unprotectEventsByIds,
} from './db.js';

// Memory duration by rank (sim years)
const EVENT_RETENTION: Record<string, number> = { B: 200, A: 2000, S: 15000 };

// Memory duration by cultivator peak level (same as biography.ts)
const CULTIVATOR_MEMORY_YEARS: Record<number, number> = {
  0: 0, 1: 0, 2: 100, 3: 300, 4: 800, 5: 2000, 6: 5000, 7: 15000,
};

const LN_20 = Math.log(20);

function isForgotten(peakLevel: number, deathYear: number, currentYear: number): boolean {
  const elapsed = currentYear - deathYear;
  if (elapsed <= 0) return false;
  const duration = CULTIVATOR_MEMORY_YEARS[peakLevel] ?? 50;
  return Math.exp(-elapsed * LN_20 / duration) < 0.05;
}

// --- Memory decay scan ---
// Finds forgotten cultivators → unprotects their events (via event_cultivators index)

function processMemoryDecay(currentYear: number): void {
  const dead = queryDeadCultivators();
  const remembered = queryRememberedCultivatorIds();

  // Add non-forgotten dead cultivators to remembered set
  for (const row of dead) {
    if (!isForgotten(row.peak_level, row.death_year, currentYear)) {
      remembered.add(row.id);
    }
  }

  for (const row of dead) {
    if (!isForgotten(row.peak_level, row.death_year, currentYear)) continue;

    // Fast lookup via event_cultivators index (no json_extract)
    const eventIds = queryProtectedEventIdsForCultivator(row.id);
    if (!eventIds.length) continue;

    const toUnprotect: number[] = [];
    for (const eventId of eventIds) {
      const otherIds = queryEventCultivatorIds(eventId).filter(id => id !== row.id);
      const hasRemembered = otherIds.some(id => remembered.has(id));
      if (!hasRemembered) toUnprotect.push(eventId);
    }

    if (toUnprotect.length) {
      unprotectEventsByIds(toUnprotect);
    }
  }
}

// --- Public API ---

let _lastEvictRealTs = 0;
const EVICT_REAL_INTERVAL = 10_000; // every 10s real time
let _lastDecayRealTs = Date.now();
const DECAY_REAL_INTERVAL = 60_000;

export function runEviction(currentYear: number): void {
  const now = Date.now();

  // Fast path: rate-limited to every 10s real time
  if (now - _lastEvictRealTs >= EVICT_REAL_INTERVAL) {
    _lastEvictRealTs = now;
    const deleted = evictExpiredEvents(currentYear, EVENT_RETENTION);
    if (deleted > 0) {
      console.log(`[eviction] deleted ${deleted} expired events at year ${currentYear}`);
    }
  }

  // Slow path: memory decay scan (every 60s real time)
  if (now - _lastDecayRealTs >= DECAY_REAL_INTERVAL) {
    _lastDecayRealTs = now;
    processMemoryDecay(currentYear);
  }
}
