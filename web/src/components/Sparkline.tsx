import { useId } from 'react'
import styles from './Sparkline.module.css'

interface Props {
  values: number[]
  color?: string
  height?: number
  max?: number
  min?: number
  fill?: boolean
}

/** Mini-courbe temporelle (SVG), étirée à la largeur du conteneur. */
export function Sparkline({ values, color = 'var(--amber)', height = 40, max, min, fill = true }: Props) {
  const uid = useId().replace(/:/g, '')
  const W = 100
  const H = height

  if (values.length < 2) {
    return <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} />
  }

  const lo = min ?? Math.min(...values)
  const hi = max ?? Math.max(...values)
  const span = hi - lo || 1
  const pad = 3

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - ((v - lo) / span) * (H - pad * 2) - pad
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const line = `M${pts.join(' L')}`
  const area = `${line} L${W},${H} L0,${H} Z`

  return (
    <svg className={styles.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={`grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#grad-${uid})`} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  )
}
