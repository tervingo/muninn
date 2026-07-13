import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { ah } from '../lib/asyncHandler.js';
import { syncEnlaces, resyncAllEnlaces } from '../lib/wikilinks.js';
import { actualizarEmbeddingNota, generarEmbedding, toVectorLiteral } from '../lib/embeddings.js';
import { deleteObjects } from '../lib/r2.js';
import { EMPTY_DOC, type DocNode, type MapPoint, type Note, type RelatedNote, type TagCount } from '../types.js';

const router = Router();
router.use(requireAuth);

// Columnas de `notas` a devolver al cliente: todo menos `embedding` (uso interno de
// búsqueda semántica — 1024 floats que no aporta nada al frontend y pesan innecesariamente).
const NOTA_COLUMNAS = 'id, titulo, contenido, yjs_state, creado_en, actualizado_en, archivada, tags';

/** Normaliza etiquetas: sin '#' inicial, trim, minúsculas, sin vacíos ni duplicados. */
function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const t of input) {
    if (typeof t !== 'string') continue;
    const s = t.trim().replace(/^#+/, '').trim().toLowerCase();
    if (s) seen.add(s);
  }
  return [...seen];
}

// El contenido es un documento ProseMirror arbitrario; validamos que sea un objeto con `type`.
const docSchema: z.ZodType<DocNode> = z.lazy(() =>
  z
    .object({
      type: z.string(),
      attrs: z.record(z.unknown()).optional(),
      content: z.array(docSchema).optional(),
      marks: z.array(z.object({ type: z.string(), attrs: z.record(z.unknown()).optional() })).optional(),
      text: z.string().optional(),
    })
    .passthrough() as unknown as z.ZodType<DocNode>,
);

const createSchema = z.object({
  titulo: z.string().trim().min(1, 'El título no puede estar vacío').max(500),
  contenido: docSchema.optional(),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
});

const bulkTagSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  tag: z.string().trim().min(1),
  action: z.enum(['add', 'remove']),
});

const importSchema = z.object({
  notas: z
    .array(
      z.object({
        titulo: z.string().trim().min(1).max(500),
        contenido: docSchema.optional(),
        tags: z.array(z.string()).max(50).optional(),
      }),
    )
    .min(1)
    .max(5000),
});

const updateSchema = z
  .object({
    titulo: z.string().trim().min(1).max(500).optional(),
    contenido: docSchema.optional(),
    archivada: z.boolean().optional(),
    tags: z.array(z.string()).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada que actualizar' });

/** Borra (best-effort) los objetos R2 de los adjuntos de las notas dadas. Debe llamarse
 * ANTES de borrar las notas (el ON DELETE CASCADE se lleva las filas de `adjuntos`). */
async function deleteAttachmentsFor(notaIds: string[]): Promise<void> {
  if (notaIds.length === 0) return;
  const { rows } = await query<{ url: string }>('SELECT url FROM adjuntos WHERE nota_id = ANY($1::uuid[])', [
    notaIds,
  ]);
  if (rows.length === 0) return;
  await deleteObjects(rows.map((r) => r.url)).catch((err) =>
    console.error('Error borrando adjuntos de R2:', err),
  );
}

// GET /api/notes?archivadas=true|false&tags=a,b  → listado (resumen), filtrable por etiquetas (AND)
router.get(
  '/',
  ah(async (req, res) => {
    const incluirArchivadas = req.query.archivadas === 'true';
    const tags = normalizeTags(
      typeof req.query.tags === 'string' ? req.query.tags.split(',') : [],
    );

    const conds: string[] = [];
    const params: unknown[] = [];
    if (!incluirArchivadas) conds.push('archivada = false');
    if (tags.length > 0) {
      params.push(tags);
      conds.push(`tags @> $${params.length}::text[]`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await query<Note>(
      `SELECT id, titulo, actualizado_en, archivada, tags
       FROM notas
       ${where}
       ORDER BY actualizado_en DESC`,
      params,
    );
    res.json(rows);
  }),
);

// GET /api/notes/tags  → todas las etiquetas con su número de notas (para el filtro)
router.get(
  '/tags',
  ah(async (_req, res) => {
    const { rows } = await query<TagCount>(
      `SELECT tag, count(*)::int AS count
       FROM notas, unnest(tags) AS tag
       GROUP BY tag
       ORDER BY tag`,
    );
    res.json(rows);
  }),
);

// GET /api/notes/map  → puntos del mapa semántico precalculado (T6.4)
router.get(
  '/map',
  ah(async (_req, res) => {
    const { rows } = await query<MapPoint>(
      `SELECT n.id, n.titulo, m.x, m.y, m.cluster_id
       FROM mapa_notas m
       JOIN notas n ON n.id = m.nota_id
       WHERE NOT n.archivada
       ORDER BY m.cluster_id`,
    );
    res.json(rows);
  }),
);

// GET /api/notes/search/semantic?q=...&limit=10&tags=a,b  → búsqueda semántica (T6.3)
router.get(
  '/search/semantic',
  ah(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.status(400).json({ error: 'Falta el parámetro de búsqueda «q»' });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 50) : 10;
    const tags = normalizeTags(
      typeof req.query.tags === 'string' ? req.query.tags.split(',') : [],
    );

    const embedding = await generarEmbedding(q, 'query');

    const conds = ['NOT archivada', 'embedding IS NOT NULL'];
    const params: unknown[] = [toVectorLiteral(embedding)];
    if (tags.length > 0) {
      params.push(tags);
      conds.push(`tags @> $${params.length}::text[]`);
    }
    params.push(limit);

    const { rows } = await query<RelatedNote>(
      `SELECT id, titulo, embedding <=> $1::vector AS distancia
       FROM notas
       WHERE ${conds.join(' AND ')}
       ORDER BY distancia
       LIMIT $${params.length}`,
      params,
    );
    res.json(rows);
  }),
);

// GET /api/notes/:id  → nota completa
router.get(
  '/:id',
  ah(async (req, res) => {
    const { rows } = await query<Note>(`SELECT ${NOTA_COLUMNAS} FROM notas WHERE id = $1`, [
      req.params.id,
    ]);
    const nota = rows[0];
    if (!nota) {
      res.status(404).json({ error: 'Nota no encontrada' });
      return;
    }
    res.json(nota);
  }),
);

// GET /api/notes/:id/backlinks  → notas que enlazan a ésta
router.get(
  '/:id/backlinks',
  ah(async (req, res) => {
    const { rows } = await query<{ id: string; titulo: string }>(
      `SELECT n.id, n.titulo
       FROM enlaces e
       JOIN notas n ON n.id = e.nota_origen_id
       WHERE e.nota_destino_id = $1
       ORDER BY n.titulo`,
      [req.params.id],
    );
    res.json(rows);
  }),
);

// GET /api/notes/:id/related?limit=5  → notas semánticamente parecidas (T6.2)
router.get(
  '/:id/related',
  ah(async (req, res) => {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 20) : 5;

    const { rows: origen } = await query<{ embedding: string | null }>(
      'SELECT embedding FROM notas WHERE id = $1',
      [req.params.id],
    );
    const embedding = origen[0]?.embedding;
    // Nota recién creada (aún sin pasar por el debounce de guardado) o inexistente:
    // sin embedding no hay con qué comparar, se devuelve vacío en vez de romper.
    if (!embedding) {
      res.json([]);
      return;
    }

    const { rows } = await query<RelatedNote>(
      `SELECT id, titulo, embedding <=> $1::vector AS distancia
       FROM notas
       WHERE id != $2 AND NOT archivada AND embedding IS NOT NULL
       ORDER BY distancia
       LIMIT $3`,
      [embedding, req.params.id, limit],
    );
    res.json(rows);
  }),
);

// POST /api/notes  → crear
router.post(
  '/',
  ah(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    const contenido = parsed.data.contenido ?? EMPTY_DOC;

    const { rows } = await query<Note>(
      `INSERT INTO notas (titulo, contenido) VALUES ($1, $2) RETURNING ${NOTA_COLUMNAS}`,
      [parsed.data.titulo, contenido],
    );
    const nota = rows[0]!;

    await syncEnlaces(nota.id, contenido);
    // Una nota nueva puede ser destino de wikilinks ya escritos en otras notas.
    await resyncAllEnlaces();
    // Fire-and-forget: no debe retrasar la respuesta al cliente.
    void actualizarEmbeddingNota(nota.id, contenido);

    res.status(201).json(nota);
  }),
);

// POST /api/notes/bulk-delete  → borra varias notas por id (p. ej. resultados de un filtro).
router.post(
  '/bulk-delete',
  ah(async (req, res) => {
    const parsed = bulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    await deleteAttachmentsFor(parsed.data.ids);
    const { rowCount } = await query('DELETE FROM notas WHERE id = ANY($1::uuid[])', [
      parsed.data.ids,
    ]);
    res.json({ deleted: rowCount ?? 0 });
  }),
);

// POST /api/notes/bulk-tag  → añade o quita una etiqueta a varias notas de una vez (p. ej.
// resultados de una búsqueda semántica). Una sola consulta masiva, no un bucle por nota:
// las etiquetas no forman parte del documento ni del texto embedido, así que no hace falta
// recalcular enlaces ni embeddings.
router.post(
  '/bulk-tag',
  ah(async (req, res) => {
    const parsed = bulkTagSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    const tag = normalizeTags([parsed.data.tag])[0];
    if (!tag) {
      res.status(400).json({ error: 'Etiqueta inválida' });
      return;
    }

    const { rowCount } =
      parsed.data.action === 'add'
        ? await query(
            `UPDATE notas SET tags = tags || $2::text[], actualizado_en = now()
             WHERE id = ANY($1::uuid[]) AND NOT (tags @> $2::text[])`,
            [parsed.data.ids, [tag]],
          )
        : await query(
            `UPDATE notas SET tags = array_remove(tags, $2::text), actualizado_en = now()
             WHERE id = ANY($1::uuid[]) AND tags @> ARRAY[$2::text]`,
            [parsed.data.ids, tag],
          );
    res.json({ updated: rowCount ?? 0 });
  }),
);

// POST /api/notes/import  → alta masiva (p. ej. importación de Obsidian).
// Inserta todas las notas en una transacción y recalcula los enlaces UNA sola vez.
router.post(
  '/import',
  ah(async (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }

    const client = await pool.connect();
    // ids en el mismo orden que `parsed.data.notas`, para que el cliente pueda asociar
    // imágenes/adjuntos a la nota correcta tras la creación masiva.
    const ids: string[] = [];
    try {
      await client.query('BEGIN');
      for (const n of parsed.data.notas) {
        const { rows } = await client.query<{ id: string }>(
          'INSERT INTO notas (titulo, contenido, tags) VALUES ($1, $2, $3) RETURNING id',
          [n.titulo, n.contenido ?? EMPTY_DOC, normalizeTags(n.tags ?? [])],
        );
        ids.push(rows[0]!.id);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
    client.release();

    // Resolver backlinks entre todas las notas (incluidas las recién importadas) una vez.
    await resyncAllEnlaces();

    // Fire-and-forget: en secuencia (no en paralelo) para no saturar la API de Voyage
    // con una importación masiva, y sin retrasar la respuesta al cliente.
    void (async () => {
      for (let i = 0; i < ids.length; i++) {
        await actualizarEmbeddingNota(ids[i]!, parsed.data.notas[i]!.contenido ?? EMPTY_DOC);
      }
    })();

    res.status(201).json({ imported: ids.length, ids });
  }),
);

// PATCH /api/notes/:id  → actualizar (título, contenido, archivada)
router.patch(
  '/:id',
  ah(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }

    const { rows: existentes } = await query<Note>(`SELECT ${NOTA_COLUMNAS} FROM notas WHERE id = $1`, [
      req.params.id,
    ]);
    const previa = existentes[0];
    if (!previa) {
      res.status(404).json({ error: 'Nota no encontrada' });
      return;
    }

    const titulo = parsed.data.titulo ?? previa.titulo;
    const contenido = parsed.data.contenido ?? previa.contenido;
    const archivada = parsed.data.archivada ?? previa.archivada;
    const tags = parsed.data.tags !== undefined ? normalizeTags(parsed.data.tags) : previa.tags;

    const { rows } = await query<Note>(
      `UPDATE notas
       SET titulo = $1, contenido = $2, archivada = $3, tags = $4, actualizado_en = now()
       WHERE id = $5
       RETURNING ${NOTA_COLUMNAS}`,
      [titulo, contenido, archivada, tags, req.params.id],
    );
    const nota = rows[0]!;

    const tituloCambiado = parsed.data.titulo !== undefined && parsed.data.titulo !== previa.titulo;
    if (parsed.data.contenido !== undefined) {
      await syncEnlaces(nota.id, contenido);
      // Fire-and-forget: no debe retrasar la respuesta al cliente.
      void actualizarEmbeddingNota(nota.id, contenido);
    }
    // Si cambió el título, otras notas pueden resolver (o dejar de resolver) hacia ésta.
    if (tituloCambiado) {
      await resyncAllEnlaces();
    }

    res.json(nota);
  }),
);

// DELETE /api/notes/:id  → eliminar definitivamente
router.delete(
  '/:id',
  ah(async (req, res) => {
    await deleteAttachmentsFor([req.params.id]);
    const { rowCount } = await query('DELETE FROM notas WHERE id = $1', [req.params.id]);
    if (rowCount === 0) {
      res.status(404).json({ error: 'Nota no encontrada' });
      return;
    }
    res.status(204).end();
  }),
);

export default router;
