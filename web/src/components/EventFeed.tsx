import styles from './EventFeed.module.css'
import { clockLocal } from '../lib/format'
import type { Alert } from '../lib/types'

const SEV_LABEL: Record<string, string> = { info: 'INFO', warn: 'WARN', crit: 'CRIT' }

export function EventFeed({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return <div className={styles.empty}>EN ATTENTE DE TÉLÉMÉTRIE…</div>
  }
  return (
    <div className={styles.feed}>
      {alerts.map((a) => (
        <div key={a.id} className={styles.line} data-sev={a.severity}>
          <span className={styles.time}>{clockLocal(a.ts)}</span>
          <span className={styles.sev} data-sev={a.severity}>
            {SEV_LABEL[a.severity]}
          </span>
          <span className={styles.msg}>{a.message}</span>
        </div>
      ))}
    </div>
  )
}
