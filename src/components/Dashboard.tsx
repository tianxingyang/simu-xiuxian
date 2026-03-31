import type { ReactNode } from 'react';

interface Props {
  controls: ReactNode;
  levelChart: ReactNode;
  trendChart: ReactNode;
  eventLog: ReactNode;
  statsPanel: ReactNode;
  factionPanel: ReactNode;
}

export default function Dashboard({ controls, levelChart, trendChart, eventLog, statsPanel, factionPanel }: Props) {
  return (
    <div className="dashboard">
      <header className="dashboard-controls">{controls}</header>
      <main className="dashboard-grid">
        <section className="panel">{levelChart}</section>
        <section className="panel">{statsPanel}</section>
        <section className="panel">{trendChart}</section>
        <section className="panel">{factionPanel}</section>
        <section className="panel panel-wide">{eventLog}</section>
      </main>
    </div>
  );
}
