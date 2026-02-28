import { memo } from 'react';
import type { YearSummary } from '../types';
import { LEVEL_NAMES } from '../constants';

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
      ) : (
        <div className="stats-grid">
          <Stat label="总人口" value={fmt(summary.totalPopulation)} />
          <Stat label="本年新增" value={fmt(summary.newCultivators)} />
          <Stat label="本年死亡" value={fmt(summary.deaths)} />
          <Stat label="├ 战斗" value={fmt(summary.combatDeaths)} sub />
          <Stat label="└ 寿尽" value={fmt(summary.expiryDeaths)} sub />
          <Stat label="本年晋升" value={fmt(summary.promotions.reduce((a, b) => a + b, 0))} />
          <Stat label="最高境界" value={LEVEL_NAMES[summary.highestLevel]} highlight />
          <Stat label="最高修为" value={fmt(summary.highestCultivation)} highlight />
        </div>
      )}
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
