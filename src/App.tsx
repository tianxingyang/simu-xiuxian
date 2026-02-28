import { useSimulation } from './hooks/useSimulation';
import Dashboard from './components/Dashboard';
import Controls from './components/Controls';
import LevelChart from './components/LevelChart';
import TrendChart from './components/TrendChart';
import EventLog from './components/EventLog';
import StatsPanel from './components/StatsPanel';

const INITIAL_SEED = 42;

function App() {
  const sim = useSimulation();
  const year = sim.yearSummary?.year ?? 1;

  return (
    <Dashboard
      controls={
        <Controls
          year={year}
          seed={INITIAL_SEED}
          isRunning={sim.isRunning}
          isPaused={sim.isPaused}
          extinctionNotice={sim.extinctionNotice}
          onStart={sim.start}
          onPause={sim.pause}
          onStep={sim.step}
          onSetSpeed={sim.setSpeed}
          onReset={sim.reset}
        />
      }
      levelChart={<LevelChart summary={sim.yearSummary} />}
      trendChart={<TrendChart trendData={sim.trendData} />}
      eventLog={<EventLog events={sim.events} />}
      statsPanel={<StatsPanel summary={sim.yearSummary} />}
    />
  );
}

export default App;
