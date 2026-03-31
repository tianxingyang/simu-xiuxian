import { memo, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import type { YearSummary } from '../types';
import { LEVEL_NAMES, LEVEL_COLORS } from '../constants';

interface Props {
  trendData: YearSummary[];
}

const MAX_DISPLAY_POINTS = 200;

function displaySample(src: YearSummary[]): YearSummary[] {
  if (src.length <= MAX_DISPLAY_POINTS) return src;
  const step = (src.length - 1) / (MAX_DISPLAY_POINTS - 1);
  const out: YearSummary[] = [];
  for (let i = 0; i < MAX_DISPLAY_POINTS - 1; i++) out.push(src[Math.round(i * step)]);
  out.push(src[src.length - 1]);
  return out;
}

type Tab = 'population' | 'age' | 'courage';
const TABS: { key: Tab; label: string }[] = [
  { key: 'population', label: '人口趋势' },
  { key: 'age', label: '年龄趋势' },
  { key: 'courage', label: '勇气趋势' },
];

export default memo(function TrendChart({ trendData }: Props) {
  const [tab, setTab] = useState<Tab>('population');

  const data = useMemo(() => displaySample(trendData).map(s => {
    const pt: Record<string, number | null> = { year: s.year };
    for (let i = 1; i <= 7; i++) {
      const empty = s.levelCounts[i] === 0;
      pt[`pop${i}`] = s.levelCounts[i];
      pt[`age${i}`] = empty ? null : s.levelStats[i].ageAvg;
      pt[`cour${i}`] = empty ? null : s.levelStats[i].courageAvg;
    }
    return pt;
  }), [trendData]);

  const dataKeyPrefix = tab === 'population' ? 'pop' : tab === 'age' ? 'age' : 'cour';

  return (
    <div className="chart-container">
      <div className="chart-header">
        <span className="chart-title">{TABS.find(t => t.key === tab)?.label}</span>
        <div className="tab-group">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`tab-btn${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="year" stroke="var(--text-dim)" fontSize={12} />
            <YAxis stroke="var(--text-dim)" fontSize={12} />
            <Tooltip
              contentStyle={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4 }}
              labelStyle={{ color: 'var(--text)' }}
              labelFormatter={v => `第 ${v} 年`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {Array.from({ length: 7 }, (_, i) => i + 1).map(lv => (
              <Line
                key={lv}
                type="linear"
                dataKey={`${dataKeyPrefix}${lv}`}
                name={LEVEL_NAMES[lv]}
                stroke={LEVEL_COLORS[lv]}
                dot={false}
                isAnimationActive={false}
                strokeWidth={1.5}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
