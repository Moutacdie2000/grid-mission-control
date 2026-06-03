import { useMemo } from 'react'
import styles from './App.module.css'
import { useStream } from './lib/useStream'
import { TopBar } from './components/TopBar'
import { Panel } from './components/Panel'
import { GaugeArc } from './components/GaugeArc'
import { Sparkline } from './components/Sparkline'
import { HostGrid } from './components/HostGrid'
import { EventFeed } from './components/EventFeed'
import { METRICS, levelFor } from './lib/metrics'
import { fmt, fmtCompact } from './lib/format'
import type { Host } from './lib/types'

export function App() {
  const { snapshot, history, alerts, connected } = useStream()

  const vitals = useMemo(() => {
    if (!snapshot || snapshot.hosts.length === 0) return null
    const n = snapshot.hosts.length
    const mean = (sel: (h: Host) => number) => snapshot.hosts.reduce((acc, h) => acc + sel(h), 0) / n
    return {
      cpu: mean((h) => h.metrics.cpu),
      mem: mean((h) => h.metrics.mem),
      disk: mean((h) => h.metrics.disk),
      latencyMs: mean((h) => h.metrics.latencyMs),
      errRate: snapshot.global.errRate,
    }
  }, [snapshot])

  const rpsSeries = history.map((s) => s.global.rpsTotal)
  const errSeries = history.map((s) => s.global.errRate)
  const latSeries = history.map(
    (s) => s.hosts.reduce((acc, h) => acc + h.metrics.latencyMs, 0) / Math.max(1, s.hosts.length),
  )
  const lastLat = latSeries.length ? latSeries[latSeries.length - 1] : 0

  return (
    <div className={styles.app}>
      <div className="fx" />
      <div className="fx-grain" />
      <TopBar global={snapshot?.global ?? null} connected={connected} />

      {!snapshot ? (
        <Boot connected={connected} />
      ) : (
        <main className={styles.main}>
          {!connected && <div className={styles.reconnect}>LIEN PERDU — RECONNEXION…</div>}

          <Panel
            title="CONSTANTES VITALES"
            code="VITALS"
            className={styles.vitals}
            bodyClassName={styles.vitalsBody}
            delay={40}
          >
            {vitals && (
              <>
                <GaugeArc value={vitals.cpu} max={METRICS.cpu.max} label="CPU MOY" unit="%" level={levelFor('cpu', vitals.cpu)} decimals={1} />
                <GaugeArc value={vitals.mem} max={METRICS.mem.max} label="MÉM MOY" unit="%" level={levelFor('mem', vitals.mem)} decimals={1} />
                <GaugeArc value={vitals.disk} max={METRICS.disk.max} label="DISQUE MOY" unit="%" level={levelFor('disk', vitals.disk)} decimals={1} />
                <GaugeArc value={vitals.latencyMs} max={METRICS.latencyMs.max} label="LATENCE MOY" unit="ms" level={levelFor('latencyMs', vitals.latencyMs)} />
                <GaugeArc value={vitals.errRate} max={METRICS.errRate.max} label="ERREURS" unit="%" level={levelFor('errRate', vitals.errRate)} decimals={2} />
              </>
            )}
          </Panel>

          <Panel title="TENDANCES · 2 MIN" code="TREND" className={styles.trends} bodyClassName={styles.trendsBody} delay={120}>
            <Trend label="REQUÊTES / S" value={fmtCompact(snapshot.global.rpsTotal)} color="var(--amber)" series={rpsSeries} />
            <Trend label="LATENCE MOY · ms" value={fmt(lastLat, 0)} color="var(--cyan)" series={latSeries} />
            <Trend label="TAUX D'ERREUR · %" value={fmt(snapshot.global.errRate, 2)} color="var(--orange)" series={errSeries} />
          </Panel>

          <Panel title={`FLOTTE · ${snapshot.hosts.length} HÔTES`} code="FLEET" className={styles.fleet} noPad delay={200}>
            <HostGrid hosts={snapshot.hosts} />
          </Panel>

          <Panel
            title="JOURNAL D'ÉVÉNEMENTS"
            code="LOG"
            className={styles.feedPanel}
            right={
              <span className={styles.rec}>
                <span className={styles.recDot} />
                REC
              </span>
            }
            noPad
            delay={80}
          >
            <EventFeed alerts={alerts} />
          </Panel>
        </main>
      )}
    </div>
  )
}

function Trend({ label, value, color, series }: { label: string; value: string; color: string; series: number[] }) {
  return (
    <div className={styles.trend}>
      <div className={styles.trendHead}>
        <span className="label">{label}</span>
        <span className={styles.trendVal} style={{ color }}>
          {value}
        </span>
      </div>
      <Sparkline values={series} color={color} height={48} />
    </div>
  )
}

function Boot({ connected }: { connected: boolean }) {
  return (
    <div className={styles.boot}>
      <svg viewBox="0 0 120 120" className={styles.bootMark}>
        <g stroke="var(--amber)" strokeWidth="1.4" fill="none">
          <circle cx="60" cy="60" r="40" opacity="0.45" />
          <circle cx="60" cy="60" r="26" />
          <path d="M60 8v18M60 94v18M8 60h18M94 60h18" />
        </g>
        <circle cx="60" cy="60" r="4" fill="var(--amber)" />
        <line x1="60" y1="60" x2="100" y2="60" stroke="var(--amber)" strokeWidth="1.4" className={styles.bootSweep} />
      </svg>
      <div className={styles.bootText}>{connected ? 'ACQUISITION DE LA TÉLÉMÉTRIE…' : 'CONNEXION AU FLUX…'}</div>
    </div>
  )
}
