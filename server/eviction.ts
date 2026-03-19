import { evictExpiredEvents, processMemoryDecayBatch } from './db.js';
import { getLogger } from './logger.js';

const log = getLogger('eviction');

const EVENT_RETENTION: Record<string, number> = { B: 200, A: 2000, S: 15000 };

const CULTIVATOR_MEMORY_YEARS: Record<number, number> = {
  0: 0, 1: 0, 2: 100, 3: 300, 4: 800, 5: 2000, 6: 5000, 7: 15000,
};

let _lastEvictRealTs = 0;
const EVICT_REAL_INTERVAL = 10_000;
let _lastDecayRealTs = Date.now();
const DECAY_REAL_INTERVAL = 60_000;

export function runEviction(currentYear: number): void {
  const now = Date.now();

  if (now - _lastEvictRealTs >= EVICT_REAL_INTERVAL) {
    _lastEvictRealTs = now;
    const deleted = evictExpiredEvents(currentYear, EVENT_RETENTION);
    if (deleted > 0) {
      log.debug(`deleted ${deleted} expired events at year ${currentYear}`);
    }
  }

  if (now - _lastDecayRealTs >= DECAY_REAL_INTERVAL) {
    _lastDecayRealTs = now;
    const { marked, unprotected, purged } = processMemoryDecayBatch(currentYear, CULTIVATOR_MEMORY_YEARS);
    if (marked > 0 || unprotected > 0 || purged > 0) {
      log.debug(`decay: ${marked} forgotten, ${unprotected} events unprotected, ${purged} cultivators purged at year ${currentYear}`);
    }
  }
}
