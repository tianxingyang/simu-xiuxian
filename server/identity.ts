import { createPRNG } from '../src/engine/prng.js';
import type { Cultivator } from '../src/types.js';
import type { NamedCultivatorRow } from './db.js';
import { getDB, insertNamedCultivator, updateNamedCultivators } from './db.js';

// --- Name Pools ---

const SINGLE_SURNAMES = [
  '李','王','张','刘','陈','杨','赵','黄','周','吴',
  '徐','孙','胡','朱','高','林','何','郭','马','罗',
  '梁','宋','郑','谢','韩','唐','冯','董','萧','程',
  '曹','袁','许','傅','沈','曾','彭','吕','苏','卢',
  '蒋','蔡','贾','魏','薛','叶','余','潘','杜','戴',
  '夏','钟','汪','田','姜','范','方','石','姚','谭',
];

const COMPOUND_SURNAMES = [
  '慕容','欧阳','上官','司马','诸葛','令狐',
  '东方','西门','南宫','公孙','端木','百里','独孤','皇甫',
];

const GIVEN_CHARS = [
  '玄','清','幽','灵','墨','霜','雪','云','风','雷',
  '天','星','月','辰','华','光','影','剑','锋','琴',
  '丹','鼎','道','法','真','虚','空','无','极','太',
  '阴','阳','乾','坤','青','紫','碧','翠','白','金',
  '冰','火','水','龙','凤','鹤','鹰','莲','竹','松',
  '梅','兰','菊','柳','凌','霄','尘','渊','泽','溪',
  '泉','海','岳','峰','岚','烟','霞','露','寒','夜',
  '曦','昊','瑶','琼','璃','珏','瑾','璇','瑜','澜',
  '逸','然','煜','辉','弦','翎','羽','魄','魂','啸',
];

const NAME_SEED_XOR = 0x4E414D45;
const MAX_RETRY = 100;
const SUFFIX_CHARS = '②③④⑤⑥⑦⑧⑨⑩';

// --- NamedCultivator ---

export interface NamedCultivator {
  id: number;
  name: string;
  namedAtYear: number;
  killCount: number;
  combatWins: number;
  combatLosses: number;
  promotionYears: { year: number; toLevel: number }[];
  peakLevel: number;
  peakCultivation: number;
  deathYear?: number;
  deathCause?: 'combat' | 'expiry';
  killedBy?: string;
}

function rowToNamedCultivator(row: NamedCultivatorRow): NamedCultivator {
  return {
    id: row.id,
    name: row.name,
    namedAtYear: row.named_at_year,
    killCount: row.kill_count,
    combatWins: row.combat_wins,
    combatLosses: row.combat_losses,
    promotionYears: JSON.parse(row.promotion_years),
    peakLevel: row.peak_level,
    peakCultivation: row.peak_cultivation,
    deathYear: row.death_year ?? undefined,
    deathCause: (row.death_cause as 'combat' | 'expiry') ?? undefined,
    killedBy: row.killed_by ?? undefined,
  };
}

// --- IdentityManager ---

export class IdentityManager {
  private active = new Map<number, NamedCultivator>();
  private usedNames = new Set<string>();
  private dirty = new Set<number>();
  private pendingInserts: NamedCultivator[] = [];
  private namePrng: () => number;

  constructor(seed: number) {
    this.namePrng = createPRNG(seed ^ NAME_SEED_XOR);
  }

  rebuildFromDB(): void {
    const db = getDB();
    const names = db.prepare('SELECT name FROM named_cultivators').all() as { name: string }[];
    for (const r of names) this.usedNames.add(r.name);

    const alive = db.prepare(
      'SELECT * FROM named_cultivators WHERE death_year IS NULL'
    ).all() as NamedCultivatorRow[];
    for (const row of alive) this.active.set(row.id, rowToNamedCultivator(row));
  }

  generateName(): string {
    for (let i = 0; i < MAX_RETRY; i++) {
      const name = this.rawName();
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name;
      }
    }
    const base = this.rawName();
    for (let i = 0; i < SUFFIX_CHARS.length; i++) {
      const name = base + SUFFIX_CHARS[i];
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name);
        return name;
      }
    }
    const fallback = base + '⑪';
    this.usedNames.add(fallback);
    return fallback;
  }

  private rawName(): string {
    const p = this.namePrng;
    const surname = p() < 0.85
      ? SINGLE_SURNAMES[Math.floor(p() * SINGLE_SURNAMES.length)]
      : COMPOUND_SURNAMES[Math.floor(p() * COMPOUND_SURNAMES.length)];
    const len = p() < 0.5 ? 1 : 2;
    let given = '';
    for (let i = 0; i < len; i++) {
      given += GIVEN_CHARS[Math.floor(p() * GIVEN_CHARS.length)];
    }
    return surname + given;
  }

  onPromotion(c: Cultivator, toLevel: number, year: number): void {
    const nc = this.active.get(c.id);
    if (nc) {
      nc.promotionYears.push({ year, toLevel });
      if (toLevel > nc.peakLevel) nc.peakLevel = toLevel;
      if (c.cultivation > nc.peakCultivation) nc.peakCultivation = c.cultivation;
      this.dirty.add(c.id);
      return;
    }
    if (toLevel < 2) return;
    const name = this.generateName();
    const newNc: NamedCultivator = {
      id: c.id,
      name,
      namedAtYear: year,
      killCount: 0,
      combatWins: 0,
      combatLosses: 0,
      promotionYears: [{ year, toLevel }],
      peakLevel: toLevel,
      peakCultivation: c.cultivation,
    };
    this.active.set(c.id, newNc);
    this.pendingInserts.push(newNc);
  }

  onCombatResult(
    winner: Cultivator,
    loser: Cultivator,
    loserDied: boolean,
    year: number,
  ): void {
    const w = this.active.get(winner.id);
    if (w) {
      w.combatWins++;
      if (loserDied) w.killCount++;
      if (winner.cultivation > w.peakCultivation) w.peakCultivation = winner.cultivation;
      this.dirty.add(winner.id);
    }
    const l = this.active.get(loser.id);
    if (l) {
      l.combatLosses++;
      if (loserDied) {
        l.deathYear = year;
        l.deathCause = 'combat';
        l.killedBy = w ? w.name : '无名修士';
      }
      this.dirty.add(loser.id);
    }
  }

  onExpiry(c: Cultivator, year: number): void {
    const nc = this.active.get(c.id);
    if (!nc) return;
    nc.deathYear = year;
    nc.deathCause = 'expiry';
    this.dirty.add(c.id);
  }

  flushToDB(): void {
    if (!this.pendingInserts.length && !this.dirty.size) return;

    const db = getDB();
    const run = db.transaction(() => {
      for (const nc of this.pendingInserts) {
        insertNamedCultivator({
          id: nc.id,
          name: nc.name,
          namedAtYear: nc.namedAtYear,
          peakLevel: nc.peakLevel,
          peakCultivation: nc.peakCultivation,
          promotionYears: JSON.stringify(nc.promotionYears),
        });
      }
      this.pendingInserts.length = 0;

      const updates: Parameters<typeof updateNamedCultivators>[0] = [];
      for (const id of this.dirty) {
        const nc = this.active.get(id);
        if (!nc) continue;
        updates.push({
          id: nc.id,
          killCount: nc.killCount,
          combatWins: nc.combatWins,
          combatLosses: nc.combatLosses,
          promotionYears: JSON.stringify(nc.promotionYears),
          peakLevel: nc.peakLevel,
          peakCultivation: nc.peakCultivation,
          deathYear: nc.deathYear,
          deathCause: nc.deathCause,
          killedBy: nc.killedBy,
        });
      }
      if (updates.length) updateNamedCultivators(updates);
      this.dirty.clear();
    });
    run();

    for (const [id, nc] of this.active) {
      if (nc.deathYear !== undefined) this.active.delete(id);
    }
  }

  getActive(id: number): NamedCultivator | undefined {
    return this.active.get(id);
  }

  get activeCount(): number {
    return this.active.size;
  }

  reset(seed: number): void {
    this.active.clear();
    this.usedNames.clear();
    this.dirty.clear();
    this.pendingInserts.length = 0;
    this.namePrng = createPRNG(seed ^ NAME_SEED_XOR);
  }
}
