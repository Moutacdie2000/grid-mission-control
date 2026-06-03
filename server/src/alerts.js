// Règles de seuils et fabrique d'objets d'alerte de GRID.
//
// On définit, par métrique surveillée, deux seuils : warn (avertissement) et
// crit (critique). Le simulateur consulte ces règles pour décider du statut des
// hôtes et pour émettre des alertes lors d'un franchissement de seuil. Toutes
// les métriques ne sont pas porteuses d'alerte : seules celles qui ont un sens
// opérationnel direct (cpu, latence, taux d'erreur, mémoire, disque) en ont.
//
// Forme d'une alerte (contrat API/SSE) :
//   { id, ts, severity:'info'|'warn'|'crit', hostId, metric, value, message }

/**
 * @typedef {'info'|'warn'|'crit'} Severity
 */

/**
 * @typedef {Object} ThresholdRule
 * @property {number} warn        Seuil d'avertissement.
 * @property {number} crit        Seuil critique.
 * @property {string} unit        Unité affichée dans les messages.
 * @property {string} label       Libellé FR court de la métrique.
 */

// Seuils alignés sur la logique de statut du cahier des charges :
//   cpu>90, latencyMs>800, errRate>5      → critique
//   cpu>75, latencyMs>400, errRate>1.5    → dégradé
// On y ajoute mem et disk pour enrichir la couverture des alertes.
/** @type {Readonly<Record<string, ThresholdRule>>} */
export const RULES = Object.freeze({
  cpu: { warn: 75, crit: 90, unit: '%', label: 'CPU' },
  latencyMs: { warn: 400, crit: 800, unit: 'ms', label: 'latence' },
  errRate: { warn: 1.5, crit: 5, unit: '%', label: "taux d'erreur" },
  mem: { warn: 85, crit: 95, unit: '%', label: 'mémoire' },
  disk: { warn: 85, crit: 95, unit: '%', label: 'disque' },
});

/**
 * Évalue la sévérité d'une valeur pour une métrique donnée.
 * @param {string} metric
 * @param {number} value
 * @returns {Severity|null} 'crit' | 'warn' si un seuil est franchi, sinon null.
 */
export function evaluate(metric, value) {
  const rule = RULES[metric];
  if (!rule) return null;
  if (value > rule.crit) return 'crit';
  if (value > rule.warn) return 'warn';
  return null;
}

// Compteur monotone garantissant l'unicité des id d'alerte au sein du process,
// même si plusieurs alertes naissent dans la même milliseconde.
let alertSeq = 0;

/**
 * Génère un identifiant d'alerte unique et lisible.
 * @returns {string}
 */
function nextAlertId() {
  alertSeq += 1;
  return `al-${Date.now().toString(36)}-${alertSeq.toString(36)}`;
}

/**
 * Construit un objet d'alerte conforme au contrat.
 * @param {Object} params
 * @param {Severity} params.severity
 * @param {string} params.hostId
 * @param {string} params.metric
 * @param {number} params.value
 * @param {string} params.message
 * @param {number} [params.ts]
 * @returns {{ id: string, ts: number, severity: Severity, hostId: string, metric: string, value: number, message: string }}
 */
export function makeAlert({ severity, hostId, metric, value, message, ts = Date.now() }) {
  return {
    id: nextAlertId(),
    ts,
    severity,
    hostId,
    metric,
    value,
    message,
  };
}

/**
 * Compose un message FR de franchissement de seuil.
 * @param {Severity} severity
 * @param {string} hostName
 * @param {string} metric
 * @param {number} value
 * @returns {string}
 */
export function thresholdMessage(severity, hostName, metric, value) {
  const rule = RULES[metric];
  const label = rule ? rule.label : metric;
  const unit = rule ? rule.unit : '';
  const seuil = rule ? (severity === 'crit' ? rule.crit : rule.warn) : 0;
  const niveau = severity === 'crit' ? 'critique' : 'élevé';
  return `${hostName} — ${label} ${niveau} : ${value}${unit} (seuil ${seuil}${unit})`;
}

/**
 * Compose un message FR de rétablissement d'une métrique.
 * @param {string} hostName
 * @param {string} metric
 * @param {number} value
 * @returns {string}
 */
export function recoveryMessage(hostName, metric, value) {
  const rule = RULES[metric];
  const label = rule ? rule.label : metric;
  const unit = rule ? rule.unit : '';
  return `${hostName} — ${label} rétablie : ${value}${unit} sous les seuils`;
}
