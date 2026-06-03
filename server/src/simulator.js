// Simulateur de flotte de GRID.
//
// NOTE : ceci est du code serveur runtime exécuté dans un process Node normal.
// Math.random() y est donc disponible et utilisé librement pour la marche
// aléatoire et le déclenchement des incidents.
//
// À chaque tick (1000 ms) :
//   1. on fait évoluer chaque métrique de chaque hôte par une marche aléatoire
//      bornée, rappelée doucement vers sa valeur de base (retour à la moyenne) ;
//   2. on superpose l'effet des incidents actifs (montée, palier, rétablissement) ;
//   3. on calcule le statut de chaque hôte puis le statut global ;
//   4. on émet les alertes de franchissement de seuil (warn/crit) et de
//      rétablissement (info), plus, occasionnellement, des alertes info
//      d'exploitation (déploiement, scaling) ;
//   5. on persiste tout dans le store et on diffuse un snapshot via le hub SSE.
//
// Un SEUL tick partagé pilote l'ensemble : aucune logique par client.

import { FLEET, METRIC_KEYS } from './fleet.js';
import {
  clampMetric,
  getHostState,
  getSnapshot,
  ingest,
  iterHostStates,
  setStatus,
  round1,
} from './store.js';
import { evaluate, makeAlert, recoveryMessage, thresholdMessage } from './alerts.js';

// Période du tick de simulation.
const TICK_MS = 1000;

// Amplitude de la marche aléatoire (écart-type approché) par métrique, et
// force du rappel vers la valeur de base (entre 0 et 1, plus c'est haut plus le
// retour à la moyenne est rapide).
const WALK = Object.freeze({
  cpu: { step: 3.0, pull: 0.06 },
  mem: { step: 1.2, pull: 0.04 },
  netIn: { step: 18, pull: 0.05 },
  netOut: { step: 22, pull: 0.05 },
  disk: { step: 0.4, pull: 0.02 },
  latencyMs: { step: 8, pull: 0.07 },
  rps: { step: 24, pull: 0.05 },
  errRate: { step: 0.15, pull: 0.1 },
});

/**
 * @typedef {import('./fleet.js').BaseMetrics} Metrics
 * @typedef {import('./alerts.js').Severity} Severity
 */

/**
 * Incident actif sur un hôte. Un incident vise une métrique cible et la pousse
 * via une enveloppe en trois phases : montée (rise), palier (hold),
 * rétablissement (recover). On stocke un offset additif appliqué par-dessus la
 * marche aléatoire normale.
 *
 * @typedef {Object} Incident
 * @property {string} hostId
 * @property {keyof Metrics} metric
 * @property {number} peak        Offset additif au pic (unités de la métrique).
 * @property {number} riseMs      Durée de montée.
 * @property {number} holdMs      Durée de palier.
 * @property {number} recoverMs   Durée de rétablissement.
 * @property {number} startedAt   Horodatage de début.
 * @property {boolean} severe     Incident sévère (peut provoquer un offline bref).
 */

class Simulator {
  /**
   * @param {(eventName: string, data: unknown) => void} broadcast  Diffuseur SSE.
   * @param {(alert: object) => void} onAlert  Rappel appelé pour chaque alerte émise.
   */
  constructor(broadcast, onAlert) {
    /** @type {(eventName: string, data: unknown) => void} */
    this.broadcast = broadcast;
    /** @type {(alert: object) => void} */
    this.onAlert = onAlert;

    /** @type {NodeJS.Timeout | null} */
    this.timer = null;

    // Valeurs de base par hôte, pour le rappel vers la moyenne.
    /** @type {Map<string, Metrics>} */
    this.bases = new Map();
    for (const def of FLEET) this.bases.set(def.id, { ...def.base });

    // Incidents actifs, indexés par hôte (au plus un incident par hôte).
    /** @type {Map<string, Incident>} */
    this.incidents = new Map();

    // Statut de franchissement de seuil par hôte+métrique au tick précédent,
    // pour ne déclencher une alerte qu'au moment du franchissement (front montant)
    // et une alerte « rétabli » qu'au retour sous les seuils.
    /** @type {Map<string, Severity>} */
    this.breachState = new Map();

    // Horodatage du prochain incident programmé.
    this.nextIncidentAt = Date.now() + randBetween(20_000, 45_000);

    // Horodatage de la prochaine alerte info d'exploitation.
    this.nextInfoAt = Date.now() + randBetween(15_000, 35_000);
  }

  /**
   * Démarre la boucle de simulation (idempotent). Effectue immédiatement un
   * premier tick pour que le store contienne des points dès le départ.
   */
  start() {
    if (this.timer) return;
    // Amorçage : un point initial dans chaque série.
    for (const host of iterHostStates()) {
      ingest(host.id, {}, Date.now());
    }
    this.recomputeStatuses();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /**
   * Arrête la boucle de simulation.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Nombre d'incidents actuellement actifs.
   * @returns {number}
   */
  activeIncidents() {
    return this.incidents.size;
  }

  /**
   * Un tick complet de simulation.
   */
  tick() {
    const now = Date.now();

    // Programmation d'un nouvel incident si l'échéance est atteinte et qu'un
    // hôte sain est disponible.
    if (now >= this.nextIncidentAt) {
      this.scheduleIncident(now);
      this.nextIncidentAt = now + randBetween(20_000, 45_000);
    }

    // Émission éventuelle d'une alerte info d'exploitation.
    if (now >= this.nextInfoAt) {
      this.emitOpsInfo(now);
      this.nextInfoAt = now + randBetween(15_000, 35_000);
    }

    // Évolution des métriques de chaque hôte.
    for (const host of iterHostStates()) {
      const base = this.bases.get(host.id);
      /** @type {Partial<Metrics>} */
      const next = {};
      for (const key of METRIC_KEYS) {
        next[key] = this.walk(host.metrics[key], base[key], key);
      }
      // Superposition de l'incident actif (offset additif sur la métrique cible).
      const incident = this.incidents.get(host.id);
      let forcedOffline = false;
      if (incident) {
        const { offset, done, fraction } = incidentOffset(incident, now);
        next[incident.metric] = clampMetric(
          incident.metric,
          (next[incident.metric] ?? base[incident.metric]) + offset,
        );
        // Un incident sévère peut provoquer un bref passage offline au pic.
        if (incident.severe && fraction > 0.85 && Math.random() < 0.04) {
          forcedOffline = true;
        }
        if (done) this.resolveIncident(host.id, now);
      }
      ingest(host.id, next, now);
      if (forcedOffline) host.__forcedOffline = true;
      else delete host.__forcedOffline;
    }

    // Calcul des statuts + alertes de franchissement/rétablissement.
    const incidentsCount = this.recomputeStatuses(now);

    // Diffusion du snapshot à tous les clients.
    this.broadcast('snapshot', getSnapshot(incidentsCount));
  }

  /**
   * Applique une marche aléatoire bornée avec retour à la moyenne sur une valeur.
   * @param {number} current
   * @param {number} base
   * @param {keyof Metrics} key
   * @returns {number}
   */
  walk(current, base, key) {
    const cfg = WALK[key];
    // Bruit gaussien approché (somme de deux uniformes recentrées).
    const noise = (Math.random() + Math.random() - 1) * cfg.step;
    // Rappel proportionnel à l'écart à la base.
    const pull = (base - current) * cfg.pull;
    return clampMetric(key, current + noise + pull);
  }

  /**
   * Programme un incident sur un hôte sain choisi au hasard.
   * @param {number} now
   */
  scheduleIncident(now) {
    // Hôtes éligibles : nominal et sans incident en cours.
    const candidates = [];
    for (const host of iterHostStates()) {
      if (host.status === 'nominal' && !this.incidents.has(host.id)) {
        candidates.push(host);
      }
    }
    if (candidates.length === 0) return;

    const host = candidates[Math.floor(Math.random() * candidates.length)];
    // Métrique cible parmi celles porteuses d'alerte et pertinentes pour un pic.
    const targets = /** @type {Array<keyof Metrics>} */ (['cpu', 'latencyMs', 'errRate']);
    const metric = targets[Math.floor(Math.random() * targets.length)];

    const severe = Math.random() < 0.45;
    const base = this.bases.get(host.id)[metric];

    // Offset au pic : suffisant pour dépasser le seuil critique de la métrique.
    let peak;
    if (metric === 'cpu') peak = severe ? 70 - base + randBetween(8, 18) : 45 - base + randBetween(4, 10);
    else if (metric === 'latencyMs') peak = severe ? randBetween(900, 1500) : randBetween(420, 700);
    else peak = severe ? randBetween(7, 14) : randBetween(2.2, 4.5);
    peak = Math.max(peak, 1);

    /** @type {Incident} */
    const incident = {
      hostId: host.id,
      metric,
      peak: round1(peak),
      riseMs: Math.round(randBetween(4000, 9000)),
      holdMs: Math.round(randBetween(6000, 14000)),
      recoverMs: Math.round(randBetween(5000, 11000)),
      startedAt: now,
      severe,
    };
    this.incidents.set(host.id, incident);
  }

  /**
   * Termine et nettoie un incident, et émet une alerte info de rétablissement.
   * @param {string} hostId
   * @param {number} now
   */
  resolveIncident(hostId, now) {
    const incident = this.incidents.get(hostId);
    if (!incident) return;
    this.incidents.delete(hostId);
    const host = getHostState(hostId);
    if (!host) return;
    const value = host.metrics[incident.metric];
    this.emit(
      makeAlert({
        severity: 'info',
        hostId,
        metric: incident.metric,
        value,
        message: recoveryMessage(host.name, incident.metric, value),
        ts: now,
      }),
    );
  }

  /**
   * Recalcule le statut de chaque hôte et le statut global, et émet les alertes
   * de franchissement de seuil (front montant) et de rétablissement par métrique.
   *
   * @param {number} [now]
   * @returns {number} Nombre d'incidents actifs (pour le snapshot).
   */
  recomputeStatuses(now = Date.now()) {
    for (const host of iterHostStates()) {
      // Statut de l'hôte selon la pire métrique franchie.
      let status = hostStatusFromMetrics(host.metrics);
      // Offline forcé ponctuel pendant un incident sévère.
      if (host.__forcedOffline) status = 'offline';
      setStatus(host.id, status);

      // Alertes par métrique surveillée (cpu, latencyMs, errRate, mem, disk).
      for (const metric of ['cpu', 'latencyMs', 'errRate', 'mem', 'disk']) {
        const value = host.metrics[metric];
        const sev = evaluate(metric, value); // 'crit' | 'warn' | null
        const stateKey = `${host.id}:${metric}`;
        const prev = this.breachState.get(stateKey) ?? null;

        if (sev && sev !== prev) {
          // Nouveau franchissement, ou aggravation warn -> crit.
          this.emit(
            makeAlert({
              severity: sev,
              hostId: host.id,
              metric,
              value,
              message: thresholdMessage(sev, host.name, metric, value),
              ts: now,
            }),
          );
          this.breachState.set(stateKey, sev);
        } else if (!sev && prev) {
          // Retour sous tous les seuils : alerte info de rétablissement.
          this.emit(
            makeAlert({
              severity: 'info',
              hostId: host.id,
              metric,
              value,
              message: recoveryMessage(host.name, metric, value),
              ts: now,
            }),
          );
          this.breachState.delete(stateKey);
        } else if (sev) {
          // Toujours en dépassement, même niveau : on garde l'état sans réémettre.
          this.breachState.set(stateKey, sev);
        }
      }
    }
    return this.incidents.size;
  }

  /**
   * Émet une alerte d'exploitation purement informative (déploiement, scaling).
   * @param {number} now
   */
  emitOpsInfo(now) {
    const hosts = [...iterHostStates()];
    if (hosts.length === 0) return;
    const host = hosts[Math.floor(Math.random() * hosts.length)];
    const kinds = [
      () => ({ metric: 'rps', message: `${host.name} — déploiement v${randInt(1, 9)}.${randInt(0, 9)}.${randInt(0, 9)} appliqué` }),
      () => ({ metric: 'cpu', message: `${host.name} — autoscaling : +${randInt(1, 3)} instance(s)` }),
      () => ({ metric: 'cpu', message: `${host.name} — autoscaling : -${randInt(1, 2)} instance(s)` }),
      () => ({ metric: 'mem', message: `${host.name} — rotation de cache effectuée` }),
      () => ({ metric: 'latencyMs', message: `${host.name} — bascule de trafic terminée` }),
    ];
    const pick = kinds[Math.floor(Math.random() * kinds.length)]();
    this.emit(
      makeAlert({
        severity: 'info',
        hostId: host.id,
        metric: pick.metric,
        value: host.metrics[pick.metric],
        message: pick.message,
        ts: now,
      }),
    );
  }

  /**
   * Diffuse une alerte (SSE) et notifie le rappel applicatif.
   * @param {object} alert
   */
  emit(alert) {
    this.broadcast('alert', alert);
    this.onAlert(alert);
  }
}

/**
 * Détermine le statut d'un hôte selon la pire métrique franchie.
 * @param {Metrics} m
 * @returns {'nominal'|'degraded'|'critical'}
 */
function hostStatusFromMetrics(m) {
  if (m.cpu > 90 || m.latencyMs > 800 || m.errRate > 5) return 'critical';
  if (m.cpu > 75 || m.latencyMs > 400 || m.errRate > 1.5) return 'degraded';
  return 'nominal';
}

/**
 * Calcule l'offset additif d'un incident à l'instant courant via une enveloppe
 * montée → palier → rétablissement.
 *
 * @param {Incident} incident
 * @param {number} now
 * @returns {{ offset: number, done: boolean, fraction: number }}
 *          offset : valeur additive ; done : incident terminé ; fraction : 0..1
 *          de la progression dans la phase de palier (utilisé pour l'offline).
 */
function incidentOffset(incident, now) {
  const elapsed = now - incident.startedAt;
  const { riseMs, holdMs, recoverMs, peak } = incident;
  const total = riseMs + holdMs + recoverMs;

  if (elapsed >= total) return { offset: 0, done: true, fraction: 1 };

  if (elapsed < riseMs) {
    // Montée : courbe lissée (ease-in-out) de 0 à peak.
    const t = elapsed / riseMs;
    return { offset: peak * easeInOut(t), done: false, fraction: 0 };
  }
  if (elapsed < riseMs + holdMs) {
    // Palier au pic.
    const t = (elapsed - riseMs) / holdMs;
    return { offset: peak, done: false, fraction: t };
  }
  // Rétablissement : de peak vers 0.
  const t = (elapsed - riseMs - holdMs) / recoverMs;
  return { offset: peak * (1 - easeInOut(t)), done: false, fraction: 1 };
}

/**
 * Lissage ease-in-out cubique sur [0,1].
 * @param {number} t
 * @returns {number}
 */
function easeInOut(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * Réel aléatoire dans [min, max).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Entier aléatoire dans [min, max].
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randInt(min, max) {
  return Math.floor(randBetween(min, max + 1));
}

/**
 * Crée et démarre le simulateur partagé.
 * @param {(eventName: string, data: unknown) => void} broadcast
 * @param {(alert: object) => void} onAlert
 * @returns {Simulator}
 */
export function startSimulator(broadcast, onAlert) {
  const sim = new Simulator(broadcast, onAlert);
  sim.start();
  return sim;
}
