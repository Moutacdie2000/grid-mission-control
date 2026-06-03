// Définition statique de la flotte simulée par GRID.
//
// Chaque hôte porte une identité (id, name, role, region) et un jeu de valeurs
// de base pour ses métriques. Le simulateur part de ces valeurs de base et y
// applique une marche aléatoire bornée, plus d'éventuels incidents. Les valeurs
// de base sont choisies de façon réaliste selon le rôle de l'hôte : un cache a
// peu de CPU mais beaucoup de mémoire, une base de données encaisse de la
// latence disque, un edge brasse beaucoup de réseau, etc.
//
// Les rôles autorisés sont : api | worker | db | cache | edge | queue.
// Les régions autorisées sont : eu-west-1 | us-east-1 | ap-southeast-1.

/**
 * @typedef {Object} BaseMetrics
 * @property {number} cpu        Charge processeur en pourcentage (0-100).
 * @property {number} mem        Occupation mémoire en pourcentage (0-100).
 * @property {number} netIn      Trafic entrant en Mbps.
 * @property {number} netOut     Trafic sortant en Mbps.
 * @property {number} disk       Occupation disque en pourcentage (0-100).
 * @property {number} latencyMs  Latence applicative en millisecondes.
 * @property {number} rps        Requêtes par seconde.
 * @property {number} errRate    Taux d'erreur en pourcentage (0-100).
 */

/**
 * @typedef {Object} HostDef
 * @property {string} id
 * @property {string} name
 * @property {'api'|'worker'|'db'|'cache'|'edge'|'queue'} role
 * @property {'eu-west-1'|'us-east-1'|'ap-southeast-1'} region
 * @property {BaseMetrics} base
 */

/** @type {ReadonlyArray<HostDef>} */
export const FLEET = Object.freeze([
  {
    id: 'edge-eu-1',
    name: 'edge-eu-1',
    role: 'edge',
    region: 'eu-west-1',
    base: { cpu: 28, mem: 41, netIn: 320, netOut: 540, disk: 38, latencyMs: 42, rps: 480, errRate: 0.2 },
  },
  {
    id: 'api-eu-1',
    name: 'api-eu-1',
    role: 'api',
    region: 'eu-west-1',
    base: { cpu: 46, mem: 58, netIn: 95, netOut: 120, disk: 52, latencyMs: 110, rps: 320, errRate: 0.4 },
  },
  {
    id: 'api-us-1',
    name: 'api-us-1',
    role: 'api',
    region: 'us-east-1',
    base: { cpu: 51, mem: 62, netIn: 110, netOut: 140, disk: 55, latencyMs: 130, rps: 360, errRate: 0.5 },
  },
  {
    id: 'worker-eu-1',
    name: 'worker-eu-1',
    role: 'worker',
    region: 'eu-west-1',
    base: { cpu: 63, mem: 49, netIn: 60, netOut: 45, disk: 44, latencyMs: 220, rps: 90, errRate: 0.3 },
  },
  {
    id: 'db-eu-1',
    name: 'db-eu-1',
    role: 'db',
    region: 'eu-west-1',
    base: { cpu: 37, mem: 71, netIn: 75, netOut: 88, disk: 67, latencyMs: 18, rps: 540, errRate: 0.1 },
  },
  {
    id: 'cache-eu-1',
    name: 'cache-eu-1',
    role: 'cache',
    region: 'eu-west-1',
    base: { cpu: 19, mem: 78, netIn: 140, netOut: 160, disk: 22, latencyMs: 6, rps: 1200, errRate: 0.05 },
  },
  {
    id: 'queue-us-1',
    name: 'queue-us-1',
    role: 'queue',
    region: 'us-east-1',
    base: { cpu: 33, mem: 54, netIn: 70, netOut: 66, disk: 48, latencyMs: 35, rps: 210, errRate: 0.2 },
  },
  {
    id: 'edge-ap-1',
    name: 'edge-ap-1',
    role: 'edge',
    region: 'ap-southeast-1',
    base: { cpu: 31, mem: 44, netIn: 290, netOut: 470, disk: 40, latencyMs: 58, rps: 410, errRate: 0.25 },
  },
]);

// Liste figée des métriques connues, dans l'ordre d'affichage logique.
// Sert de source de vérité unique pour le store, les séries et les seuils.
/** @type {ReadonlyArray<keyof BaseMetrics>} */
export const METRIC_KEYS = Object.freeze([
  'cpu',
  'mem',
  'netIn',
  'netOut',
  'disk',
  'latencyMs',
  'rps',
  'errRate',
]);
