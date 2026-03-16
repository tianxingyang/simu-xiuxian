import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SimEvent } from '../types';
import { LEVEL_NAMES } from '../constants';

const TYPE_LABELS: Record<SimEvent['type'], string> = {
  combat: '战斗',
  promotion: '晋升',
  expiry: '寿尽',
  breakthrough_fail: '破境失败',
  tribulation: '天劫',
};

const TYPE_COLORS: Record<SimEvent['type'], string> = {
  combat: '#ff5c5c',
  promotion: '#ffd700',
  expiry: 'var(--text-dim)',
  breakthrough_fail: '#9f7aea',
  tribulation: '#ff4500',
};

interface Props {
  events: SimEvent[];
}

export default memo(function EventLog({ events }: Props) {
  const [levelFilter, setLevelFilter] = useState(-1);
  const [pinned, setPinned] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const frozenRef = useRef<SimEvent[] | null>(null);
  const frozenFirstIdRef = useRef('');
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const displayEvents = pinned ? events : (frozenRef.current ?? events);

  const pendingCount = useMemo(() => {
    if (pinned || !frozenFirstIdRef.current) return 0;
    const idx = events.findIndex(e => e.id === frozenFirstIdRef.current);
    return idx < 0 ? events.length : idx;
  }, [events, pinned]);

  const filtered = useMemo(
    () => levelFilter === -1 ? displayEvents : displayEvents.filter(e => e.actorLevel === levelFilter),
    [displayEvents, levelFilter],
  );

  useEffect(() => {
    if (!pinned && events.length === 0) {
      pinnedRef.current = true;
      frozenRef.current = null;
      frozenFirstIdRef.current = '';
      setPinned(true);
    }
  }, [events.length, pinned]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atTop = el.scrollTop <= 5;
    if (atTop === pinnedRef.current) return;
    pinnedRef.current = atTop;
    if (atTop) {
      frozenRef.current = null;
      frozenFirstIdRef.current = '';
    } else {
      frozenRef.current = eventsRef.current;
      frozenFirstIdRef.current = eventsRef.current[0]?.id ?? '';
    }
    setPinned(atTop);
  }, []);

  const jumpToTop = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = 0;
    pinnedRef.current = true;
    frozenRef.current = null;
    frozenFirstIdRef.current = '';
    setPinned(true);
  }, []);

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
      {pendingCount > 0 && (
        <div className="event-pending" onClick={jumpToTop}>
          {pendingCount} 条新事件
        </div>
      )}
      <div className="event-list" ref={listRef} onScroll={handleScroll}>
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
