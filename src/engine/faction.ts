import type { Cultivator, Faction, RichEvent, RichFactionDissolvedEvent, RichFactionFoundedEvent } from '../types.js';
import type { PRNG } from './prng.js';
import type { RegionCode } from '../constants/region.js';
import {
  FACTION_LEADER_MIN_LEVEL,
  FACTION_MIN_UNAFFILIATED,
  FACTION_CHECK_INTERVAL,
  FACTION_RECRUIT_PROB_BASE,
  FACTION_RECRUIT_LEVEL_DIFF_BONUS,
  LEVEL_COUNT,
  MAP_SIZE,
  getRegionCode,
  getRegionName,
  REGION_NAMES,
} from '../constants/index.js';

/** Scheme A: classic two-char imagery + suffix → 青云门, 碧落谷 */
const SECT_PAIR = [
  '青云', '碧落', '太虚', '九霄', '万象', '天枢', '紫霄', '玄天',
  '苍穹', '凌云', '清风', '明月', '寒山', '落星', '幽冥', '瑶池',
  '蓬莱', '昆仑', '长生', '无极', '玉京', '沧海', '千机', '浩然',
  '天衡', '星河',
] as const;

/** Scheme B head: single-char adjective → 天, 玄, 紫 */
const SECT_HEAD = [
  '天', '玄', '紫', '青', '苍', '碧', '灵', '金',
  '玉', '赤', '白', '翠', '凌', '太', '清', '冰',
] as const;

/** Scheme B tail: object + org suffix → 剑宗, 云门, 霄宫 */
const SECT_COMPOUND_TAIL = [
  '剑宗', '云门', '霄宫', '灵阁', '火殿', '水谷', '雷院',
  '鹤庐', '月派', '岚盟', '风堂', '华阁', '龙宗', '凤阁',
  '鸾宫', '花谷',
] as const;

/** Scheme C middle: celestial/geographic imagery → 霞, 岳, 渊 */
const SECT_MIDDLE = [
  '霞', '虹', '岳', '渊', '溟', '泽', '崖', '峰', '霄', '焰', '澜', '泉',
] as const;

const SECT_SUFFIX = [
  '宗', '门', '派', '阁', '谷', '殿', '洞', '庐', '院', '盟',
] as const;

export class FactionSystem {
  private factions = new Map<number, Faction>();
  private nextId = 0;
  /** regionCode -> Set<factionId> */
  private regionFactions = new Map<string, Set<number>>();
  /** cultivatorId -> factionId */
  private memberIndex = new Map<number, number>();

  get count(): number {
    return this.factions.size;
  }

  getFaction(id: number): Faction | undefined {
    return this.factions.get(id);
  }

  getCultivatorFaction(cultivatorId: number): number {
    return this.memberIndex.get(cultivatorId) ?? -1;
  }

  getRegionFactionIds(regionCode: string): Set<number> | undefined {
    return this.regionFactions.get(regionCode);
  }

  allFactions(): IterableIterator<Faction> {
    return this.factions.values();
  }

  addMember(cultivatorId: number, factionId: number, cultivators: Cultivator[]): void {
    const f = this.factions.get(factionId);
    if (!f) return;
    const prev = this.memberIndex.get(cultivatorId);
    if (prev !== undefined && prev >= 0) {
      this.removeMember(cultivatorId, prev);
    }
    this.memberIndex.set(cultivatorId, factionId);
    cultivators[cultivatorId].factionId = factionId;
    f.memberCount++;
  }

  removeMember(cultivatorId: number, factionId: number): void {
    const f = this.factions.get(factionId);
    if (f && f.memberCount > 0) {
      f.memberCount--;
    }
    const cur = this.memberIndex.get(cultivatorId);
    if (cur === factionId) {
      this.memberIndex.delete(cultivatorId);
    }
  }

  private dissolveFaction(
    factionId: number,
    cultivators: Cultivator[],
    nextCultId: number,
  ): void {
    const f = this.factions.get(factionId);
    if (!f) return;
    // Clear all members
    for (let i = 0; i < nextCultId; i++) {
      if (this.memberIndex.get(i) === factionId) {
        this.memberIndex.delete(i);
        cultivators[i].factionId = -1;
      }
    }
    // Remove from region index
    const rSet = this.regionFactions.get(f.regionCode);
    if (rSet) {
      rSet.delete(factionId);
      if (rSet.size === 0) this.regionFactions.delete(f.regionCode);
    }
    this.factions.delete(factionId);
  }

  private generateName(prng: PRNG, _regionCode: string): string {
    const scheme = Math.floor(prng() * 3);
    switch (scheme) {
      case 0: {
        // 双字意象 + 后缀: 青云门, 碧落谷
        const stem = SECT_PAIR[Math.floor(prng() * SECT_PAIR.length)];
        const suffix = SECT_SUFFIX[Math.floor(prng() * SECT_SUFFIX.length)];
        return stem + suffix;
      }
      case 1: {
        // 单字 + 双字尾缀: 天剑宗, 玄云门
        const head = SECT_HEAD[Math.floor(prng() * SECT_HEAD.length)];
        const tail = SECT_COMPOUND_TAIL[Math.floor(prng() * SECT_COMPOUND_TAIL.length)];
        return head + tail;
      }
      default: {
        // 单字 + 意象 + 后缀: 赤霞谷, 苍岳门
        const head = SECT_HEAD[Math.floor(prng() * SECT_HEAD.length)];
        const middle = SECT_MIDDLE[Math.floor(prng() * SECT_MIDDLE.length)];
        const suffix = SECT_SUFFIX[Math.floor(prng() * SECT_SUFFIX.length)];
        return head + middle + suffix;
      }
    }
  }

  /** Check if faction leaders are still alive; dissolve if dead */
  checkLeaderAlive(
    cultivators: Cultivator[],
    nextCultId: number,
    events: RichEvent[] | null,
    year: number,
  ): void {
    const toDissolve: number[] = [];
    for (const f of this.factions.values()) {
      const leader = cultivators[f.leaderId];
      if (!leader || !leader.alive) {
        toDissolve.push(f.id);
      }
    }
    for (const fid of toDissolve) {
      const f = this.factions.get(fid);
      if (f && events) {
        const de: RichFactionDissolvedEvent = {
          type: 'faction_dissolved',
          year,
          newsRank: 'A',
          factionId: f.id,
          factionName: f.name,
          reason: 'leader_dead',
          region: REGION_NAMES[f.regionCode as RegionCode],
        };
        events.push(de);
      }
      this.dissolveFaction(fid, cultivators, nextCultId);
    }
  }

  /** Check formation conditions every FACTION_CHECK_INTERVAL ticks */
  checkFormation(
    cultivators: Cultivator[],
    nextCultId: number,
    levelGroups: Set<number>[],
    prng: PRNG,
    year: number,
    events: RichEvent[] | null,
    hooks?: { getName(id: number): string | undefined },
  ): void {
    if (year % FACTION_CHECK_INTERVAL !== 0) return;

    // Count unaffiliated cultivators per region
    const regionUnaffiliated = new Map<string, number[]>();
    for (let i = 0; i < nextCultId; i++) {
      const c = cultivators[i];
      if (!c.alive || c.factionId >= 0) continue;
      const rc = getRegionCode(c.x, c.y);
      if (rc === '~') continue;
      let arr = regionUnaffiliated.get(rc);
      if (!arr) {
        arr = [];
        regionUnaffiliated.set(rc, arr);
      }
      arr.push(i);
    }

    // Scan high-level unaffiliated cultivators as potential leaders
    for (let lv = LEVEL_COUNT - 1; lv >= FACTION_LEADER_MIN_LEVEL; lv--) {
      for (const cid of levelGroups[lv]) {
        const c = cultivators[cid];
        if (!c.alive || c.factionId >= 0) continue;
        const rc = getRegionCode(c.x, c.y);
        if (rc === '~') continue;

        const unaffArr = regionUnaffiliated.get(rc);
        if (!unaffArr || unaffArr.length < FACTION_MIN_UNAFFILIATED) continue;

        // Check region doesn't already have too many factions
        const existingCount = this.regionFactions.get(rc)?.size ?? 0;
        if (existingCount >= 3) continue;

        // Create faction
        const fid = this.nextId++;
        const name = this.generateName(prng, rc);
        const cellIdx = c.y * MAP_SIZE + c.x;
        const faction: Faction = {
          id: fid,
          name,
          leaderId: cid,
          regionCode: rc,
          headquarterCell: cellIdx,
          foundedYear: year,
          memberCount: 0,
        };
        this.factions.set(fid, faction);

        // Add to region index
        let rSet = this.regionFactions.get(rc);
        if (!rSet) {
          rSet = new Set();
          this.regionFactions.set(rc, rSet);
        }
        rSet.add(fid);

        // Add leader as member
        this.addMember(cid, fid, cultivators);

        // Recruit initial batch from unaffiliated in region
        const initialRecruit = Math.min(
          Math.floor(unaffArr.length * 0.3),
          unaffArr.length,
        );
        let recruited = 0;
        for (let ri = 0; ri < unaffArr.length && recruited < initialRecruit; ri++) {
          const rid = unaffArr[ri];
          if (rid === cid) continue;
          const rc2 = cultivators[rid];
          if (!rc2.alive || rc2.factionId >= 0) continue;
          this.addMember(rid, fid, cultivators);
          recruited++;
        }

        if (events) {
          const leaderName = hooks?.getName(cid);
          const fe: RichFactionFoundedEvent = {
            type: 'faction_founded',
            year,
            newsRank: c.level >= 5 ? 'S' : 'A',
            factionId: fid,
            factionName: name,
            leader: { id: cid, name: leaderName, level: c.level },
            memberCount: faction.memberCount,
            region: getRegionName(c.x, c.y),
          };
          events.push(fe);
        }

        // Remove recruited cultivators from unaffiliated pool
        const remaining = unaffArr.filter(
          id => cultivators[id].alive && cultivators[id].factionId < 0,
        );
        regionUnaffiliated.set(rc, remaining);
      }
    }
  }

  /** Passive recruitment: unaffiliated cultivators in faction's region may join */
  tickPassiveRecruitment(
    cultivators: Cultivator[],
    nextCultId: number,
    prng: PRNG,
  ): void {
    for (const f of this.factions.values()) {
      const leader = cultivators[f.leaderId];
      if (!leader || !leader.alive) continue;

      for (let i = 0; i < nextCultId; i++) {
        const c = cultivators[i];
        if (!c.alive || c.factionId >= 0) continue;
        const rc = getRegionCode(c.x, c.y);
        if (rc !== f.regionCode) continue;

        // Probability: base + bonus per leader level diff
        const levelDiff = Math.max(0, leader.level - c.level);
        const prob = FACTION_RECRUIT_PROB_BASE + levelDiff * FACTION_RECRUIT_LEVEL_DIFF_BONUS;
        if (prng() < prob) {
          this.addMember(i, f.id, cultivators);
        }
      }
    }
  }

  reset(): void {
    this.factions.clear();
    this.regionFactions.clear();
    this.memberIndex.clear();
    this.nextId = 0;
  }

  // --- Serialization ---

  serializeSize(): number {
    const encoder = new TextEncoder();
    // header: nextId(i32) + count(i32) + memberIndexSize(i32)
    let size = 12;
    for (const f of this.factions.values()) {
      // id(i32) + nameLen(u16) + name(utf8) + leaderId(i32) + regionCodeLen(u8) + regionCode(utf8)
      // + headquarterCell(i32) + foundedYear(i32) + memberCount(i32)
      const nameBytes = encoder.encode(f.name);
      const rcBytes = encoder.encode(f.regionCode);
      size += 4 + 2 + nameBytes.length + 4 + 1 + rcBytes.length + 4 + 4 + 4;
    }
    // memberIndex: pairs of (cultivatorId(i32) + factionId(i32))
    size += this.memberIndex.size * 8;
    return size;
  }

  serializeTo(dv: DataView, off: number, buf: Buffer): number {
    dv.setInt32(off, this.nextId, true); off += 4;
    dv.setInt32(off, this.factions.size, true); off += 4;
    dv.setInt32(off, this.memberIndex.size, true); off += 4;

    const encoder = new TextEncoder();
    for (const f of this.factions.values()) {
      dv.setInt32(off, f.id, true); off += 4;
      const nameBytes = encoder.encode(f.name);
      dv.setUint16(off, nameBytes.length, true); off += 2;
      for (let i = 0; i < nameBytes.length; i++) {
        buf[off + i] = nameBytes[i];
      }
      off += nameBytes.length;
      dv.setInt32(off, f.leaderId, true); off += 4;
      const rcBytes = encoder.encode(f.regionCode);
      dv.setUint8(off, rcBytes.length); off += 1;
      for (let i = 0; i < rcBytes.length; i++) {
        buf[off + i] = rcBytes[i];
      }
      off += rcBytes.length;
      dv.setInt32(off, f.headquarterCell, true); off += 4;
      dv.setInt32(off, f.foundedYear, true); off += 4;
      dv.setInt32(off, f.memberCount, true); off += 4;
    }

    // memberIndex
    for (const [cid, fid] of this.memberIndex) {
      dv.setInt32(off, cid, true); off += 4;
      dv.setInt32(off, fid, true); off += 4;
    }

    return off;
  }

  static deserializeFrom(dv: DataView, off: number, buf: Buffer): { system: FactionSystem; offset: number } {
    const system = new FactionSystem();
    system.nextId = dv.getInt32(off, true); off += 4;
    const count = dv.getInt32(off, true); off += 4;
    const memberCount = dv.getInt32(off, true); off += 4;

    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      const id = dv.getInt32(off, true); off += 4;
      const nameLen = dv.getUint16(off, true); off += 2;
      const name = decoder.decode(buf.subarray(off, off + nameLen));
      off += nameLen;
      const leaderId = dv.getInt32(off, true); off += 4;
      const rcLen = dv.getUint8(off); off += 1;
      const regionCode = decoder.decode(buf.subarray(off, off + rcLen));
      off += rcLen;
      const headquarterCell = dv.getInt32(off, true); off += 4;
      const foundedYear = dv.getInt32(off, true); off += 4;
      const mc = dv.getInt32(off, true); off += 4;

      const f: Faction = { id, name, leaderId, regionCode, headquarterCell, foundedYear, memberCount: mc };
      system.factions.set(id, f);

      let rSet = system.regionFactions.get(regionCode);
      if (!rSet) {
        rSet = new Set();
        system.regionFactions.set(regionCode, rSet);
      }
      rSet.add(id);
    }

    // memberIndex
    for (let i = 0; i < memberCount; i++) {
      const cid = dv.getInt32(off, true); off += 4;
      const fid = dv.getInt32(off, true); off += 4;
      system.memberIndex.set(cid, fid);
    }

    return { system, offset: off };
  }
}

/** Process factions for a tick: check leader alive, formation, recruitment */
export function processFactions(
  engine: {
    cultivators: Cultivator[];
    nextId: number;
    levelGroups: Set<number>[];
    prng: PRNG;
    year: number;
    factions: FactionSystem;
    hooks?: { getName(id: number): string | undefined };
  },
  events: RichEvent[] | null,
): void {
  // 1. Check leader alive -> dissolve if dead
  engine.factions.checkLeaderAlive(
    engine.cultivators,
    engine.nextId,
    events,
    engine.year,
  );

  // 2. Check formation conditions
  engine.factions.checkFormation(
    engine.cultivators,
    engine.nextId,
    engine.levelGroups,
    engine.prng,
    engine.year,
    events,
    engine.hooks,
  );

  // 3. Passive recruitment
  engine.factions.tickPassiveRecruitment(
    engine.cultivators,
    engine.nextId,
    engine.prng,
  );
}
