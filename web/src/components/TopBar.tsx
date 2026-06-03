import { useEffect, useState, type ReactNode } from 'react'
import styles from './TopBar.module.css'
import { StatusLed } from './StatusLed'
import { clockUTC, fmt, fmtCompact, fmtUptime } from '../lib/format'
import type { GlobalState } from '../lib/types'

const STATUS_LABEL: Record<string, string> = {
  nominal: 'NOMINAL',
  degraded: 'DÉGRADÉ',
  critical: 'CRITIQUE',
}

interface Props {
  global: GlobalState | null
  connected: boolean
}

export function TopBar({ global, connected }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const status = global?.status ?? 'nominal'

  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true">
          <g stroke="var(--amber)" strokeWidth="1.6" fill="none">
            <circle cx="16" cy="16" r="9" />
            <path d="M16 3v6M16 23v6M3 16h6M23 16h6" />
          </g>
          <circle cx="16" cy="16" r="2.4" fill="var(--amber)" />
        </svg>
        <div className={styles.brandText}>
          <span className={styles.word}>GRID</span>
          <span className={styles.tag}>MISSION CONTROL</span>
        </div>
      </div>

      <div className={styles.stats}>
        <Cell label="STATUT">
          <span className={styles.statusVal} data-status={status}>
            <StatusLed status={status} size={9} />
            {STATUS_LABEL[status]}
          </span>
        </Cell>
        <Cell label="HÔTES">
          <span>{global ? `${global.hostsUp}/${global.hostsTotal}` : '––'}</span>
        </Cell>
        <Cell label="RPS">
          <span className="glow-amber">{global ? fmtCompact(global.rpsTotal) : '––'}</span>
        </Cell>
        <Cell label="ERREURS">
          <span>
            {global ? fmt(global.errRate, 2) : '––'}
            <small>%</small>
          </span>
        </Cell>
        <Cell label="INCIDENTS">
          <span className={global && global.incidents > 0 ? 'glow-red' : undefined}>
            {global ? global.incidents : '––'}
          </span>
        </Cell>
        <Cell label="UPTIME">
          <span>{global ? fmtUptime(global.uptimeS) : '––'}</span>
        </Cell>
        <Cell label="UTC">
          <span className="glow-amber">{clockUTC(now)}</span>
        </Cell>
        <div className={styles.link} data-on={connected}>
          <span className={styles.linkDot} />
          {connected ? 'LIVE' : 'LIEN…'}
        </div>
      </div>
    </header>
  )
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.cell}>
      <span className={`label ${styles.cellLabel}`}>{label}</span>
      <span className={styles.cellVal}>{children}</span>
    </div>
  )
}
