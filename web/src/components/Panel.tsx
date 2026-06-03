import type { ReactNode } from 'react'
import styles from './Panel.module.css'

interface PanelProps {
  title?: string
  code?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** Décalage de la séquence d'allumage (ms). */
  delay?: number
  noPad?: boolean
}

/** Conteneur « panneau d'instrument » : bezel à coins, en-tête, corps. */
export function Panel({ title, code, right, children, className, bodyClassName, delay = 0, noPad }: PanelProps) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`} style={{ animationDelay: `${delay}ms` }}>
      {(title || code || right) && (
        <header className={styles.head}>
          <span className={`label ${styles.title}`}>{title}</span>
          <div className={styles.headRight}>
            {right}
            {code && <span className={styles.code}>{code}</span>}
          </div>
        </header>
      )}
      <div className={`${styles.body} ${noPad ? styles.noPad : ''} ${bodyClassName ?? ''}`}>{children}</div>
    </section>
  )
}
