/**
 * Valida el cliente real (y-websocket WebsocketProvider, el mismo que usa la app)
 * contra el servidor local. Dos providers en la misma sala; escribe en uno y comprueba
 * que llega al otro en vivo (sin reconectar). Aísla si el fallo era del cliente/servidor
 * o solo del ciclo de vida en React.
 *
 *   node test/provider-sync.mjs   (backend en :3000)
 */
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import WS from 'ws';

const URL = 'ws://localhost:3000/yjs';
const room = 'provtest-' + Math.floor(Date.now() / 1000);

const docA = new Y.Doc();
const pA = new WebsocketProvider(URL, room, docA, { WebSocketPolyfill: WS });
const docB = new Y.Doc();
const pB = new WebsocketProvider(URL, room, docB, { WebSocketPolyfill: WS });

const bothSynced = Promise.all([
  new Promise((r) => pA.on('sync', (s) => s && r())),
  new Promise((r) => pB.on('sync', (s) => s && r())),
]);

const EXPECTED = 'texto en vivo';

bothSynced
  .then(() => {
    docA.getText('t').insert(0, EXPECTED);
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (docB.getText('t').toString() === EXPECTED) {
          clearInterval(iv);
          resolve();
        } else if (Date.now() - t0 > 5000) {
          clearInterval(iv);
          reject(new Error('timeout: B no recibió el cambio en vivo'));
        }
      }, 50);
    });
  })
  .then(() => {
    console.log(`PASS · B recibió en vivo: "${docB.getText('t').toString()}"`);
    pA.destroy();
    pB.destroy();
    process.exit(0);
  })
  .catch((err) => {
    console.error('FAIL ·', err.message);
    pA.destroy();
    pB.destroy();
    process.exit(1);
  });
