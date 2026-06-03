// Helpers de formatage, sortie en français, style « instrument ».

const NBSP = ' ' // fine insécable, pour les milliers

export function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '––'
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Format compact : 1234 → 1.2k, 1_500_000 → 1.5M */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '––'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return n.toFixed(0)
}

/** Horloge mission en UTC : « 14:03:27 » */
export function clockUTC(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** Heure locale courte pour le flux d'événements : « 14:03:27 » */
export function clockLocal(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Uptime humain : « 2j 04:13:09 » */
export function fmtUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const days = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (x: number) => String(x).padStart(2, '0')
  const hms = `${p(h)}:${p(m)}:${p(sec)}`
  return days > 0 ? `${days}j${NBSP}${hms}` : hms
}

/** « il y a 4s », « il y a 2m » */
export function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000))
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h`
}
