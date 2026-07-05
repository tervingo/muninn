import type { Server, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// Relay de sincronización Yjs sobre WebSocket, integrado en el servidor HTTP de Express.
// Fase 2 · Tarea 1: solo relé en memoria por sala (una sala = una nota). Sin persistencia
// (Tarea 3) ni autenticación (Tarea 5) todavía.

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** Prefijo de ruta para las conexiones Yjs: ws(s)://host/yjs/<noteId> */
export const YJS_PATH_PREFIX = '/yjs/';

class WSSharedDoc extends Y.Doc {
  readonly name: string;
  /** Conexiones abiertas → conjunto de clientIDs de awareness que controla cada una. */
  readonly conns = new Map<WebSocket, Set<number>>();
  readonly awareness: awarenessProtocol.Awareness;

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

    this.on('update', (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => send(this, conn, buff));
    });
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
    // Sin persistencia todavía: cuando no quedan conexiones, liberamos el doc de memoria.
    if (doc.conns.size === 0) {
      doc.destroy();
      docs.delete(doc.name);
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
      // Solo respondemos si readSyncMessage escribió algo (p. ej. SyncStep2).
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

function onConnection(conn: WebSocket, docName: string): void {
  conn.binaryType = 'arraybuffer';
  const doc = getDoc(docName);
  doc.conns.set(conn, new Set());

  conn.on('message', (data: ArrayBuffer) => onMessage(conn, doc, new Uint8Array(data)));
  conn.on('close', () => closeConn(doc, conn));

  // Paso 1 del protocolo de sincronización: enviamos nuestro state vector.
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
}

/** Engancha el relay Yjs al servidor HTTP existente (comparte puerto con Express). */
export function setupYjsWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (conn: WebSocket, _req: IncomingMessage, docName: string) =>
    onConnection(conn, docName),
  );

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    if (!pathname.startsWith(YJS_PATH_PREFIX)) return;

    const docName = decodeURIComponent(pathname.slice(YJS_PATH_PREFIX.length));
    if (!docName) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, docName));
  });
}
