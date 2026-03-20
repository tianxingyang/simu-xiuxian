import { memo } from 'react';
import type { YearSummary } from '../types';
import { LEVEL_NAMES, LEVEL_COUNT } from '../constants';

interface Props {
  summary: YearSummary | null;
}

export default memo(function StatsPanel({ summary }: Props) {
  return (
    <div className="stats-panel">
      <div className="chart-header">
        <span className="chart-title">统计面板</span>
      </div>
      {!summary ? (
        <div className="stats-empty">等待模拟开始...</div>
      ) : (<>
        <div className="stats-grid">
          <Stat label="总人口" value={fmt(summary.totalPopulation)} />
          <Stat label="本年新增" value={fmt(summary.newCultivators)} />
          <Stat label="本年死亡" value={fmt(summary.deaths)} />
          <Stat label="├ 战斗" value={fmt(summary.combatDeaths)} sub />
          <Stat label="├ 寿尽" value={fmt(summary.expiryDeaths)} sub />
          <Stat label="└ 天劫" value={fmt(summary.tribulationDeaths)} sub />
          <Stat label="天劫/飞升" value={`${fmt(summary.tribulations)}/${fmt(summary.ascensions)}`} />
          <Stat label="战败存活" value={fmt(summary.combatDemotions + summary.combatInjuries + summary.combatCultLosses + summary.combatLightInjuries + summary.combatMeridianDamages)} />
          <Stat label="├ 跌境" value={fmt(summary.combatDemotions)} sub />
          <Stat label="├ 重伤" value={fmt(summary.combatInjuries)} sub />
          <Stat label="├ 损修" value={fmt(summary.combatCultLosses)} sub />
          <Stat label="├ 轻伤" value={fmt(summary.combatLightInjuries)} sub />
          <Stat label="└ 经脉" value={fmt(summary.combatMeridianDamages)} sub />
          <Stat label="本年晋升" value={fmt(summary.promotions.reduce((a, b) => a + b, 0))} />
          <Stat label="最高境界" value={LEVEL_NAMES[summary.highestLevel]} highlight />
          <Stat label="最高修为" value={fmt(summary.highestCultivation)} highlight />
          <Stat label="凡人人口" value={fmt(summary.mortalPopulation)} />
          <Stat label="家户数" value={fmt(summary.householdCount)} />
          <Stat label="聚落数" value={fmt(summary.settlementCount)} />
          <Stat label="├ 村落" value={fmt(summary.hamletCount)} sub />
          <Stat label="├ 村庄" value={fmt(summary.villageCount)} sub />
          <Stat label="├ 镇" value={fmt(summary.townCount)} sub />
          <Stat label="└ 城" value={fmt(summary.cityCount)} sub />
        </div>
        <table className="level-stats-table">
          <thead>
            <tr>
              <th>境界</th>
              <th>年龄均值</th>
              <th>年龄中位数</th>
              <th>勇气均值</th>
              <th>勇气中位数</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: LEVEL_COUNT }, (_, i) => {
              const s = summary.levelStats[i];
              const empty = summary.levelCounts[i] === 0;
              return (
                <tr key={i}>
                  <td>{LEVEL_NAMES[i]}</td>
                  <td>{empty ? '-' : s.ageAvg}</td>
                  <td>{empty ? '-' : s.ageMedian}</td>
                  <td>{empty ? '-' : s.courageAvg}</td>
                  <td>{empty ? '-' : s.courageMedian}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>)}
    </div>
  );
});

function fmt(n: number) {
  return n.toLocaleString();
}

function Stat({ label, value, sub, highlight }: {
  label: string; value: string; sub?: boolean; highlight?: boolean;
}) {
  return (
    <div className={`stat-item${sub ? ' stat-sub' : ''}${highlight ? ' stat-highlight' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
