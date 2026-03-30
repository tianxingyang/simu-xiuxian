import type { Cultivator } from '../types.js';
import type { MemoryTuning } from '../sim-tuning.js';

// --- Encounter outcome codes ---
export const ENCOUNTER_WIN = 0;
export const ENCOUNTER_LOSS = 1;
export const ENCOUNTER_FLED = 2;
export const ENCOUNTER_KIN_KILLED = 3;

// --- Place memory type codes ---
export const PLACE_DANGER = 0;
export const PLACE_BREAKTHROUGH = 1;

export const ENCOUNTER_BUFFER_SIZE = 12;
export const PLACE_BUFFER_SIZE = 4;

export interface EncounterEntry {
  opponentId: number;  // -1 = empty slot
  outcome: number;     // ENCOUNTER_WIN / LOSS / FLED / KIN_KILLED
  year: number;
}

export interface PlaceEntry {
  cellIdx: number;  // -1 = empty slot
  type: number;     // PLACE_DANGER / PLACE_BREAKTHROUGH
  year: number;
}

export interface MilestoneMarkers {
  firstCombatYear: number;       // 0 = not set
  firstInjuryYear: number;
  firstBreakthroughYear: number;
  firstKillYear: number;
  worstDefeatYear: number;
  worstDefeatOpponentId: number;
  greatestVictoryYear: number;
  greatestVictoryOpponentId: number;
}

export interface CharacterMemory {
  // Emotional states (all [0, 1], decay toward baseline each tick)
  confidence: number;
  caution: number;
  ambition: number;
  bloodlust: number;
  rootedness: number;
  breakthroughFear: number;

  // Encounter ring buffer
  encounters: EncounterEntry[];
  encounterHead: number;

  // Place ring buffer
  places: PlaceEntry[];
  placeHead: number;

  // Accumulated stats (clamped to u16 range)
  combatWins: number;
  combatLosses: number;
  kills: number;
  breakthroughAttempts: number;
  breakthroughSuccesses: number;
  heavyInjuries: number;
  yearsSettled: number;
  timesDisplaced: number;

  // Narrative milestones
  milestones: MilestoneMarkers;
}

// --- Serialization byte sizes ---
const EMOTIONAL_FIELDS = 6;
const STAT_FIELDS = 8;
const ENCOUNTER_ENTRY_BYTES = 4 + 1 + 4; // opponentId(i32) + outcome(u8) + year(i32)
const PLACE_ENTRY_BYTES = 2 + 1 + 4;     // cellIdx(u16) + type(u8) + year(i32)
const MILESTONE_BYTES = 8 * 4;           // 8 × i32
const METADATA_BYTES = 2;                // encounterHead(u8) + placeHead(u8)

export const MEMORY_SERIALIZE_BYTES =
  EMOTIONAL_FIELDS * 8 +                           // 6 × float64
  ENCOUNTER_BUFFER_SIZE * ENCOUNTER_ENTRY_BYTES +   // 12 × 9
  PLACE_BUFFER_SIZE * PLACE_ENTRY_BYTES +           // 4 × 7
  STAT_FIELDS * 2 +                                 // 8 × u16
  MILESTONE_BYTES +
  METADATA_BYTES;

function emptyEncounterEntry(): EncounterEntry {
  return { opponentId: -1, outcome: 0, year: 0 };
}

function emptyPlaceEntry(): PlaceEntry {
  return { cellIdx: -1, type: 0, year: 0 };
}

function emptyMilestones(): MilestoneMarkers {
  return {
    firstCombatYear: 0, firstInjuryYear: 0,
    firstBreakthroughYear: 0, firstKillYear: 0,
    worstDefeatYear: 0, worstDefeatOpponentId: -1,
    greatestVictoryYear: 0, greatestVictoryOpponentId: -1,
  };
}

export function createEmptyMemory(c: Cultivator): CharacterMemory {
  const encounters: EncounterEntry[] = new Array(ENCOUNTER_BUFFER_SIZE);
  for (let i = 0; i < ENCOUNTER_BUFFER_SIZE; i++) encounters[i] = emptyEncounterEntry();
  const places: PlaceEntry[] = new Array(PLACE_BUFFER_SIZE);
  for (let i = 0; i < PLACE_BUFFER_SIZE; i++) places[i] = emptyPlaceEntry();

  return {
    confidence: c.courage,  // baseline = innate courage
    caution: 0,
    ambition: 0.5,
    bloodlust: 0,
    rootedness: 0,
    breakthroughFear: 0,

    encounters,
    encounterHead: 0,
    places,
    placeHead: 0,

    combatWins: 0, combatLosses: 0, kills: 0,
    breakthroughAttempts: 0, breakthroughSuccesses: 0,
    heavyInjuries: 0, yearsSettled: 0, timesDisplaced: 0,

    milestones: emptyMilestones(),
  };
}

export function resetMemory(mem: CharacterMemory, c: Cultivator): void {
  mem.confidence = c.courage;
  mem.caution = 0;
  mem.ambition = 0.5;
  mem.bloodlust = 0;
  mem.rootedness = 0;
  mem.breakthroughFear = 0;
  mem.encounterHead = 0;
  for (let i = 0; i < ENCOUNTER_BUFFER_SIZE; i++) {
    mem.encounters[i].opponentId = -1;
    mem.encounters[i].outcome = 0;
    mem.encounters[i].year = 0;
  }
  mem.placeHead = 0;
  for (let i = 0; i < PLACE_BUFFER_SIZE; i++) {
    mem.places[i].cellIdx = -1;
    mem.places[i].type = 0;
    mem.places[i].year = 0;
  }
  mem.combatWins = 0; mem.combatLosses = 0; mem.kills = 0;
  mem.breakthroughAttempts = 0; mem.breakthroughSuccesses = 0;
  mem.heavyInjuries = 0; mem.yearsSettled = 0; mem.timesDisplaced = 0;
  const ms = mem.milestones;
  ms.firstCombatYear = 0; ms.firstInjuryYear = 0;
  ms.firstBreakthroughYear = 0; ms.firstKillYear = 0;
  ms.worstDefeatYear = 0; ms.worstDefeatOpponentId = -1;
  ms.greatestVictoryYear = 0; ms.greatestVictoryOpponentId = -1;
}

// --- Per-tick emotional decay ---

function decay(value: number, baseline: number, rate: number): number {
  return baseline + (value - baseline) * rate;
}

export function tickEmotionalDecay(mem: CharacterMemory, c: Cultivator, mt: MemoryTuning): void {
  const r = mt.emotionalDecayRate;
  mem.confidence = decay(mem.confidence, c.courage, r);
  mem.caution = decay(mem.caution, 0, r);
  mem.ambition = decay(mem.ambition, 0.5, r);
  mem.bloodlust = decay(mem.bloodlust, 0, r);
  mem.rootedness = decay(mem.rootedness, 0, r);
  mem.breakthroughFear = decay(mem.breakthroughFear, 0, r);
}

export function tickRootedness(mem: CharacterMemory, isSettling: boolean, mt: MemoryTuning): void {
  if (isSettling) {
    mem.rootedness = Math.min(1, mem.rootedness + mt.rootednessSettlingDelta);
    mem.yearsSettled = mem.yearsSettled < 65535 ? mem.yearsSettled + 1 : 65535;
  }
}

// --- Event-driven updates ---

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function onCombatWin(mem: CharacterMemory, opponentId: number, killed: boolean, year: number, mt: MemoryTuning): void {
  pushEncounter(mem, opponentId, ENCOUNTER_WIN, year);
  mem.confidence = clamp01(mem.confidence + mt.confidenceWinDelta);
  mem.bloodlust = clamp01(mem.bloodlust + (killed ? mt.bloodlustKillDelta : mt.bloodlustWinDelta));
  mem.combatWins = mem.combatWins < 65535 ? mem.combatWins + 1 : 65535;
  if (killed) mem.kills = mem.kills < 65535 ? mem.kills + 1 : 65535;
  // Milestone: first combat
  if (mem.milestones.firstCombatYear === 0) mem.milestones.firstCombatYear = year;
  if (killed && mem.milestones.firstKillYear === 0) mem.milestones.firstKillYear = year;
}

export function onCombatLoss(
  mem: CharacterMemory, opponentId: number, year: number,
  wasHeavyInjury: boolean, wasLightInjury: boolean, mt: MemoryTuning,
): void {
  pushEncounter(mem, opponentId, ENCOUNTER_LOSS, year);
  mem.confidence = clamp01(mem.confidence - mt.confidenceLossDelta);
  mem.combatLosses = mem.combatLosses < 65535 ? mem.combatLosses + 1 : 65535;
  if (wasHeavyInjury) {
    mem.caution = clamp01(mem.caution + mt.cautionHeavyInjuryDelta);
    mem.heavyInjuries = mem.heavyInjuries < 65535 ? mem.heavyInjuries + 1 : 65535;
    if (mem.milestones.firstInjuryYear === 0) mem.milestones.firstInjuryYear = year;
  } else if (wasLightInjury) {
    mem.caution = clamp01(mem.caution + mt.cautionLightInjuryDelta);
  }
  // Rootedness disruption
  mem.rootedness = clamp01(mem.rootedness - mt.rootednessDisplaceDelta);
  // Milestone: first combat / worst defeat (by cultivation lost / severity)
  if (mem.milestones.firstCombatYear === 0) mem.milestones.firstCombatYear = year;
  if (wasHeavyInjury && (mem.milestones.worstDefeatYear === 0 || year > mem.milestones.worstDefeatYear)) {
    mem.milestones.worstDefeatYear = year;
    mem.milestones.worstDefeatOpponentId = opponentId;
  }
}

export function onKinKilled(mem: CharacterMemory, killerId: number, year: number): void {
  pushEncounter(mem, killerId, ENCOUNTER_KIN_KILLED, year);
}

export function onBreakthroughSuccess(mem: CharacterMemory, cellIdx: number, year: number, mt: MemoryTuning): void {
  pushPlace(mem, cellIdx, PLACE_BREAKTHROUGH, year);
  mem.ambition = clamp01(mem.ambition + mt.ambitionSuccessDelta);
  mem.breakthroughFear = 0;
  mem.breakthroughSuccesses = mem.breakthroughSuccesses < 65535 ? mem.breakthroughSuccesses + 1 : 65535;
  mem.breakthroughAttempts = mem.breakthroughAttempts < 65535 ? mem.breakthroughAttempts + 1 : 65535;
  if (mem.milestones.firstBreakthroughYear === 0) mem.milestones.firstBreakthroughYear = year;
}

export function onBreakthroughFail(mem: CharacterMemory, courage: number, wasInjury: boolean, year: number, mt: MemoryTuning): void {
  mem.breakthroughFear = clamp01(mem.breakthroughFear + mt.breakthroughFearDelta);
  mem.breakthroughAttempts = mem.breakthroughAttempts < 65535 ? mem.breakthroughAttempts + 1 : 65535;
  if (courage >= mt.ambitionCourageThreshold) {
    mem.ambition = clamp01(mem.ambition + mt.ambitionFailHighCourageDelta);
  } else {
    mem.ambition = clamp01(mem.ambition - mt.ambitionFailLowCourageDelta);
  }
  if (wasInjury) {
    mem.caution = clamp01(mem.caution + mt.cautionHeavyInjuryDelta);
    mem.heavyInjuries = mem.heavyInjuries < 65535 ? mem.heavyInjuries + 1 : 65535;
    if (mem.milestones.firstInjuryYear === 0) mem.milestones.firstInjuryYear = year;
  }
}

// --- Ring buffer helpers ---

export function pushEncounter(mem: CharacterMemory, opponentId: number, outcome: number, year: number): void {
  const e = mem.encounters[mem.encounterHead];
  e.opponentId = opponentId;
  e.outcome = outcome;
  e.year = year;
  mem.encounterHead = (mem.encounterHead + 1) % ENCOUNTER_BUFFER_SIZE;
}

export function pushPlace(mem: CharacterMemory, cellIdx: number, type: number, year: number): void {
  const p = mem.places[mem.placeHead];
  p.cellIdx = cellIdx;
  p.type = type;
  p.year = year;
  mem.placeHead = (mem.placeHead + 1) % PLACE_BUFFER_SIZE;
}

export function findEncounter(mem: CharacterMemory, opponentId: number): EncounterEntry | null {
  for (let i = ENCOUNTER_BUFFER_SIZE - 1; i >= 0; i--) {
    const idx = (mem.encounterHead - 1 - i + ENCOUNTER_BUFFER_SIZE * 2) % ENCOUNTER_BUFFER_SIZE;
    const e = mem.encounters[idx];
    if (e.opponentId === opponentId) return e;
  }
  return null;
}

export function countEncountersWith(mem: CharacterMemory, opponentId: number): { wins: number; losses: number; total: number } {
  let wins = 0, losses = 0, total = 0;
  for (let i = 0; i < ENCOUNTER_BUFFER_SIZE; i++) {
    const e = mem.encounters[i];
    if (e.opponentId === opponentId) {
      total++;
      if (e.outcome === ENCOUNTER_WIN) wins++;
      else if (e.outcome === ENCOUNTER_LOSS) losses++;
    }
  }
  return { wins, losses, total };
}

export function findPlaceByType(mem: CharacterMemory, type: number): PlaceEntry | null {
  // Search backward from head for most recent
  for (let i = 0; i < PLACE_BUFFER_SIZE; i++) {
    const idx = (mem.placeHead - 1 - i + PLACE_BUFFER_SIZE * 2) % PLACE_BUFFER_SIZE;
    const p = mem.places[idx];
    if (p.cellIdx !== -1 && p.type === type) return p;
  }
  return null;
}

const U16_MAX = 65535;

export function incrementStat(mem: CharacterMemory, field: keyof CharacterMemory, delta = 1): void {
  const v = (mem[field] as number) + delta;
  (mem as Record<string, number>)[field as string] = v > U16_MAX ? U16_MAX : v;
}

// --- Serialization ---

export function serializeMemory(dv: DataView, off: number, mem: CharacterMemory): number {
  // Emotional states (6 × float64)
  dv.setFloat64(off, mem.confidence, true); off += 8;
  dv.setFloat64(off, mem.caution, true); off += 8;
  dv.setFloat64(off, mem.ambition, true); off += 8;
  dv.setFloat64(off, mem.bloodlust, true); off += 8;
  dv.setFloat64(off, mem.rootedness, true); off += 8;
  dv.setFloat64(off, mem.breakthroughFear, true); off += 8;

  // Metadata
  dv.setUint8(off, mem.encounterHead); off += 1;
  dv.setUint8(off, mem.placeHead); off += 1;

  // Encounters (12 entries)
  for (let i = 0; i < ENCOUNTER_BUFFER_SIZE; i++) {
    const e = mem.encounters[i];
    dv.setInt32(off, e.opponentId, true); off += 4;
    dv.setUint8(off, e.outcome); off += 1;
    dv.setInt32(off, e.year, true); off += 4;
  }

  // Places (4 entries)
  for (let i = 0; i < PLACE_BUFFER_SIZE; i++) {
    const p = mem.places[i];
    dv.setUint16(off, p.cellIdx === -1 ? 0xFFFF : p.cellIdx, true); off += 2;
    dv.setUint8(off, p.type); off += 1;
    dv.setInt32(off, p.year, true); off += 4;
  }

  // Stats (8 × u16)
  dv.setUint16(off, mem.combatWins, true); off += 2;
  dv.setUint16(off, mem.combatLosses, true); off += 2;
  dv.setUint16(off, mem.kills, true); off += 2;
  dv.setUint16(off, mem.breakthroughAttempts, true); off += 2;
  dv.setUint16(off, mem.breakthroughSuccesses, true); off += 2;
  dv.setUint16(off, mem.heavyInjuries, true); off += 2;
  dv.setUint16(off, mem.yearsSettled, true); off += 2;
  dv.setUint16(off, mem.timesDisplaced, true); off += 2;

  // Milestones (8 × i32)
  const ms = mem.milestones;
  dv.setInt32(off, ms.firstCombatYear, true); off += 4;
  dv.setInt32(off, ms.firstInjuryYear, true); off += 4;
  dv.setInt32(off, ms.firstBreakthroughYear, true); off += 4;
  dv.setInt32(off, ms.firstKillYear, true); off += 4;
  dv.setInt32(off, ms.worstDefeatYear, true); off += 4;
  dv.setInt32(off, ms.worstDefeatOpponentId, true); off += 4;
  dv.setInt32(off, ms.greatestVictoryYear, true); off += 4;
  dv.setInt32(off, ms.greatestVictoryOpponentId, true); off += 4;

  return off;
}

export function deserializeMemory(dv: DataView, off: number): { mem: CharacterMemory; offset: number } {
  // Emotional states
  const confidence = dv.getFloat64(off, true); off += 8;
  const caution = dv.getFloat64(off, true); off += 8;
  const ambition = dv.getFloat64(off, true); off += 8;
  const bloodlust = dv.getFloat64(off, true); off += 8;
  const rootedness = dv.getFloat64(off, true); off += 8;
  const breakthroughFear = dv.getFloat64(off, true); off += 8;

  // Metadata
  const encounterHead = dv.getUint8(off); off += 1;
  const placeHead = dv.getUint8(off); off += 1;

  // Encounters
  const encounters: EncounterEntry[] = new Array(ENCOUNTER_BUFFER_SIZE);
  for (let i = 0; i < ENCOUNTER_BUFFER_SIZE; i++) {
    const opponentId = dv.getInt32(off, true); off += 4;
    const outcome = dv.getUint8(off); off += 1;
    const year = dv.getInt32(off, true); off += 4;
    encounters[i] = { opponentId, outcome, year };
  }

  // Places
  const places: PlaceEntry[] = new Array(PLACE_BUFFER_SIZE);
  for (let i = 0; i < PLACE_BUFFER_SIZE; i++) {
    const raw = dv.getUint16(off, true); off += 2;
    const cellIdx = raw === 0xFFFF ? -1 : raw;
    const type = dv.getUint8(off); off += 1;
    const year = dv.getInt32(off, true); off += 4;
    places[i] = { cellIdx, type, year };
  }

  // Stats
  const combatWins = dv.getUint16(off, true); off += 2;
  const combatLosses = dv.getUint16(off, true); off += 2;
  const kills = dv.getUint16(off, true); off += 2;
  const breakthroughAttempts = dv.getUint16(off, true); off += 2;
  const breakthroughSuccesses = dv.getUint16(off, true); off += 2;
  const heavyInjuries = dv.getUint16(off, true); off += 2;
  const yearsSettled = dv.getUint16(off, true); off += 2;
  const timesDisplaced = dv.getUint16(off, true); off += 2;

  // Milestones
  const firstCombatYear = dv.getInt32(off, true); off += 4;
  const firstInjuryYear = dv.getInt32(off, true); off += 4;
  const firstBreakthroughYear = dv.getInt32(off, true); off += 4;
  const firstKillYear = dv.getInt32(off, true); off += 4;
  const worstDefeatYear = dv.getInt32(off, true); off += 4;
  const worstDefeatOpponentId = dv.getInt32(off, true); off += 4;
  const greatestVictoryYear = dv.getInt32(off, true); off += 4;
  const greatestVictoryOpponentId = dv.getInt32(off, true); off += 4;

  const mem: CharacterMemory = {
    confidence, caution, ambition, bloodlust, rootedness, breakthroughFear,
    encounters, encounterHead, places, placeHead,
    combatWins, combatLosses, kills,
    breakthroughAttempts, breakthroughSuccesses, heavyInjuries, yearsSettled, timesDisplaced,
    milestones: {
      firstCombatYear, firstInjuryYear, firstBreakthroughYear, firstKillYear,
      worstDefeatYear, worstDefeatOpponentId, greatestVictoryYear, greatestVictoryOpponentId,
    },
  };
  return { mem, offset: off };
}
