import { useState } from 'react';
import type { ConnectionStatus } from '../hooks/useSimulation';

interface Props {
  year: number;
  seed: number;
  isRunning: boolean;
  isPaused: boolean;
  extinctionNotice: boolean;
  connectionStatus: ConnectionStatus;
  onStart: (seed: number, initialPop: number) => void;
  onPause: () => void;
  onStep: () => void;
  onSetSpeed: (tier: number) => void;
  onReset: (seed: number, initialPop: number) => void;
}

const SPEED_LABELS = ['×1', '×5', '×10'] as const;

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: '',
  connecting: '连接中...',
  disconnected: '已断开',
};

export default function Controls({
  year, seed, isRunning, isPaused, extinctionNotice, connectionStatus,
  onStart, onPause, onStep, onSetSpeed, onReset,
}: Props) {
  const [speedTier, setSpeedTier] = useState(1);
  const [inputSeed, setInputSeed] = useState<number | ''>(seed);
  const [inputPop, setInputPop] = useState<number | ''>(200);
  const canEdit = !isRunning && isPaused;

  const resolveSeed = () => (inputSeed === '' ? 0 : inputSeed);
  const resolvePop = () => Math.max(100, Math.min(100000, inputPop || 100));

  const handleStartPause = () => {
    if (isRunning) {
      onPause();
    } else {
      onStart(resolveSeed(), resolvePop());
    }
  };

  const handleSpeed = (tier: number) => {
    setSpeedTier(tier);
    onSetSpeed(tier);
  };

  const handleReset = () => onReset(resolveSeed(), resolvePop());

  return (
    <div className="controls">
      <span className="controls-title">修仙世界模拟器</span>

      <div className="controls-group">
        <label>
          种子
          <input
            type="number"
            value={inputSeed}
            disabled={!canEdit}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') { setInputSeed(''); return; }
              const v = parseInt(raw, 10);
              if (!Number.isNaN(v)) setInputSeed(v);
            }}
            onBlur={() => { if (inputSeed === '') setInputSeed(0); }}
          />
        </label>
        <label>
          初始家户数
          <input
            type="number"
            min={100}
            max={100000}
            step={100}
            value={inputPop}
            disabled={!canEdit}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') { setInputPop(''); return; }
              const v = parseInt(raw, 10);
              if (!Number.isNaN(v)) setInputPop(v);
            }}
            onBlur={() => setInputPop(resolvePop())}
          />
        </label>
      </div>

      <div className="controls-group">
        <button onClick={handleStartPause}>
          {isRunning ? '⏸ 暂停' : '▶ 开始'}
        </button>
        <button onClick={() => onStep()} disabled={isRunning}>
          ⏭ 单步
        </button>
        <button onClick={handleReset}>
          ↺ 重置
        </button>
      </div>

      <div className="controls-group speed-group">
        {SPEED_LABELS.map((label, i) => (
          <button
            key={i}
            className={speedTier === i + 1 ? 'active' : ''}
            onClick={() => handleSpeed(i + 1)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="controls-info">
        <span className={`conn-status conn-${connectionStatus}`} />
        {CONNECTION_LABEL[connectionStatus] && (
          <span className="conn-label">{CONNECTION_LABEL[connectionStatus]}</span>
        )}
        <span>年份: {year}</span>
        {extinctionNotice && <span className="extinction">已灭绝</span>}
      </div>
    </div>
  );
}
