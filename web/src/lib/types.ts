// Types partagés avec le backend GRID (voir grid/server). Toute modification
// de forme doit rester synchronisée avec l'API SSE / REST.

export type HostStatus = 'nominal' | 'degraded' | 'critical' | 'offline'
export type GlobalStatus = 'nominal' | 'degraded' | 'critical'
export type Severity = 'info' | 'warn' | 'crit'

export interface Metrics {
  cpu: number
  mem: number
  netIn: number
  netOut: number
  disk: number
  latencyMs: number
  rps: number
  errRate: number
}

export type MetricKey = keyof Metrics

export interface Host {
  id: string
  name: string
  role: string
  region: string
  status: HostStatus
  metrics: Metrics
}

export interface GlobalState {
  status: GlobalStatus
  hostsUp: number
  hostsTotal: number
  rpsTotal: number
  errRate: number
  incidents: number
  uptimeS: number
}

export interface Snapshot {
  ts: number
  global: GlobalState
  hosts: Host[]
}

export interface Alert {
  id: string
  ts: number
  severity: Severity
  hostId: string
  metric: string
  value: number
  message: string
}
