import type { MetricKey } from './types'

export type Level = 'nominal' | 'warn' | 'crit'

export interface MetricDef {
  key: MetricKey
  label: string
  unit: string
  /** Échelle haute pour les jauges. */
  max: number
  /** Seuils de franchissement. */
  warn: number
  crit: number
  decimals: number
}

// Métadonnées d'affichage + seuils, alignées sur la logique d'alerte du backend.
export const METRICS: Record<MetricKey, MetricDef> = {
  cpu: { key: 'cpu', label: 'CPU', unit: '%', max: 100, warn: 75, crit: 90, decimals: 1 },
  mem: { key: 'mem', label: 'MÉMOIRE', unit: '%', max: 100, warn: 80, crit: 92, decimals: 1 },
  disk: { key: 'disk', label: 'DISQUE', unit: '%', max: 100, warn: 80, crit: 92, decimals: 1 },
  latencyMs: { key: 'latencyMs', label: 'LATENCE', unit: 'ms', max: 1000, warn: 400, crit: 800, decimals: 0 },
  errRate: { key: 'errRate', label: 'ERREURS', unit: '%', max: 10, warn: 1.5, crit: 5, decimals: 2 },
  rps: { key: 'rps', label: 'RPS', unit: 'req/s', max: 500, warn: Infinity, crit: Infinity, decimals: 0 },
  netIn: { key: 'netIn', label: 'NET ↓', unit: 'Mb/s', max: 1000, warn: Infinity, crit: Infinity, decimals: 0 },
  netOut: { key: 'netOut', label: 'NET ↑', unit: 'Mb/s', max: 1000, warn: Infinity, crit: Infinity, decimals: 0 },
}

/** Niveau d'un point de mesure par rapport à ses seuils. */
export function levelFor(key: MetricKey, value: number): Level {
  const def = METRICS[key]
  if (value >= def.crit) return 'crit'
  if (value >= def.warn) return 'warn'
  return 'nominal'
}
