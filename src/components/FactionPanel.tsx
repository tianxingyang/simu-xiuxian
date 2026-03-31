import { memo } from 'react';
import type { FactionSummary } from '../types';
import { REGION_NAMES } from '../constants';

interface Props {
  factionCount: number;
  factions: FactionSummary[];
  currentYear: number;
}

export default memo(function FactionPanel({ factionCount, factions, currentYear }: Props) {
  return (
    <div className="faction-panel">
      <div className="chart-header">
        <span className="chart-title">势力</span>
        <span className="faction-count">{factionCount} 宗</span>
      </div>
      {factions.length === 0 ? (
        <div className="faction-empty">暂无势力</div>
      ) : (
        <div className="faction-list">
          {factions.map(f => (
            <div key={f.id} className="faction-item">
              <div className="faction-name">{f.name}</div>
              <div className="faction-meta">
                <span>{regionLabel(f.regionCode)}</span>
                <span>{f.memberCount} 人</span>
                <span>立{currentYear - f.foundedYear}年</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function regionLabel(code: string): string {
  return REGION_NAMES[code as keyof typeof REGION_NAMES] ?? code;
}
