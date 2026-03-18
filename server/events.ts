import { LEVEL_NAMES } from '../src/constants.js';
import type { DefeatOutcome, RichEvent, SimEvent } from '../src/types.js';

export { scoreNewsRank } from '../src/engine/combat.js';
export { MilestoneTracker } from '../src/engine/simulation.js';

const OUTCOME_TEXT: Record<DefeatOutcome, string> = {
  death: '，击杀对手',
  demotion: '，败者跌境',
  injury: '，败者重伤',
  cult_loss: '，败者损失修为',
  light_injury: '，败者轻伤',
  meridian_damage: '，败者经脉受损',
};

let _displayEventId = 1;

export function resetDisplayEventId(start = 1): void {
  _displayEventId = start;
}

export function toDisplayEvent(e: RichEvent): SimEvent {
  const id = _displayEventId++;
  const rp = e.type !== 'milestone' && e.region ? `〔${e.region}〕` : '';
  switch (e.type) {
    case 'combat': {
      const actorLevel = Math.max(e.winner.level, e.loser.level);
      const suffix = OUTCOME_TEXT[e.outcome];
      const wn = e.winner.name;
      const ln = e.loser.name;
      let detail: string;
      if (wn || ln) {
        const ws = wn ? `${wn}(${LEVEL_NAMES[e.winner.level]})` : LEVEL_NAMES[e.winner.level];
        const ls = ln ? `${ln}(${LEVEL_NAMES[e.loser.level]})` : LEVEL_NAMES[e.loser.level];
        detail = `${rp}${ws}击败${ls}，吸收修为${e.absorbed}${suffix}`;
      } else {
        detail = `${rp}${LEVEL_NAMES[actorLevel]}对决，吸收修为${e.absorbed}${suffix}`;
      }
      return { id, year: e.year, type: 'combat', actorLevel, detail };
    }
    case 'promotion': {
      const cause = e.cause === 'natural' ? '自然' : '战斗';
      const prefix = e.subject.name ? `${e.subject.name} ` : '';
      return {
        id, year: e.year, type: 'promotion', actorLevel: e.toLevel,
        detail: `${rp}${prefix}${LEVEL_NAMES[e.fromLevel]}→${LEVEL_NAMES[e.toLevel]}（${cause}晋升）`,
      };
    }
    case 'expiry':
      return {
        id, year: e.year, type: 'expiry', actorLevel: e.level,
        detail: e.subject.name
          ? `${rp}${e.subject.name}(${LEVEL_NAMES[e.level]})寿元耗尽`
          : `${rp}${LEVEL_NAMES[e.level]}寿元耗尽`,
      };
    case 'milestone': {
      const ln = LEVEL_NAMES[e.detail.level];
      const name = e.detail.cultivatorName;
      const detail = e.kind === 'first_at_level'
        ? `天地异象！${name}成为首位${ln}修士`
        : `${ln}境界最后一位修士${name}陨落，${ln}断代`;
      return { id, year: e.year, type: 'promotion', actorLevel: e.detail.level, detail };
    }
    case 'breakthrough_fail': {
      const penaltyText = e.penalty === 'injury' ? '受伤' : e.penalty === 'cultivation_loss' ? '修为受损' : '冷却';
      const prefix = e.subject.name ? `${e.subject.name} ` : '';
      return {
        id, year: e.year, type: 'breakthrough_fail', actorLevel: e.subject.level,
        detail: `${rp}${prefix}${LEVEL_NAMES[e.subject.level]}破境失败（${penaltyText}）`,
      };
    }
    case 'tribulation': {
      const prefix = e.subject.name ? `${e.subject.name} ` : '';
      return {
        id, year: e.year, type: 'tribulation', actorLevel: e.subject.level,
        detail: e.outcome === 'ascension'
          ? `${rp}${prefix}${LEVEL_NAMES[e.subject.level]}渡劫成功，飞升离去！`
          : `${rp}${prefix}${LEVEL_NAMES[e.subject.level]}渡劫失败，陨落天劫之下`,
      };
    }
  }
}
