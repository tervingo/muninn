import { UMAP } from 'umap-js';
import { kmeans } from 'ml-kmeans';
import { pool, query } from '../src/db.js';
import { parseVectorLiteral } from '../src/lib/embeddings.js';

// Fase 6, T6.4 — mapa semántico. Ejecución manual (no cron): recalcula la posición 2D
// (UMAP) y el cluster (k-means, sobre esa misma proyección 2D para que el color agrupe
// visualmente igual que la posición) de todas las notas con embedding, y sustituye el
// contenido de `mapa_notas`. Ejecutar de nuevo cuando haya cambiado significativamente
// el conjunto de notas (tras una importación grande, por ejemplo).

const MIN_NOTAS = 5;
const MAX_CLUSTERS = 8; // coincide con el número de colores categóricos de la paleta

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function clusterNotes(): Promise<void> {
  const { rows } = await query<{ id: string; embedding: string }>(
    'SELECT id, embedding FROM notas WHERE embedding IS NOT NULL AND NOT archivada',
  );

  if (rows.length < MIN_NOTAS) {
    console.log(
      `Solo ${rows.length} nota(s) con embedding (mínimo ${MIN_NOTAS} para que UMAP tenga sentido) — nada que hacer todavía.`,
    );
    await pool.end();
    return;
  }

  console.log(`Proyectando ${rows.length} notas a 2D con UMAP...`);
  const vectors = rows.map((r) => parseVectorLiteral(r.embedding));
  const nNeighbors = Math.min(15, rows.length - 1);
  const umap = new UMAP({ nComponents: 2, nNeighbors, distanceFn: cosineDistance });
  const proyectado = umap.fit(vectors);

  const k = Math.max(2, Math.min(MAX_CLUSTERS, Math.round(Math.sqrt(rows.length / 2))));
  console.log(`Agrupando en ${k} clusters...`);
  const { clusters } = kmeans(proyectado, k, { seed: 42 });

  await query('DELETE FROM mapa_notas');
  await query(
    `INSERT INTO mapa_notas (nota_id, x, y, cluster_id)
     SELECT * FROM unnest($1::uuid[], $2::real[], $3::real[], $4::int[])`,
    [rows.map((r) => r.id), proyectado.map((p) => p[0]), proyectado.map((p) => p[1]), clusters],
  );

  console.log(`✔ Mapa actualizado: ${rows.length} notas en ${k} clusters.`);
  await pool.end();
}

clusterNotes().catch((err) => {
  console.error('Error generando el mapa semántico:', err);
  process.exit(1);
});
