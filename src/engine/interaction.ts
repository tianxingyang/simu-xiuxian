import type { RichEvent, RichSparringEvent, RichTeachingEvent } from '../types.js';
import { getSimTuning } from '../sim-tuning.js';
import { getRegionName, round2 } from '../constants/index.js';
import type { SimulationEngine } from './simulation.js';
import {
  findAlly, addAlly, isFellowDisciple, hasVendettaAgainst,
} from './relationship.js';
import { profiler } from './profiler.js';

type EventBuffer = RichEvent[] | null;

export function processSparring(
  aId: number, bId: number, engine: SimulationEngine, events: EventBuffer,
): void {
  const tuning = getSimTuning();
  const it = tuning.interaction;
  const a = engine.cultivators[aId];
  const b = engine.cultivators[bId];

  const range = it.sparringCultivationMax - it.sparringCultivationMin;
  const baseA = it.sparringCultivationMin + engine.prng() * range;
  const baseB = it.sparringCultivationMin + engine.prng() * range;

  // Weaker side gains slightly more
  let gainA: number;
  let gainB: number;
  if (a.cultivation <= b.cultivation) {
    gainA = round2(baseA * 1.2);
    gainB = round2(baseB);
  } else {
    gainA = round2(baseA);
    gainB = round2(baseB * 1.2);
  }

  a.cultivation += gainA;
  b.cultivation += gainB;

  // Ally strength gain
  if (tuning.relationship.enabled) {
    addAlly(engine.relationships[aId], bId, engine.year, it.sparringAllyStrengthGain);
    addAlly(engine.relationships[bId], aId, engine.year, it.sparringAllyStrengthGain);
  }

  if (events && (a.level >= 2 || b.level >= 2)) {
    const an = engine.hooks?.getName(aId);
    const bn = engine.hooks?.getName(bId);
    const se: RichSparringEvent = {
      type: 'sparring',
      year: engine.year,
      newsRank: Math.max(a.level, b.level) >= 4 ? 'B' : 'C',
      actorA: { id: aId, name: an, level: a.level },
      actorB: { id: bId, name: bn, level: b.level },
      cultivationGained: [gainA, gainB],
      region: getRegionName(a.x, a.y),
    };
    events.push(se);
  }
}

export function processTeaching(
  teacherId: number, studentId: number, engine: SimulationEngine,
  isMentorTeaching: boolean, events: EventBuffer,
): void {
  const tuning = getSimTuning();
  const it = tuning.interaction;
  const teacher = engine.cultivators[teacherId];
  const student = engine.cultivators[studentId];

  const boostRate = isMentorTeaching ? it.teachingBoostRateMentor : it.teachingBoostRateAlly;
  const newRate = Math.min(it.teachingBoostRateMax, student.teachingBoostRate + boostRate);
  student.teachingBoostRate = newRate;
  student.teachingBoostUntil = engine.year + it.teachingBoostDuration;

  // Teacher gains small cultivation
  teacher.cultivation += it.teacherCultivationGain;

  // Ally strength gain (only for non-mentor teaching)
  if (!isMentorTeaching && tuning.relationship.enabled) {
    addAlly(engine.relationships[teacherId], studentId, engine.year, it.sparringAllyStrengthGain);
    addAlly(engine.relationships[studentId], teacherId, engine.year, it.sparringAllyStrengthGain);
  }

  if (events && (teacher.level >= 2 || student.level >= 2)) {
    const tn = engine.hooks?.getName(teacherId);
    const sn = engine.hooks?.getName(studentId);
    const te: RichTeachingEvent = {
      type: 'teaching',
      year: engine.year,
      newsRank: isMentorTeaching ? 'C' : (teacher.level >= 4 ? 'B' : 'C'),
      teacher: { id: teacherId, name: tn, level: teacher.level },
      student: { id: studentId, name: sn, level: student.level },
      boostRate: newRate,
      boostDuration: it.teachingBoostDuration,
      isMentorTeaching,
      region: getRegionName(teacher.x, teacher.y),
    };
    events.push(te);
  }
}

function canSpar(aId: number, bId: number, engine: SimulationEngine): boolean {
  const a = engine.cultivators[aId];
  const b = engine.cultivators[bId];

  if (Math.abs(a.level - b.level) > 1) return false;
  if (a.level === 0 && b.level === 0) return false;

  const tuning = getSimTuning();
  if (!tuning.relationship.enabled) return false;

  const aRel = engine.relationships[aId];
  const bRel = engine.relationships[bId];

  // Must not have vendetta
  if (hasVendettaAgainst(aRel, bId) || hasVendettaAgainst(bRel, aId)) return false;

  // Must have ally, fellow disciple, or kin (same origin settlement) relation
  const isAllyPair = findAlly(aRel, bId) !== null;
  const isFellow = isFellowDisciple(aRel, bRel);
  const isKin = a.originSettlementId >= 0 && a.originSettlementId === b.originSettlementId;

  return isAllyPair || isFellow || isKin;
}

function canTeach(teacherId: number, studentId: number, engine: SimulationEngine): boolean {
  const teacher = engine.cultivators[teacherId];
  const student = engine.cultivators[studentId];

  if (teacher.level - student.level < 2) return false;
  if (student.level === 0 && teacher.level < 2) return false;
  if (teacher.behaviorState !== 'settling') return false;

  const tuning = getSimTuning();
  if (!tuning.relationship.enabled) return false;

  const tRel = engine.relationships[teacherId];

  // Must have mentor-disciple or ally relation
  const isMentor = student.id >= 0 &&
    engine.relationships[studentId].mentor === teacherId;
  if (isMentor) return true;

  const allyEntry = findAlly(tRel, studentId);
  return allyEntry !== null && allyEntry.strength >= 0.3;
}

export function processNonCombatEncounters(engine: SimulationEngine, events: EventBuffer): void {
  profiler.start('processNonCombatEncounters');
  const tuning = getSimTuning();
  const it = tuning.interaction;

  if (!it.enabled || !tuning.relationship.enabled) {
    profiler.end('processNonCombatEncounters');
    return;
  }

  const prng = engine.prng;

  for (let i = 0; i < engine.nextId; i++) {
    const c = engine.cultivators[i];
    if (!c.alive || c.level === 0) continue;

    const radius = tuning.spatial.encounterRadius[c.level];
    const nearbyId = engine.spatialIndex.findNearbyAny(c.x, c.y, Math.min(radius, 4), c.id);
    if (nearbyId < 0) continue;

    const nearby = engine.cultivators[nearbyId];
    if (!nearby.alive) continue;

    // Try teaching (higher priority)
    if (canTeach(i, nearbyId, engine)) {
      if (prng() < it.teachingProbability) {
        const isMentor = engine.relationships[nearbyId].mentor === i;
        processTeaching(i, nearbyId, engine, isMentor, events);
        continue;
      }
    } else if (canTeach(nearbyId, i, engine)) {
      if (prng() < it.teachingProbability) {
        const isMentor = engine.relationships[i].mentor === nearbyId;
        processTeaching(nearbyId, i, engine, isMentor, events);
        continue;
      }
    }

    // Try sparring
    if (canSpar(i, nearbyId, engine)) {
      // Adjust probability based on ally strength
      let prob = it.sparringProbability;
      const aRel = engine.relationships[i];
      const allyEntry = findAlly(aRel, nearbyId);
      if (allyEntry) {
        prob += allyEntry.strength * 0.1;
      }
      if (prng() < prob) {
        processSparring(i, nearbyId, engine, events);
      }
    }
  }

  profiler.end('processNonCombatEncounters');
}
