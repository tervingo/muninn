import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { ah } from '../lib/asyncHandler.js';
import { syncEnlaces } from '../lib/wikilinks.js';
import { EMPTY_DOC, type DocNode, type Note, type TagCount } from '../types.js';

const router = Router();
router.use(requireAuth);

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

const updateSchema = z
  .object({
    titulo: z.string().trim().min(1).max(500).optional(),
    contenido: docSchema.optional(),
    archivada: z.boolean().optional(),
    tags: z.array(z.string()).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada que actualizar' });

/** Re-sincroniza los enlaces de TODAS las notas (para resolver backlinks tras crear/renombrar). */
async function resyncAllEnlaces(): Promise<void> {
  const { rows } = await query<{ id: string; contenido: DocNode }>(
    'SELECT id, contenido FROM notas',
  );
  for (const row of rows) {
    await syncEnlaces(row.id, row.contenido);
  }
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

// GET /api/notes/:id  → nota completa
router.get(
  '/:id',
  ah(async (req, res) => {
    const { rows } = await query<Note>('SELECT * FROM notas WHERE id = $1', [req.params.id]);
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
      `INSERT INTO notas (titulo, contenido) VALUES ($1, $2) RETURNING *`,
      [parsed.data.titulo, contenido],
    );
    const nota = rows[0]!;

    await syncEnlaces(nota.id, contenido);
    // Una nota nueva puede ser destino de wikilinks ya escritos en otras notas.
    await resyncAllEnlaces();

    res.status(201).json(nota);
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

    const { rows: existentes } = await query<Note>('SELECT * FROM notas WHERE id = $1', [
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
       RETURNING *`,
      [titulo, contenido, archivada, tags, req.params.id],
    );
    const nota = rows[0]!;

    const tituloCambiado = parsed.data.titulo !== undefined && parsed.data.titulo !== previa.titulo;
    if (parsed.data.contenido !== undefined) {
      await syncEnlaces(nota.id, contenido);
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
    const { rowCount } = await query('DELETE FROM notas WHERE id = $1', [req.params.id]);
    if (rowCount === 0) {
      res.status(404).json({ error: 'Nota no encontrada' });
      return;
    }
    res.status(204).end();
  }),
);

export default router;
