import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { ah } from '../lib/asyncHandler.js';
import { syncEnlaces } from '../lib/wikilinks.js';
import { EMPTY_DOC, type DocNode, type Note } from '../types.js';

const router = Router();
router.use(requireAuth);

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

// GET /api/notes?archivadas=true|false  → listado (resumen)
router.get(
  '/',
  ah(async (req, res) => {
    const incluirArchivadas = req.query.archivadas === 'true';
    const { rows } = await query<Note>(
      `SELECT id, titulo, actualizado_en, archivada
       FROM notas
       ${incluirArchivadas ? '' : 'WHERE archivada = false'}
       ORDER BY actualizado_en DESC`,
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

    const { rows } = await query<Note>(
      `UPDATE notas
       SET titulo = $1, contenido = $2, archivada = $3, actualizado_en = now()
       WHERE id = $4
       RETURNING *`,
      [titulo, contenido, archivada, req.params.id],
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
