import type { Server, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { loadYjsState, persistDoc } from './persistence.js';
import { verifyWsTicket } from '../auth/tokens.js';

// Relay de sincronización Yjs sobre WebSocket, integrado en el servidor HTTP de Express.
// Fase 2 · Tarea 3: relay + persistencia (carga yjs_state al abrir la sala; guarda
// yjs_state + proyección contenido con debounce y al cerrarse la última conexión).

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PERSIST_DEBOUNCE_MS = 2500;

/** Prefijo de ruta para las conexiones Yjs: ws(s)://host/yjs/<noteId> */
export const YJS_PATH_PREFIX = '/yjs/';

class WSSharedDoc extends Y.Doc {
  readonly name: string;
  readonly conns = new Map<WebSocket, Set<number>>();
  readonly awareness: awarenessProtocol.Awareness;
  /** Se resuelve cuando el estado persistido (si lo hay) ya se ha cargado. */
  readonly whenLoaded: Promise<void>;
  /** Hay cambios reales (no de carga) sin persistir. */
  dirty = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(name: string) {
    super({ gc: true });
    this.name = name;
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changed = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        const buff = encoding.toUint8Array(encoder);
        this.conns.forEach((_, conn) => send(this, conn, buff));
      },
    );

    this.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => send(this, conn, buff));

      // 'load' = aplicación del estado persistido; no cuenta como cambio a persistir.
      if (origin !== 'load') {
        this.dirty = true;
        this.schedulePersist();
      }
    });

    this.whenLoaded = this.loadPersisted();
  }

  private async loadPersisted(): Promise<void> {
    try {
      const state = await loadYjsState(this.name);
      if (state) Y.applyUpdate(this, state, 'load');
    } catch (err) {
      console.error(`[yjs] error cargando estado de ${this.name}:`, err);
    }
  }

  schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Guarda si hay cambios pendientes. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await persistDoc(this.name, this);
    } catch (err) {
      console.error(`[yjs] error persistiendo ${this.name}:`, err);
      this.dirty = true; // reintentará en el próximo cambio/cierre
    }
  }
}

const docs = new Map<string, WSSharedDoc>();

function getDoc(name: string): WSSharedDoc {
  let doc = docs.get(name);
  if (!doc) {
    doc = new WSSharedDoc(name);
    docs.set(name, doc);
  }
  return doc;
}

function send(doc: WSSharedDoc, conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(message, (err) => {
      if (err) closeConn(doc, conn);
    });
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc: WSSharedDoc, conn: WebSocket): void {
  const controlledIds = doc.conns.get(conn);
  if (controlledIds) {
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);

    if (doc.conns.size === 0) {
      // Última conexión: persistir lo pendiente y liberar el doc de memoria.
      void (async () => {
        await doc.flush();
        if (doc.conns.size === 0) {
          doc.destroy();
          docs.delete(doc.name);
        }
      })();
    }
  }
  try {
    conn.close();
  } catch {
    /* noop */
  }
}

function onMessage(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array): void {
  const decoder = decoding.createDecoder(message);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case MESSAGE_SYNC: {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
      if (encoding.length(encoder) > 1) {
        send(doc, conn, encoding.toUint8Array(encoder));
      }
      break;
    }
    case MESSAGE_AWARENESS: {
      awarenessProtocol.applyAwarenessUpdate(
        doc.awareness,
        decoding.readVarUint8Array(decoder),
        conn,
      );
      break;
    }
    default:
      break;
  }
}

async function onConnection(conn: WebSocket, docName: string): Promise<void> {
  conn.binaryType = 'arraybuffer';
  const doc = getDoc(docName);
  doc.conns.set(conn, new Set());

  // Encolamos los mensajes hasta que el estado persistido esté cargado, para no
  // procesar un sync contra un doc a medio cargar (ni perder mensajes tempranos).
  let loaded = false;
  const queue: Uint8Array[] = [];
  conn.on('message', (data: ArrayBuffer) => {
    const msg = new Uint8Array(data);
    if (loaded) onMessage(conn, doc, msg);
    else queue.push(msg);
  });
  conn.on('close', () => closeConn(doc, conn));

  await doc.whenLoaded;
  loaded = true;

  // Paso 1 del protocolo de sincronización: nuestro state vector (ya con lo persistido).
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
  }

  // Estados de awareness actuales, si los hay.
  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())),
    );
    send(doc, conn, encoding.toUint8Array(encoder));
  }

  // Procesamos lo que llegó mientras cargábamos.
  for (const msg of queue) onMessage(conn, doc, msg);
}

/** Engancha el relay Yjs al servidor HTTP existente (comparte puerto con Express). */
export function setupYjsWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (conn: WebSocket, _req: IncomingMessage, docName: string) => {
    void onConnection(conn, docName);
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (!url.pathname.startsWith(YJS_PATH_PREFIX)) return;

    if (!verifyWsTicket(url.searchParams.get('ticket'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const docName = decodeURIComponent(url.pathname.slice(YJS_PATH_PREFIX.length));
    if (!docName) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, docName));
  });
}
