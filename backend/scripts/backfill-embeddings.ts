import { pool, query } from '../src/db.js';
import { actualizarEmbeddingNota } from '../src/lib/embeddings.js';
import type { DocNode } from '../src/types.js';

// Genera el embedding de todas las notas que aún no lo tienen (altas previas a T6.1,
// o notas cuyo último intento falló). Ejecutar una vez en dev y una vez en prod.
async function backfill(): Promise<void> {
  const { rows } = await query<{ id: string; contenido: DocNode }>(
    'SELECT id, contenido FROM notas WHERE embedding IS NULL',
  );

  console.log(`Generando embeddings para ${rows.length} nota(s)...`);
  for (const [i, row] of rows.entries()) {
    // actualizarEmbeddingNota nunca lanza: registra su propio error y sigue.
    await actualizarEmbeddingNota(row.id, row.contenido);
    console.log(`  [${i + 1}/${rows.length}] ${row.id}`);
  }

  const { rows: pendientes } = await query<{ count: string }>(
    'SELECT count(*) FROM notas WHERE embedding IS NULL',
  );
  const sinEmbedding = Number(pendientes[0]?.count ?? 0);
  console.log(`✔ ${rows.length - sinEmbedding}/${rows.length} embeddings generados.`);
  if (sinEmbedding > 0) {
    console.log(
      `  (${sinEmbedding} nota(s) sin embedding: contenido vacío, o falló la llamada a Voyage — ` +
        'revisa el log de arriba; para reintentar solo las fallidas, vuelve a ejecutar el script)',
    );
  }
  await pool.end();
}

backfill().catch((err) => {
  console.error('Error en el backfill de embeddings:', err);
  process.exit(1);
});
