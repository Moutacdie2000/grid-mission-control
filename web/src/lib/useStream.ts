import { useEffect, useRef, useState } from 'react'
import type { Alert, Snapshot } from './types'

const MAX_ALERTS = 80
const MAX_HISTORY = 120 // ~2 min à 1 Hz, pour alimenter les sparklines

export interface StreamState {
  snapshot: Snapshot | null
  history: Snapshot[]
  alerts: Alert[]
  connected: boolean
}

/**
 * Abonnement au flux SSE du backend (/api/stream).
 * - `snapshot` : dernier instantané de la flotte
 * - `history`  : fenêtre glissante d'instantanés (pour les sparklines)
 * - `alerts`   : alertes les plus récentes en tête
 * - `connected`: état du lien temps réel
 */
export function useStream(): StreamState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [connected, setConnected] = useState(false)
  const bufferRef = useRef<Snapshot[]>([])

  useEffect(() => {
    const es = new EventSource('/api/stream')

    const onSnapshot = (e: MessageEvent) => {
      const snap = JSON.parse(e.data) as Snapshot
      setSnapshot(snap)
      const buf = bufferRef.current
      buf.push(snap)
      if (buf.length > MAX_HISTORY) buf.shift()
      setHistory(buf.slice())
      setConnected(true)
    }

    const onAlert = (e: MessageEvent) => {
      const alert = JSON.parse(e.data) as Alert
      setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS))
    }

    es.addEventListener('snapshot', onSnapshot as EventListener)
    es.addEventListener('alert', onAlert as EventListener)
    es.addEventListener('open', () => setConnected(true))
    es.addEventListener('error', () => setConnected(false))

    return () => {
      es.removeEventListener('snapshot', onSnapshot as EventListener)
      es.removeEventListener('alert', onAlert as EventListener)
      es.close()
    }
  }, [])

  return { snapshot, history, alerts, connected }
}
