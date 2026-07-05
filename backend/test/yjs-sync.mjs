/**
 * Prueba manual de la Tarea 1 (relay Yjs): abre dos clientes en la misma sala,
 * escribe en uno y comprueba que el cambio se propaga al otro a través del servidor.
 *
 *   node test/yjs-sync.mjs        (con el backend corriendo en :3000)
 */
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
// Configurable para probar contra local o producción: YJS_URL=wss://host/yjs node test/yjs-sync.mjs
const URL = process.env.YJS_URL ?? 'ws://localhost:3000/yjs';
const room = 'test-' + Math.floor(Date.now() / 1000);

function makeClient(label) {
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
    const type = decoding.readVarUint(decoder);
    if (type !== MESSAGE_SYNC) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.readSyncMessage(decoder, enc, doc, ws);
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
  });

  // Propaga los cambios locales (origin != ws) al servidor.
  doc.on('update', (update, origin) => {
    if (origin === ws) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    sync.writeUpdate(enc, update);
    if (ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(enc));
  });

  return { doc, ws, label };
}

const a = makeClient('A');
const b = makeClient('B');

const opened = new Promise((resolve) => {
  let n = 0;
  const done = () => { if (++n === 2) resolve(); };
  a.ws.on('open', done);
  b.ws.on('open', done);
});

const EXPECTED = 'hola desde A';

opened
  .then(() => new Promise((r) => setTimeout(r, 300))) // deja completar el sync inicial
  .then(() => {
    a.doc.getText('t').insert(0, EXPECTED);
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (b.doc.getText('t').toString() === EXPECTED) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > 5000) {
          clearInterval(iv);
          reject(new Error('timeout: B no recibió el cambio de A'));
        }
      }, 50);
    });
  })
  .then(() => {
    console.log(`PASS · B recibió: "${b.doc.getText('t').toString()}"`);
    a.ws.close(); b.ws.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('FAIL ·', err.message);
    console.error('  A:', JSON.stringify(a.doc.getText('t').toString()));
    console.error('  B:', JSON.stringify(b.doc.getText('t').toString()));
    a.ws.close(); b.ws.close();
    process.exit(1);
  });
