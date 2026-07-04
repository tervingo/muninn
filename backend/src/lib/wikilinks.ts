import type { DocNode } from '../types.js';
import { query } from '../db.js';

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Extrae los títulos de nota referenciados en un documento TipTap.
 * Soporta dos formas:
 *  - nodos de tipo `wikilink` con `attrs.target` (forma canónica del editor)
 *  - texto plano `[[Título]]` en nodos de texto (por si se pega markdown)
 * Devuelve títulos únicos y normalizados (trim), preservando el texto original.
 */
export function extractWikilinkTitles(doc: DocNode | null | undefined): string[] {
  const titles = new Set<string>();

  function walk(node: DocNode | undefined): void {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'wikilink') {
      const target = (node.attrs?.target ?? node.attrs?.label) as string | undefined;
      if (target && target.trim()) titles.add(target.trim());
    }

    if (typeof node.text === 'string') {
      for (const match of node.text.matchAll(WIKILINK_RE)) {
        const t = match[1]?.trim();
        if (t) titles.add(t);
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  }

  walk(doc ?? undefined);
  return [...titles];
}

/**
 * Reconstruye la tabla `enlaces` para una nota origen a partir de su contenido.
 * Resuelve títulos → ids (case-insensitive) y sólo enlaza a notas existentes.
 * No crea notas destino automáticamente (los enlaces "rotos" simplemente no se guardan).
 */
export async function syncEnlaces(notaOrigenId: string, doc: DocNode): Promise<void> {
  const titles = extractWikilinkTitles(doc);

  // Borra los enlaces previos de esta nota (los recalculamos siempre desde cero).
  await query('DELETE FROM enlaces WHERE nota_origen_id = $1', [notaOrigenId]);

  if (titles.length === 0) return;

  // Resuelve títulos a ids existentes (case-insensitive), excluyendo la propia nota.
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM notas
     WHERE lower(titulo) = ANY($1::text[]) AND id <> $2`,
    [titles.map((t) => t.toLowerCase()), notaOrigenId],
  );

  for (const { id } of rows) {
    await query(
      `INSERT INTO enlaces (nota_origen_id, nota_destino_id)
       VALUES ($1, $2)
       ON CONFLICT (nota_origen_id, nota_destino_id) DO NOTHING`,
      [notaOrigenId, id],
    );
  }
}
