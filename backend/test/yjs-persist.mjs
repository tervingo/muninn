/**
 * Prueba E2E de la Tarea 3 (persistencia). Requiere el backend corriendo en :3000 y
 * DATABASE_URL en el entorno (lee backend/.env).
 *
 *   node test/yjs-persist.mjs
 *
 * Flujo: inserta una nota → un cliente escribe contenido con estructura ProseMirror →
 * espera a que el servidor persista → desconecta (el servidor vuelca y libera el doc) →
 * comprueba en BD yjs_state + contenido → reconecta un cliente NUEVO y verifica que el
 * estado vuelve desde Postgres. Borra la nota al final.
 */
import 'dotenv/config';
import pg from 'pg';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const URL = 'ws://localhost:3000/yjs';
const TEXT = 'contenido persistente ' + Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function client(room) {
  const doc = new Y.Doc();
  const ws = new WebSocket(`${URL}/${room}`);
  ws.binaryType = 'arraybuffer';
  ws.on('open', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeSyncStep1(enc, doc);
    ws.send(encoding.toUint8Array(enc));
  });
  ws.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data));
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.readSyncMessage(decoder, enc, doc, ws);
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
  });
  doc.on('update', (update, origin) => {
    if (origin === ws) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeUpdate(enc, update);
    if (ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(enc));
  });
  const ready = new Promise((r) => ws.on('open', () => setTimeout(r, 300)));
  return { doc, ws, ready };
}

async function main() {
  const { rows } = await pool.query(
    `INSERT INTO notas (titulo, contenido) VALUES ($1, $2::jsonb) RETURNING id`,
    ['T3 persist test', '{"type":"doc","content":[{"type":"paragraph"}]}'],
  );
  const id = rows[0].id;
  let ok = false;

  try {
    // Cliente 1: escribe un párrafo con texto (estructura ProseMirror en el fragmento 'default').
    const c1 = client(id);
    await c1.ready;
    const frag = c1.doc.getXmlFragment('default');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(TEXT)]);
    Y.transact(c1.doc, () => frag.insert(0, [p]));

    await sleep(4000); // debounce de persistencia del servidor (2.5s) + margen
    c1.ws.close();
    await sleep(1500); // el servidor vuelca al cerrarse la última conexión y libera el doc

    const r = await pool.query(
      `SELECT yjs_state IS NOT NULL AS has_state, contenido FROM notas WHERE id = $1`,
      [id],
    );
    const hasState = r.rows[0].has_state;
    const contenidoHasText = JSON.stringify(r.rows[0].contenido).includes(TEXT);

    // Cliente 2 (nuevo): el servidor debe recrear el doc cargando yjs_state desde Postgres.
    const c2 = client(id);
    await c2.ready;
    await sleep(500);
    const roundtrip = c2.doc.getXmlFragment('default').toJSON().includes(TEXT);
    c2.ws.close();

    console.log({ hasState, contenidoHasText, roundtrip });
    ok = hasState && contenidoHasText && roundtrip;
    console.log(ok ? 'PASS' : 'FAIL');
  } finally {
    await pool.query('DELETE FROM notas WHERE id = $1', [id]);
    await pool.end();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
