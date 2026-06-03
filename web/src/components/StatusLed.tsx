import styles from './StatusLed.module.css'

interface Props {
  status: string
  size?: number
  label?: string
}

/** Diode de statut : verte (nominal), ambre clignotante (degraded), rouge (critical), éteinte (offline). */
export function StatusLed({ status, size = 9, label }: Props) {
  return (
    <span className={styles.wrap}>
      <span className={styles.led} data-status={status} style={{ width: size, height: size }} />
      {label && <span className={styles.label}>{label}</span>}
    </span>
  )
}
