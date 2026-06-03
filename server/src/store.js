// Store en mémoire de GRID.
//
// Tout l'état vit dans ce module : aucune dépendance native, aucune base de
// données. On conserve, pour chaque hôte, ses métriques courantes, son statut
// dérivé, et un historique borné (ring buffer) par métrique. Le simulateur est
// le seul à écrire dans le store via ingest()/setStatus() ; les routes ne font
// que lire (getSnapshot/getSeries/listHosts) ou injecter (ingest).

import { FLEET, METRIC_KEYS } from './fleet.js';

// Taille du ring buffer : 180 points (3 minutes d'historique à 1 point/seconde).
export const SERIES_CAPACITY = 180;

// Instant de démarrage du process, sert au calcul de l'uptime.
const startedAtMs = Date.now();

/**
 * @typedef {import('./fleet.js').BaseMetrics} Metrics
 * @typedef {'nominal'|'degraded'|'critical'|'offline'} HostStatus
 * @typedef {'nominal'|'degraded'|'critical'} GlobalStatus
 */

/**
 * État interne d'un hôte. Les valeurs de métriques sont toujours déjà arrondies
 * et bornées par celui qui appelle ingest() (le simulateur).
 * @typedef {Object} HostState
 * @property {string} id
 * @property {string} name
 * @property {string} role
 * @property {string} region
 * @property {HostStatus} status
 * @property {Metrics} metrics
 * @property {Map<string, RingBuffer>} series
 */

/**
 * Ring buffer circulaire de points { ts, value }. On évite de décaler un tableau
 * (coûteux) : on écrit dans un emplacement circulaire et on relit dans l'ordre.
 */
class RingBuffer {
  /** @param {number} capacity */
  constructor(capacity) {
    /** @type {number} */
    this.capacity = capacity;
    /** @type {Array<{ ts: number, value: number }>} */
    this.buf = new Array(capacity);
    /** @type {number} Index d'écriture du prochain point. */
    this.head = 0;
    /** @type {number} Nombre de points réellement stockés (≤ capacity). */
    this.size = 0;
  }

  /**
   * Ajoute un point à la fin de l'historique. Écrase le plus ancien si plein.
   * @param {number} ts    Horodatage epoch en ms.
   * @param {number} value Valeur de la métrique.
   */
  push(ts, value) {
    this.buf[this.head] = { ts, value };
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /**
   * Renvoie les `count` points les plus récents, du plus ancien au plus récent.
   * @param {number} count
   * @returns {Array<{ ts: number, value: number }>}
   */
  recent(count) {
    const n = Math.min(count, this.size);
    /** @type {Array<{ ts: number, value: number }>} */
    const out = new Array(n);
    // L'élément le plus récent se trouve juste avant head (modulo capacity).
    // On remplit de la fin vers le début pour rendre l'ordre chronologique.
    for (let i = 0; i < n; i += 1) {
      const idx = (this.head - 1 - i + this.capacity * 2) % this.capacity;
      out[n - 1 - i] = this.buf[idx];
    }
    return out;
  }
}

/** @type {Map<string, HostState>} */
const hosts = new Map();

// Initialisation : on clone les valeurs de base de la flotte dans l'état mutable.
for (const def of FLEET) {
  /** @type {Map<string, RingBuffer>} */
  const series = new Map();
  for (const key of METRIC_KEYS) {
    series.set(key, new RingBuffer(SERIES_CAPACITY));
  }
  hosts.set(def.id, {
    id: def.id,
    name: def.name,
    role: def.role,
    region: def.region,
    status: 'nominal',
    metrics: { ...def.base },
    series,
  });
}

/**
 * Indique si un identifiant d'hôte est connu.
 * @param {string} hostId
 * @returns {boolean}
 */
export function hasHost(hostId) {
  return hosts.has(hostId);
}

/**
 * Indique si une clé de métrique est connue de la flotte.
 * @param {string} metric
 * @returns {boolean}
 */
export function hasMetric(metric) {
  return METRIC_KEYS.includes(/** @type {any} */ (metric));
}

/**
 * Renvoie l'état mutable d'un hôte (usage interne au simulateur).
 * @param {string} hostId
 * @returns {HostState | undefined}
 */
export function getHostState(hostId) {
  return hosts.get(hostId);
}

/**
 * Itère sur tous les hôtes (usage interne au simulateur).
 * @returns {IterableIterator<HostState>}
 */
export function iterHostStates() {
  return hosts.values();
}

/**
 * Liste légère des hôtes (identité + statut + métriques courantes), sans séries.
 * @returns {Array<{ id: string, name: string, role: string, region: string, status: HostStatus, metrics: Metrics }>}
 */
export function listHosts() {
  return [...hosts.values()].map((h) => ({
    id: h.id,
    name: h.name,
    role: h.role,
    region: h.region,
    status: h.status,
    metrics: { ...h.metrics },
  }));
}

/**
 * Met à jour les métriques courantes d'un hôte et pousse un point dans chaque
 * ring buffer concerné. C'est LA voie d'écriture (simulateur et POST /api/ingest).
 *
 * Les overrides sont partiels : seules les clés fournies et numériques finies
 * sont prises en compte. Les valeurs sont arrondies à 1 décimale et bornées.
 *
 * @param {string} hostId
 * @param {Partial<Metrics>} partial
 * @param {number} [ts] Horodatage à utiliser pour les points de série (défaut : maintenant).
 * @returns {boolean} true si l'hôte existe et a été mis à jour, false sinon.
 */
export function ingest(hostId, partial, ts = Date.now()) {
  const host = hosts.get(hostId);
  if (!host) return false;
  if (partial === null || typeof partial !== 'object') return false;

  for (const key of METRIC_KEYS) {
    if (!(key in partial)) continue;
    const raw = /** @type {Record<string, unknown>} */ (partial)[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    host.metrics[key] = clampMetric(key, raw);
  }

  // On historise systématiquement la photo courante de chaque métrique, même
  // celles non touchées par cet appel, pour garder des séries alignées.
  for (const key of METRIC_KEYS) {
    host.series.get(key).push(ts, host.metrics[key]);
  }
  return true;
}

/**
 * Affecte le statut dérivé d'un hôte (calculé par le simulateur).
 * @param {string} hostId
 * @param {HostStatus} status
 */
export function setStatus(hostId, status) {
  const host = hosts.get(hostId);
  if (host) host.status = status;
}

/**
 * Renvoie la série temporelle d'une métrique pour un hôte.
 * @param {string} hostId
 * @param {string} metric
 * @param {number} [points] Nombre de points récents souhaités (défaut 120).
 * @returns {{ hostId: string, metric: string, points: Array<{ ts: number, value: number }> } | null}
 */
export function getSeries(hostId, metric, points = 120) {
  const host = hosts.get(hostId);
  if (!host || !hasMetric(metric)) return null;
  const n = Number.isFinite(points) ? Math.max(1, Math.min(SERIES_CAPACITY, Math.floor(points))) : 120;
  return {
    hostId,
    metric,
    points: host.series.get(metric).recent(n),
  };
}

/**
 * Construit l'instantané complet de la flotte attendu par l'API et le flux SSE.
 *
 * @param {number} incidents Nombre d'incidents actifs (fourni par le simulateur).
 * @returns {{
 *   ts: number,
 *   global: { status: GlobalStatus, hostsUp: number, hostsTotal: number, rpsTotal: number, errRate: number, incidents: number, uptimeS: number },
 *   hosts: Array<{ id: string, name: string, role: string, region: string, status: HostStatus, metrics: Metrics }>
 * }}
 */
export function getSnapshot(incidents = 0) {
  const list = listHosts();

  let hostsUp = 0;
  let rpsTotal = 0;
  let errSum = 0;
  let worst = 0; // 0 nominal, 1 degraded, 2 critical/offline
  const rank = { nominal: 0, degraded: 1, critical: 2, offline: 2 };

  for (const h of list) {
    if (h.status !== 'offline') hostsUp += 1;
    rpsTotal += h.metrics.rps;
    errSum += h.metrics.errRate;
    worst = Math.max(worst, rank[h.status]);
  }

  /** @type {GlobalStatus} */
  const globalStatus = worst >= 2 ? 'critical' : worst === 1 ? 'degraded' : 'nominal';
  const errRate = list.length > 0 ? round1(errSum / list.length) : 0;

  return {
    ts: Date.now(),
    global: {
      status: globalStatus,
      hostsUp,
      hostsTotal: list.length,
      rpsTotal: round1(rpsTotal),
      errRate,
      incidents,
      uptimeS: uptimeSeconds(),
    },
    hosts: list,
  };
}

/**
 * Uptime du process en secondes entières.
 * @returns {number}
 */
export function uptimeSeconds() {
  return Math.floor((Date.now() - startedAtMs) / 1000);
}

/**
 * Nombre total d'hôtes définis dans la flotte.
 * @returns {number}
 */
export function hostsTotal() {
  return hosts.size;
}

// ----- Bornage des métriques -----

// Bornes par métrique (cf. cahier des charges). cpu/mem/disk/errRate ∈ [0,100],
// latencyMs ∈ [5,2000], rps ≥ 0, net ≥ 0.
const BOUNDS = Object.freeze({
  cpu: [0, 100],
  mem: [0, 100],
  disk: [0, 100],
  errRate: [0, 100],
  latencyMs: [5, 2000],
  rps: [0, Number.POSITIVE_INFINITY],
  netIn: [0, Number.POSITIVE_INFINITY],
  netOut: [0, Number.POSITIVE_INFINITY],
});

/**
 * Borne puis arrondit à 1 décimale une valeur de métrique.
 * @param {string} key
 * @param {number} value
 * @returns {number}
 */
export function clampMetric(key, value) {
  const [lo, hi] = BOUNDS[key] ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  return round1(Math.min(hi, Math.max(lo, value)));
}

/**
 * Arrondi à 1 décimale (évite les flottants type 12.300000000001).
 * @param {number} v
 * @returns {number}
 */
export function round1(v) {
  return Math.round(v * 10) / 10;
}
