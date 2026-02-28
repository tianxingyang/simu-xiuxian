import { memo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import type { YearSummary } from '../types';
import { LEVEL_NAMES, LEVEL_COLORS } from '../constants';

interface Props {
  summary: YearSummary | null;
}

export default memo(function LevelChart({ summary }: Props) {
  const [logScale, setLogScale] = useState(false);

  const data = Array.from({ length: 8 }, (_, i) => {
    const raw = summary?.levelCounts[i] ?? 0;
    return { name: LEVEL_NAMES[i], count: logScale && raw === 0 ? null : raw };
  });

  return (
    <div className="chart-container">
      <div className="chart-header">
        <span className="chart-title">境界分布</span>
        <button
          className={`chart-toggle ${logScale ? 'active' : ''}`}
          onClick={() => setLogScale(v => !v)}
        >
          Log
        </button>
      </div>
      <div className="chart-body">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" stroke="var(--text-dim)" fontSize={12} />
            <YAxis
              stroke="var(--text-dim)"
              fontSize={12}
              scale={logScale ? 'log' : 'auto'}
              domain={logScale ? [1, 'auto'] : [0, 'auto']}
              allowDataOverflow
            />
            <Tooltip
              contentStyle={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 4 }}
              labelStyle={{ color: 'var(--text)' }}
              itemStyle={{ color: 'var(--text)' }}
            />
            <Bar dataKey="count" name="人数" isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={LEVEL_COLORS[i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
