// Point d'entrée du backend GRID.
//
// Assemble l'application Fastify :
//   - CORS ouvert (origin: true) ;
//   - routes API REST (/api/health, /api/hosts, /api/series/:hostId, /api/ingest) ;
//   - flux temps réel Server-Sent Events (/api/stream) ;
//   - service du build statique du front (../web/dist) avec repli SPA vers
//     index.html pour les routes non-/api, si le build existe ; sinon une petite
//     page JSON d'information est servie sur "/".
//
// Un unique simulateur partagé met à jour le store en mémoire et diffuse les
// snapshots/alertes à tous les clients SSE via le hub.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';

import {
  getSeries,
  getSnapshot,
  hasHost,
  hasMetric,
  hostsTotal,
  ingest,
  uptimeSeconds,
} from './store.js';
import { hub } from './sse.js';
import { startSimulator } from './simulator.js';

const VERSION = '1.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Le build du front est attendu en ../web/dist relativement à server/src.
const DIST_DIR = join(__dirname, '..', '..', 'web', 'dist');
const DIST_INDEX = join(DIST_DIR, 'index.html');
const HAS_DIST = existsSync(DIST_INDEX);

// Buffer circulaire des dernières alertes (utile au démarrage / au debug).
const RECENT_ALERTS_MAX = 100;
/** @type {Array<object>} */
const recentAlerts = [];

// Le simulateur est démarré une seule fois, partagé par tous les clients.
const simulator = startSimulator(
  (eventName, data) => hub.broadcast(eventName, data),
  (alert) => {
    recentAlerts.push(alert);
    if (recentAlerts.length > RECENT_ALERTS_MAX) recentAlerts.shift();
  },
);

/**
 * Construit et configure l'instance Fastify.
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: undefined,
    },
    // Le simulateur produit l'horodatage ; pas de contrainte stricte sur le body.
    bodyLimit: 1_048_576, // 1 Mio
  });

  await app.register(cors, { origin: true });

  // ---------- Routes API ----------

  // GET /api/health, sonde de vivacité.
  app.get('/api/health', async () => ({
    status: 'ok',
    version: VERSION,
    uptimeS: uptimeSeconds(),
    hosts: hostsTotal(),
  }));

  // GET /api/hosts, instantané complet de la flotte.
  app.get('/api/hosts', async () => getSnapshot(simulator.activeIncidents()));

  // GET /api/series/:hostId?metric=cpu&points=120, série temporelle d'une métrique.
  app.get('/api/series/:hostId', async (request, reply) => {
    const { hostId } = /** @type {{ hostId: string }} */ (request.params);
    const query = /** @type {{ metric?: string, points?: string }} */ (request.query);
    const metric = query.metric ?? 'cpu';
    const points = query.points !== undefined ? Number.parseInt(query.points, 10) : 120;

    if (!hasHost(hostId)) {
      return reply.code(404).send({ error: 'host_not_found', hostId });
    }
    if (!hasMetric(metric)) {
      return reply.code(404).send({ error: 'metric_not_found', metric });
    }
    const series = getSeries(hostId, metric, Number.isFinite(points) ? points : 120);
    // getSeries ne renvoie null que pour hôte/métrique inconnus, déjà traités.
    return series;
  });

  // POST /api/ingest, voie d'ingestion : applique des overrides de métriques.
  app.post('/api/ingest', async (request, reply) => {
    const body = /** @type {{ hostId?: unknown, metrics?: unknown }} */ (request.body);
    if (
      body === null ||
      typeof body !== 'object' ||
      typeof body.hostId !== 'string' ||
      body.metrics === null ||
      typeof body.metrics !== 'object' ||
      Array.isArray(body.metrics)
    ) {
      return reply.code(400).send({ ok: false, error: 'invalid_body' });
    }
    const ok = ingest(body.hostId, /** @type {object} */ (body.metrics));
    if (!ok) {
      return reply.code(400).send({ ok: false, error: 'unknown_host' });
    }
    return { ok: true };
  });

  // GET /api/stream, flux Server-Sent Events (snapshots + alertes + heartbeat).
  app.get('/api/stream', (request, reply) => {
    // On prend la main sur la réponse brute : Fastify ne doit pas la sérialiser.
    reply.hijack();
    const raw = reply.raw;

    const { id, close } = hub.add(raw);

    // Envoi IMMÉDIAT du snapshot courant à la connexion.
    hub.sendTo(id, 'snapshot', getSnapshot(simulator.activeIncidents()));

    // Nettoyage à la déconnexion du client.
    request.raw.on('close', close);
    request.raw.on('error', close);
  });

  // ---------- Front statique / page d'information ----------

  if (HAS_DIST) {
    // Sert les assets buildés du front.
    await app.register(fastifyStatic, {
      root: DIST_DIR,
      prefix: '/',
      index: ['index.html'],
      wildcard: false,
    });

    // Repli SPA : toute route non-/api renvoie index.html (routage côté client).
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', url: request.url });
    });
  } else {
    // Pas de build : petite page JSON d'information sur la racine.
    app.get('/', async () => ({
      name: 'GRID server',
      version: VERSION,
      message:
        "Backend d'observabilité temps réel. Le build du front (../web/dist) est absent : exécutez `npm run build` à la racine, puis relancez en production.",
      endpoints: {
        health: '/api/health',
        hosts: '/api/hosts',
        series: '/api/series/:hostId?metric=cpu&points=120',
        ingest: 'POST /api/ingest',
        stream: '/api/stream (SSE)',
      },
      sseEvents: ['snapshot', 'alert'],
      hosts: hostsTotal(),
    }));

    // Pour les autres routes inconnues hors /api, message clair.
    app.setNotFoundHandler((request, reply) =>
      reply.code(404).send({ error: 'not_found', url: request.url }),
    );
  }

  return app;
}

/**
 * Démarre l'écoute HTTP et affiche la bannière.
 */
async function main() {
  const app = await buildApp();
  const port = Number.parseInt(process.env.PORT || '8787', 10);
  const host = '0.0.0.0';

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  printBanner(port);

  // Arrêt propre : on stoppe le simulateur et on ferme Fastify.
  const shutdown = async (signal) => {
    app.log.info(`Signal ${signal} reçu, arrêt en cours…`);
    simulator.stop();
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Affiche une bannière de démarrage façon mission control.
 * @param {number} port
 */
function printBanner(port) {
  const mode = HAS_DIST ? 'production (front servi depuis ../web/dist)' : 'API seule (front non buildé)';
  const lines = [
    '',
    '  ███  ██████  ██ ██████   ',
    ' ██     ██   ██ ██ ██   ██ ',
    ' ██ ███ ██████  ██ ██   ██   GRID, control plane',
    ' ██  ██ ██   ██ ██ ██   ██ ',
    '  ███  ██   ██ ██ ██████   ',
    '',
    `  • version   : ${VERSION}`,
    `  • écoute    : http://localhost:${port}`,
    `  • mode      : ${mode}`,
    `  • flotte    : ${hostsTotal()} hôtes simulés`,
    `  • SSE       : GET /api/stream (événements: snapshot, alert)`,
    '',
  ];
  // Sortie console directe pour la bannière (lisibilité au démarrage).
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
