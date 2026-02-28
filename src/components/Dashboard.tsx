import type { ReactNode } from 'react';

interface Props {
  controls: ReactNode;
  levelChart: ReactNode;
  trendChart: ReactNode;
  eventLog: ReactNode;
  statsPanel: ReactNode;
}

export default function Dashboard({ controls, levelChart, trendChart, eventLog, statsPanel }: Props) {
  return (
    <div className="dashboard">
      <header className="dashboard-controls">{controls}</header>
      <main className="dashboard-grid">
        <section className="panel">{levelChart}</section>
        <section className="panel">{trendChart}</section>
        <section className="panel">{eventLog}</section>
        <section className="panel">{statsPanel}</section>
      </main>
    </div>
  );
}
