/**
 * Genera iconos PNG para la PWA sin dependencias externas.
 * Dibuja un fondo con el color de tema y una "M" (Muninn) en color claro.
 * Son iconos placeholder: sustituir por un diseño propio cuando se quiera.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

const BG = [30, 30, 46]; // #1e1e2e
const FG = [203, 166, 247]; // #cba6f7 (lila)

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

// ¿Está el píxel (x,y) dentro de los trazos de una "M"?
function isM(x, y, size) {
  const m = size * 0.22; // margen
  const inner = size - 2 * m;
  const nx = (x - m) / inner;
  const ny = (y - m) / inner;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;
  const stroke = 0.2;
  // Dos patas verticales
  if (nx < stroke || nx > 1 - stroke) return true;
  // Diagonales que bajan desde las esquinas superiores hacia el centro
  if (Math.abs(ny - nx * 2) < stroke && nx <= 0.5) return true;
  if (Math.abs(ny - (1 - nx) * 2) < stroke && nx >= 0.5) return true;
  return false;
}

function makePng(size) {
  const bytesPerRow = size * 3;
  const raw = Buffer.alloc((bytesPerRow + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (bytesPerRow + 1);
    raw[rowStart] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      const [r, g, b] = isM(x, y, size) ? FG : BG;
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(outDir, name), makePng(size));
  console.log('generado', name);
}

// favicon.svg (vectorial, para pestaña del navegador)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#1e1e2e"/>
  <path d="M25 75 V30 L50 60 L75 30 V75" fill="none" stroke="#cba6f7" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
writeFileSync(join(outDir, 'favicon.svg'), svg);
console.log('generado favicon.svg');
