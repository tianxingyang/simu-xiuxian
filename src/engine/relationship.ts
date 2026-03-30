import type { RelationshipTuning } from '../sim-tuning.js';

// --- Buffer sizes ---
export const ALLY_BUFFER_SIZE = 6;
export const RIVAL_BUFFER_SIZE = 4;
export const VENDETTA_BUFFER_SIZE = 2;
export const MAX_DISCIPLES = 3;

// --- Vendetta reason codes ---
export const VENDETTA_KILLED_MENTOR = 0;
export const VENDETTA_KILLED_DISCIPLE = 1;
export const VENDETTA_KILLED_CLOSE_ALLY = 2;

export type VendettaReason = 'killed_mentor' | 'killed_disciple' | 'killed_close_ally';
const VENDETTA_REASON_ENCODE: Readonly<Record<VendettaReason, number>> = {
  killed_mentor: VENDETTA_KILLED_MENTOR,
  killed_disciple: VENDETTA_KILLED_DISCIPLE,
  killed_close_ally: VENDETTA_KILLED_CLOSE_ALLY,
};
const _VENDETTA_REASON_DECODE: readonly VendettaReason[] = [
  'killed_mentor', 'killed_disciple', 'killed_close_ally',
];
void _VENDETTA_REASON_DECODE;

export interface AllyEntry {
  id: number;       // -1 = empty slot
  strength: number; // 0.0 ~ 1.0
  formedAt: number; // year
}

export interface RivalEntry {
  id: number;        // -1 = empty slot
  intensity: number; // 0.0 ~ 1.0
  formedAt: number;  // year
}

export interface VendettaEntry {
  targetId: number;  // -1 = empty slot
  reason: number;    // VENDETTA_KILLED_MENTOR / DISCIPLE / CLOSE_ALLY
  formedAt: number;  // year
}

export interface CharacterRelationships {
  mentor: number; // id or -1
  disciples: number[]; // up to MAX_DISCIPLES, -1 = empty slot
  discipleCount: number;

  allies: AllyEntry[];
  allyHead: number;

  rivals: RivalEntry[];
  rivalHead: number;

  vendettas: VendettaEntry[];

  // Relationship milestones
  firstMentorYear: number;   // 0 = not set
  firstAllyYear: number;
  vendettaDeclaredYear: number;
}

// --- Serialization byte sizes ---
// mentor(i32) + discipleCount(u8) + disciples(3 * i32) + allyHead(u8) + rivalHead(u8)
// + allies(6 * (i32 + f64 + i32)) + rivals(4 * (i32 + f64 + i32)) + vendettas(2 * (i32 + u8 + i32))
// + milestones(3 * i32)
const MENTOR_BYTES = 4;
const DISCIPLE_META_BYTES = 1; // discipleCount(u8)
const DISCIPLE_BYTES = MAX_DISCIPLES * 4;
const HEAD_BYTES = 2; // allyHead(u8) + rivalHead(u8)
const ALLY_ENTRY_BYTES = 4 + 8 + 4; // id(i32) + strength(f64) + formedAt(i32)
const RIVAL_ENTRY_BYTES = 4 + 8 + 4;
const VENDETTA_ENTRY_BYTES = 4 + 1 + 4; // targetId(i32) + reason(u8) + formedAt(i32)
const MILESTONE_BYTES = 3 * 4; // 3 * i32

export const RELATIONSHIP_SERIALIZE_BYTES =
  MENTOR_BYTES +
  DISCIPLE_META_BYTES +
  DISCIPLE_BYTES +
  HEAD_BYTES +
  ALLY_BUFFER_SIZE * ALLY_ENTRY_BYTES +
  RIVAL_BUFFER_SIZE * RIVAL_ENTRY_BYTES +
  VENDETTA_BUFFER_SIZE * VENDETTA_ENTRY_BYTES +
  MILESTONE_BYTES;

// --- Factory ---

function emptyAlly(): AllyEntry {
  return { id: -1, strength: 0, formedAt: 0 };
}

function emptyRival(): RivalEntry {
  return { id: -1, intensity: 0, formedAt: 0 };
}

function emptyVendetta(): VendettaEntry {
  return { targetId: -1, reason: 0, formedAt: 0 };
}

export function createEmptyRelationships(): CharacterRelationships {
  const allies: AllyEntry[] = new Array(ALLY_BUFFER_SIZE);
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) allies[i] = emptyAlly();
  const rivals: RivalEntry[] = new Array(RIVAL_BUFFER_SIZE);
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) rivals[i] = emptyRival();
  const vendettas: VendettaEntry[] = new Array(VENDETTA_BUFFER_SIZE);
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) vendettas[i] = emptyVendetta();
  const disciples = new Array<number>(MAX_DISCIPLES).fill(-1);

  return {
    mentor: -1,
    disciples,
    discipleCount: 0,
    allies,
    allyHead: 0,
    rivals,
    rivalHead: 0,
    vendettas,
    firstMentorYear: 0,
    firstAllyYear: 0,
    vendettaDeclaredYear: 0,
  };
}

export function resetRelationships(rel: CharacterRelationships): void {
  rel.mentor = -1;
  rel.disciples.fill(-1);
  rel.discipleCount = 0;
  rel.allyHead = 0;
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    rel.allies[i].id = -1;
    rel.allies[i].strength = 0;
    rel.allies[i].formedAt = 0;
  }
  rel.rivalHead = 0;
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    rel.rivals[i].id = -1;
    rel.rivals[i].intensity = 0;
    rel.rivals[i].formedAt = 0;
  }
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    rel.vendettas[i].targetId = -1;
    rel.vendettas[i].reason = 0;
    rel.vendettas[i].formedAt = 0;
  }
  rel.firstMentorYear = 0;
  rel.firstAllyYear = 0;
  rel.vendettaDeclaredYear = 0;
}

// --- Ally ring buffer ops ---

export function findAlly(rel: CharacterRelationships, id: number): AllyEntry | null {
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    if (rel.allies[i].id === id) return rel.allies[i];
  }
  return null;
}

export function addAlly(rel: CharacterRelationships, id: number, year: number, strengthDelta: number): void {
  const existing = findAlly(rel, id);
  if (existing) {
    existing.strength = clamp01(existing.strength + strengthDelta);
    return;
  }
  // Find weakest slot or use head
  let weakestIdx = -1;
  let weakestStr = Infinity;
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    if (rel.allies[i].id === -1) { weakestIdx = i; break; }
    if (rel.allies[i].strength < weakestStr) {
      weakestStr = rel.allies[i].strength;
      weakestIdx = i;
    }
  }
  const idx = weakestIdx >= 0 ? weakestIdx : rel.allyHead;
  const entry = rel.allies[idx];
  entry.id = id;
  entry.strength = clamp01(strengthDelta);
  entry.formedAt = year;
  rel.allyHead = (idx + 1) % ALLY_BUFFER_SIZE;
  if (rel.firstAllyYear === 0) rel.firstAllyYear = year;
}

export function removeAlly(rel: CharacterRelationships, id: number): void {
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    if (rel.allies[i].id === id) {
      rel.allies[i].id = -1;
      rel.allies[i].strength = 0;
      rel.allies[i].formedAt = 0;
      return;
    }
  }
}

// --- Rival ring buffer ops ---

export function findRival(rel: CharacterRelationships, id: number): RivalEntry | null {
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    if (rel.rivals[i].id === id) return rel.rivals[i];
  }
  return null;
}

export function addRival(rel: CharacterRelationships, id: number, year: number, intensityDelta: number): void {
  const existing = findRival(rel, id);
  if (existing) {
    existing.intensity = clamp01(existing.intensity + intensityDelta);
    return;
  }
  let weakestIdx = -1;
  let weakestInt = Infinity;
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    if (rel.rivals[i].id === -1) { weakestIdx = i; break; }
    if (rel.rivals[i].intensity < weakestInt) {
      weakestInt = rel.rivals[i].intensity;
      weakestIdx = i;
    }
  }
  const idx = weakestIdx >= 0 ? weakestIdx : rel.rivalHead;
  const entry = rel.rivals[idx];
  entry.id = id;
  entry.intensity = clamp01(intensityDelta);
  entry.formedAt = year;
  rel.rivalHead = (idx + 1) % RIVAL_BUFFER_SIZE;
}

export function removeRival(rel: CharacterRelationships, id: number): void {
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    if (rel.rivals[i].id === id) {
      rel.rivals[i].id = -1;
      rel.rivals[i].intensity = 0;
      rel.rivals[i].formedAt = 0;
      return;
    }
  }
}

// --- Vendetta ops ---

export function addVendetta(rel: CharacterRelationships, targetId: number, reason: VendettaReason, year: number): void {
  // Check if already has vendetta against target
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    if (rel.vendettas[i].targetId === targetId) return;
  }
  // Find empty slot
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    if (rel.vendettas[i].targetId === -1) {
      rel.vendettas[i].targetId = targetId;
      rel.vendettas[i].reason = VENDETTA_REASON_ENCODE[reason];
      rel.vendettas[i].formedAt = year;
      if (rel.vendettaDeclaredYear === 0) rel.vendettaDeclaredYear = year;
      return;
    }
  }
  // Buffer full: replace oldest
  let oldestIdx = 0;
  let oldestYear = rel.vendettas[0].formedAt;
  for (let i = 1; i < VENDETTA_BUFFER_SIZE; i++) {
    if (rel.vendettas[i].formedAt < oldestYear) {
      oldestYear = rel.vendettas[i].formedAt;
      oldestIdx = i;
    }
  }
  rel.vendettas[oldestIdx].targetId = targetId;
  rel.vendettas[oldestIdx].reason = VENDETTA_REASON_ENCODE[reason];
  rel.vendettas[oldestIdx].formedAt = year;
}

export function removeVendetta(rel: CharacterRelationships, targetId: number): void {
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    if (rel.vendettas[i].targetId === targetId) {
      rel.vendettas[i].targetId = -1;
      rel.vendettas[i].reason = 0;
      rel.vendettas[i].formedAt = 0;
      return;
    }
  }
}

export function hasVendettaAgainst(rel: CharacterRelationships, targetId: number): boolean {
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    if (rel.vendettas[i].targetId === targetId) return true;
  }
  return false;
}

// --- Mentor / Disciple ops ---

export function setMentor(rel: CharacterRelationships, mentorId: number, year: number): void {
  rel.mentor = mentorId;
  if (rel.firstMentorYear === 0) rel.firstMentorYear = year;
}

export function clearMentor(rel: CharacterRelationships): void {
  rel.mentor = -1;
}

export function addDisciple(rel: CharacterRelationships, discipleId: number): boolean {
  if (rel.discipleCount >= MAX_DISCIPLES) return false;
  for (let i = 0; i < MAX_DISCIPLES; i++) {
    if (rel.disciples[i] === -1) {
      rel.disciples[i] = discipleId;
      rel.discipleCount++;
      return true;
    }
  }
  return false;
}

export function removeDisciple(rel: CharacterRelationships, discipleId: number): void {
  for (let i = 0; i < MAX_DISCIPLES; i++) {
    if (rel.disciples[i] === discipleId) {
      rel.disciples[i] = -1;
      rel.discipleCount--;
      return;
    }
  }
}

export function hasDisciple(rel: CharacterRelationships, discipleId: number): boolean {
  for (let i = 0; i < MAX_DISCIPLES; i++) {
    if (rel.disciples[i] === discipleId) return true;
  }
  return false;
}

// --- Derived relationships ---

export function isFellowDisciple(
  relA: CharacterRelationships, relB: CharacterRelationships,
): boolean {
  return relA.mentor >= 0 && relA.mentor === relB.mentor;
}

// --- Per-tick decay ---

export function tickRelationshipDecay(rel: CharacterRelationships, rt: RelationshipTuning): void {
  // Ally strength decay
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    const a = rel.allies[i];
    if (a.id === -1) continue;
    a.strength -= rt.allyDecayRate;
    if (a.strength <= 0) {
      a.id = -1;
      a.strength = 0;
      a.formedAt = 0;
    }
  }
  // Rival intensity decay
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    const r = rel.rivals[i];
    if (r.id === -1) continue;
    r.intensity -= rt.rivalDecayRate;
    if (r.intensity <= 0) {
      r.id = -1;
      r.intensity = 0;
      r.formedAt = 0;
    }
  }
}

// --- Cleanup on death (remove references to a dead character) ---

export function purgeDeadFromRelationships(rel: CharacterRelationships, deadId: number): void {
  if (rel.mentor === deadId) rel.mentor = -1;
  removeDisciple(rel, deadId);
  removeAlly(rel, deadId);
  removeRival(rel, deadId);
  removeVendetta(rel, deadId);
}

// --- Query helpers ---

export function strongestAllyStrength(rel: CharacterRelationships): number {
  let max = 0;
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    if (rel.allies[i].id !== -1 && rel.allies[i].strength > max) {
      max = rel.allies[i].strength;
    }
  }
  return max;
}

export function maxRivalIntensity(rel: CharacterRelationships): number {
  let max = 0;
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    if (rel.rivals[i].id !== -1 && rel.rivals[i].intensity > max) {
      max = rel.rivals[i].intensity;
    }
  }
  return max;
}

export function hasAnyVendetta(rel: CharacterRelationships): boolean {
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    if (rel.vendettas[i].targetId !== -1) return true;
  }
  return false;
}

export function isAlly(rel: CharacterRelationships, id: number): boolean {
  return findAlly(rel, id) !== null;
}

export function isRival(rel: CharacterRelationships, id: number): boolean {
  return findRival(rel, id) !== null;
}

// --- Serialization ---

export function serializeRelationships(dv: DataView, off: number, rel: CharacterRelationships): number {
  // Mentor
  dv.setInt32(off, rel.mentor, true); off += 4;
  // Disciples
  dv.setUint8(off, rel.discipleCount); off += 1;
  for (let i = 0; i < MAX_DISCIPLES; i++) {
    dv.setInt32(off, rel.disciples[i], true); off += 4;
  }
  // Heads
  dv.setUint8(off, rel.allyHead); off += 1;
  dv.setUint8(off, rel.rivalHead); off += 1;
  // Allies
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    const a = rel.allies[i];
    dv.setInt32(off, a.id, true); off += 4;
    dv.setFloat64(off, a.strength, true); off += 8;
    dv.setInt32(off, a.formedAt, true); off += 4;
  }
  // Rivals
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    const r = rel.rivals[i];
    dv.setInt32(off, r.id, true); off += 4;
    dv.setFloat64(off, r.intensity, true); off += 8;
    dv.setInt32(off, r.formedAt, true); off += 4;
  }
  // Vendettas
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    const v = rel.vendettas[i];
    dv.setInt32(off, v.targetId, true); off += 4;
    dv.setUint8(off, v.reason); off += 1;
    dv.setInt32(off, v.formedAt, true); off += 4;
  }
  // Milestones
  dv.setInt32(off, rel.firstMentorYear, true); off += 4;
  dv.setInt32(off, rel.firstAllyYear, true); off += 4;
  dv.setInt32(off, rel.vendettaDeclaredYear, true); off += 4;

  return off;
}

export function deserializeRelationships(dv: DataView, off: number): { rel: CharacterRelationships; offset: number } {
  // Mentor
  const mentor = dv.getInt32(off, true); off += 4;
  // Disciples
  const discipleCount = dv.getUint8(off); off += 1;
  const disciples = new Array<number>(MAX_DISCIPLES);
  for (let i = 0; i < MAX_DISCIPLES; i++) {
    disciples[i] = dv.getInt32(off, true); off += 4;
  }
  // Heads
  const allyHead = dv.getUint8(off); off += 1;
  const rivalHead = dv.getUint8(off); off += 1;
  // Allies
  const allies: AllyEntry[] = new Array(ALLY_BUFFER_SIZE);
  for (let i = 0; i < ALLY_BUFFER_SIZE; i++) {
    const id = dv.getInt32(off, true); off += 4;
    const strength = dv.getFloat64(off, true); off += 8;
    const formedAt = dv.getInt32(off, true); off += 4;
    allies[i] = { id, strength, formedAt };
  }
  // Rivals
  const rivals: RivalEntry[] = new Array(RIVAL_BUFFER_SIZE);
  for (let i = 0; i < RIVAL_BUFFER_SIZE; i++) {
    const id = dv.getInt32(off, true); off += 4;
    const intensity = dv.getFloat64(off, true); off += 8;
    const formedAt = dv.getInt32(off, true); off += 4;
    rivals[i] = { id, intensity, formedAt };
  }
  // Vendettas
  const vendettas: VendettaEntry[] = new Array(VENDETTA_BUFFER_SIZE);
  for (let i = 0; i < VENDETTA_BUFFER_SIZE; i++) {
    const targetId = dv.getInt32(off, true); off += 4;
    const reason = dv.getUint8(off); off += 1;
    const formedAt = dv.getInt32(off, true); off += 4;
    vendettas[i] = { targetId, reason, formedAt };
  }
  // Milestones
  const firstMentorYear = dv.getInt32(off, true); off += 4;
  const firstAllyYear = dv.getInt32(off, true); off += 4;
  const vendettaDeclaredYear = dv.getInt32(off, true); off += 4;

  const rel: CharacterRelationships = {
    mentor, disciples, discipleCount,
    allies, allyHead, rivals, rivalHead, vendettas,
    firstMentorYear, firstAllyYear, vendettaDeclaredYear,
  };
  return { rel, offset: off };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
