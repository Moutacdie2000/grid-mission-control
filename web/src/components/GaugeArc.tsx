import styles from './GaugeArc.module.css'
import { fmt } from '../lib/format'
import type { Level } from '../lib/metrics'

const R = 48
const C = 2 * Math.PI * R
const SWEEP = 0.75 // arc de 270°
const TRACK = SWEEP * C

const COLOR: Record<Level, string> = {
  nominal: 'var(--amber)',
  warn: 'var(--orange)',
  crit: 'var(--red)',
}

interface Props {
  value: number
  max: number
  label: string
  unit: string
  level: Level
  decimals?: number
}

/** Jauge en arc (270°) dessinée en SVG, avec graduations, glow et lecture centrale. */
export function GaugeArc({ value, max, label, unit, level, decimals = 0 }: Props) {
  const frac = Math.max(0, Math.min(1, value / max))
  const dash = frac * TRACK
  const color = COLOR[level]

  // Extrémité de l'arc (repère SVG : 135° → 405°, sens horaire).
  const end = ((135 + frac * 270) * Math.PI) / 180
  const cx = 60 + R * Math.cos(end)
  const cy = 60 + R * Math.sin(end)

  const ticks = Array.from({ length: 28 }, (_, i) => {
    const a = ((135 + (i / 27) * 270) * Math.PI) / 180
    const major = i % 9 === 0
    const r1 = 57
    const r2 = major ? 50 : 53.5
    return {
      x1: 60 + r1 * Math.cos(a),
      y1: 60 + r1 * Math.sin(a),
      x2: 60 + r2 * Math.cos(a),
      y2: 60 + r2 * Math.sin(a),
      major,
    }
  })

  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 120 120" className={styles.svg}>
        <g>
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={t.major ? 'var(--edge-bright)' : 'var(--edge)'}
              strokeWidth={t.major ? 1.3 : 0.8}
            />
          ))}
        </g>
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--bg-inset)"
          strokeWidth="7"
          strokeDasharray={`${TRACK} ${C}`}
          transform="rotate(135 60 60)"
          strokeLinecap="round"
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeDasharray={`${dash} ${C}`}
          transform="rotate(135 60 60)"
          strokeLinecap="round"
          className={styles.arc}
          style={{ filter: `drop-shadow(0 0 5px ${color})` }}
        />
        {frac > 0.012 && (
          <circle cx={cx} cy={cy} r="3.4" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
        )}
      </svg>
      <div className={styles.center}>
        <div className={styles.value} style={{ color }}>
          {fmt(value, decimals)}
          <span className={styles.unit}>{unit}</span>
        </div>
        <div className={`label ${styles.glabel}`}>{label}</div>
      </div>
    </div>
  )
}
