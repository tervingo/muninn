import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  console.log('Aplicando esquema...');
  await pool.query(sql);
  console.log('✔ Esquema aplicado correctamente.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Error aplicando el esquema:', err);
  process.exit(1);
});
