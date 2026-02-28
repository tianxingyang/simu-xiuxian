import { memo, useMemo, useState } from 'react';
import type { SimEvent } from '../types';
import { LEVEL_NAMES } from '../constants';

const TYPE_LABELS: Record<SimEvent['type'], string> = {
  combat: '战斗',
  promotion: '晋升',
  expiry: '寿尽',
};

const TYPE_COLORS: Record<SimEvent['type'], string> = {
  combat: '#ff5c5c',
  promotion: '#ffd700',
  expiry: 'var(--text-dim)',
};

interface Props {
  events: SimEvent[];
}

export default memo(function EventLog({ events }: Props) {
  const [levelFilter, setLevelFilter] = useState(-1);

  const filtered = useMemo(
    () => levelFilter === -1 ? events : events.filter(e => e.actorLevel === levelFilter),
    [events, levelFilter],
  );

  return (
    <div className="event-log">
      <div className="chart-header">
        <span className="chart-title">事件日志</span>
        <select
          className="event-filter"
          value={levelFilter}
          onChange={e => setLevelFilter(Number(e.target.value))}
        >
          <option value={-1}>全部</option>
          {Array.from({ length: 8 }, (_, i) => i).map(lv => (
            <option key={lv} value={lv}>{LEVEL_NAMES[lv]}</option>
          ))}
        </select>
      </div>
      <div className="event-list">
        {filtered.length === 0 && <div className="event-empty">暂无事件</div>}
        {filtered.slice(0, 100).map(ev => (
          <div key={ev.id} className="event-item">
            <span className="event-year">Y{ev.year}</span>
            <span className="event-type" style={{ color: TYPE_COLORS[ev.type] }}>
              {TYPE_LABELS[ev.type]}
            </span>
            <span className="event-detail">{ev.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
