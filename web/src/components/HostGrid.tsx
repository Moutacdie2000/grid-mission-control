import styles from './HostGrid.module.css'
import { StatusLed } from './StatusLed'
import { METRICS, levelFor } from '../lib/metrics'
import { fmt, fmtCompact } from '../lib/format'
import type { Host, MetricKey } from '../lib/types'

function Bar({ metricKey, value }: { metricKey: Extract<MetricKey, 'cpu' | 'mem'>; value: number }) {
  const def = METRICS[metricKey]
  const level = levelFor(metricKey, value)
  const pct = Math.min(100, (value / def.max) * 100)
  return (
    <div className={styles.bar} title={`${def.label} ${fmt(value, 1)}%`}>
      <div className={styles.barFill} data-level={level} style={{ width: `${pct}%` }} />
      <span className={styles.barVal}>{fmt(value, 0)}</span>
    </div>
  )
}

export function HostGrid({ hosts }: { hosts: Host[] }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.headRow}>
        <span>HÔTE</span>
        <span>CPU</span>
        <span>MÉM</span>
        <span className={styles.right}>LAT</span>
        <span className={styles.right}>RPS</span>
        <span className={styles.right}>ERR</span>
      </div>
      <div className={styles.rows}>
        {hosts.map((h) => (
          <div key={h.id} className={styles.row} data-status={h.status}>
            <div className={styles.host}>
              <StatusLed status={h.status} size={8} />
              <div className={styles.hostMeta}>
                <span className={styles.hostName}>{h.name}</span>
                <span className={styles.hostSub}>
                  {h.role} · {h.region}
                </span>
              </div>
            </div>
            <Bar metricKey="cpu" value={h.metrics.cpu} />
            <Bar metricKey="mem" value={h.metrics.mem} />
            <span className={styles.num} data-level={levelFor('latencyMs', h.metrics.latencyMs)}>
              {fmt(h.metrics.latencyMs, 0)}
              <small>ms</small>
            </span>
            <span className={styles.num}>{fmtCompact(h.metrics.rps)}</span>
            <span className={styles.num} data-level={levelFor('errRate', h.metrics.errRate)}>
              {fmt(h.metrics.errRate, 2)}
              <small>%</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
