import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { ah } from '../lib/asyncHandler.js';
import { generarEmbedding, toVectorLiteral, extractStructuredText } from '../lib/embeddings.js';
import { responderPregunta, type NotaContexto } from '../lib/claude.js';
import type { DocNode } from '../types.js';

const router = Router();
router.use(requireAuth);

const chatSchema = z.object({
  pregunta: z.string().trim().min(1, 'La pregunta no puede estar vacía').max(2000),
});

const TOP_K = 5;

// POST /api/chat {pregunta}  → chat RAG sobre las notas (T6.5). Embede la pregunta,
// recupera las TOP_K notas más parecidas por similitud semántica, y le pide a
// Claude que responda citando cuáles usó realmente.
router.post(
  '/',
  ah(async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }

    const embedding = await generarEmbedding(parsed.data.pregunta, 'query');

    const { rows } = await query<{ id: string; titulo: string; contenido: DocNode; tags: string[] }>(
      `SELECT id, titulo, contenido, tags
       FROM notas
       WHERE NOT archivada AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(embedding), TOP_K],
    );

    if (rows.length === 0) {
      res.json({ respuesta: 'Todavía no tengo ninguna nota indexada para responder a esto.', notas: [] });
      return;
    }

    const notasContexto: NotaContexto[] = rows.map((r) => ({
      id: r.id,
      titulo: r.titulo,
      texto: extractStructuredText(r.contenido),
      tags: r.tags,
    }));

    const { respuesta, idsUsados } = await responderPregunta(parsed.data.pregunta, notasContexto);

    const notas = rows
      .filter((r) => idsUsados.includes(r.id))
      .map((r) => ({ id: r.id, titulo: r.titulo }));

    res.json({ respuesta, notas });
  }),
);

export default router;
