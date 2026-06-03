// Hub Server-Sent Events (SSE) de GRID.
//
// Un unique hub partagé gère l'ensemble des clients connectés au flux /api/stream.
// Le simulateur tourne une seule fois (un seul tick global) et appelle broadcast()
// pour diffuser à tous les abonnés : il n'y a donc PAS un timer par client. Le hub
// gère aussi un heartbeat périodique (commentaire ":hb") pour maintenir les
// connexions ouvertes à travers les proxys, et le nettoyage à la déconnexion.

/**
 * @typedef {import('http').ServerResponse} ServerResponse
 */

/**
 * @typedef {Object} SseClient
 * @property {number} id
 * @property {ServerResponse} raw   Flux brut de réponse (reply.raw).
 */

// Intervalle du heartbeat en millisecondes (15 s, cf. cahier des charges).
const HEARTBEAT_MS = 15_000;

class SseHub {
  constructor() {
    /** @type {Map<number, SseClient>} */
    this.clients = new Map();
    /** @type {number} */
    this.seq = 0;
    /** @type {NodeJS.Timeout | null} */
    this.heartbeatTimer = null;
  }

  /**
   * Démarre le heartbeat partagé (idempotent).
   */
  start() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    // Ne pas maintenir le process en vie uniquement pour le heartbeat.
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
  }

  /**
   * Enregistre un nouveau client SSE. Écrit les en-têtes du flux et renvoie un
   * handle permettant de fermer/nettoyer ultérieurement.
   *
   * @param {ServerResponse} raw  Flux brut (reply.raw).
   * @returns {{ id: number, close: () => void }}
   */
  add(raw) {
    this.seq += 1;
    const id = this.seq;

    // En-têtes obligatoires d'un flux SSE.
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Désactive la mise en mémoire tampon côté proxys type nginx.
      'X-Accel-Buffering': 'no',
    });
    // Commentaire initial + suggestion de délai de reconnexion au navigateur.
    raw.write('retry: 3000\n');
    raw.write(': connecté à GRID stream\n\n');

    /** @type {SseClient} */
    const client = { id, raw };
    this.clients.set(id, client);
    this.start();

    return {
      id,
      close: () => this.remove(id),
    };
  }

  /**
   * Retire un client et clôt proprement son flux.
   * @param {number} id
   */
  remove(id) {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    try {
      client.raw.end();
    } catch {
      // Flux déjà fermé côté client : rien à faire.
    }
  }

  /**
   * Diffuse un événement nommé à tous les clients connectés.
   * Les clients dont l'écriture échoue (socket fermée) sont retirés.
   *
   * @param {string} eventName Nom de l'événement SSE (ex. 'snapshot', 'alert').
   * @param {unknown} data      Charge utile sérialisée en JSON.
   */
  broadcast(eventName, data) {
    if (this.clients.size === 0) return;
    const payload = serializeEvent(eventName, data);
    for (const client of this.clients.values()) {
      this.writeRaw(client, payload);
    }
  }

  /**
   * Envoie un événement à un seul client (ex. snapshot initial à la connexion).
   * @param {number} id
   * @param {string} eventName
   * @param {unknown} data
   */
  sendTo(id, eventName, data) {
    const client = this.clients.get(id);
    if (!client) return;
    this.writeRaw(client, serializeEvent(eventName, data));
  }

  /**
   * Émet le heartbeat (ligne de commentaire) vers tous les clients.
   */
  heartbeat() {
    if (this.clients.size === 0) return;
    const ping = ': hb\n\n';
    for (const client of this.clients.values()) {
      this.writeRaw(client, ping);
    }
  }

  /**
   * Écriture bas niveau avec flush et gestion d'erreur (retrait du client).
   * @param {SseClient} client
   * @param {string} chunk
   */
  writeRaw(client, chunk) {
    try {
      client.raw.write(chunk);
      // Flush explicite si la compression/HTTP a exposé flush() ; sinon write
      // suffit, Node pousse les données sur la socket.
      if (typeof client.raw.flush === 'function') client.raw.flush();
    } catch {
      this.remove(client.id);
    }
  }

  /**
   * Nombre de clients actuellement connectés.
   * @returns {number}
   */
  size() {
    return this.clients.size;
  }
}

/**
 * Sérialise un événement SSE complet (lignes event:/data: + double saut de ligne).
 * @param {string} eventName
 * @param {unknown} data
 * @returns {string}
 */
function serializeEvent(eventName, data) {
  const json = JSON.stringify(data);
  // data: peut contenir des retours à la ligne ; ici le JSON est sur une ligne,
  // mais on reste prudent en cas d'évolution future.
  const lines = json.split('\n').map((l) => `data: ${l}`).join('\n');
  return `event: ${eventName}\n${lines}\n\n`;
}

// Hub partagé unique pour tout le process.
export const hub = new SseHub();
