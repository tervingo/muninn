import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { ah } from '../lib/asyncHandler.js';
import { presignDownload, presignUpload } from '../lib/r2.js';

const router = Router();
router.use(requireAuth);

const MAX_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
]);

const createSchema = z.object({
  notaId: z.string().uuid(),
  nombreOriginal: z.string().trim().min(1).max(255),
  mimeType: z.string().refine((m) => ALLOWED_MIME.has(m), 'Tipo de imagen no soportado'),
  tamano: z
    .number()
    .int()
    .positive()
    .max(MAX_BYTES, 'La imagen supera el tamaño máximo (20MB)'),
});

/** Deja solo caracteres seguros para una clave de objeto S3/R2. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
}

// POST /api/attachments  → registra el adjunto y devuelve una URL firmada para subir
// el binario directamente a R2 desde el navegador.
router.post(
  '/',
  ah(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    const { notaId, nombreOriginal, mimeType, tamano } = parsed.data;

    const { rows: notas } = await query('SELECT id FROM notas WHERE id = $1', [notaId]);
    if (notas.length === 0) {
      res.status(404).json({ error: 'Nota no encontrada' });
      return;
    }

    const id = randomUUID();
    const key = `imagenes/${id}-${sanitizeFilename(nombreOriginal)}`;

    await query(
      `INSERT INTO adjuntos (id, nota_id, tipo, url, nombre_original, mime_type, tamano_bytes)
       VALUES ($1, $2, 'imagen', $3, $4, $5, $6)`,
      [id, notaId, key, nombreOriginal, mimeType, tamano],
    );

    const uploadUrl = await presignUpload(key, mimeType);
    res.status(201).json({ id, uploadUrl });
  }),
);

// GET /api/attachments/:id  → redirige a una URL firmada de lectura de corta duración.
router.get(
  '/:id',
  ah(async (req, res) => {
    const { rows } = await query<{ url: string }>('SELECT url FROM adjuntos WHERE id = $1', [
      req.params.id,
    ]);
    const adjunto = rows[0];
    if (!adjunto) {
      res.status(404).json({ error: 'Adjunto no encontrado' });
      return;
    }
    const signedUrl = await presignDownload(adjunto.url);
    res.set('Cache-Control', 'private, max-age=250');
    res.redirect(302, signedUrl);
  }),
);

export default router;
