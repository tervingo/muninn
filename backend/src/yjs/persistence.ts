import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { query } from '../db.js';
import { syncEnlaces } from '../lib/wikilinks.js';
import type { DocNode } from '../types.js';

// El fragmento XML que usa la extensión Collaboration de TipTap por defecto.
const FRAGMENT = 'default';

/** Carga el estado binario Yjs persistido de una nota, o null si no hay. */
export async function loadYjsState(noteId: string): Promise<Uint8Array | null> {
  const { rows } = await query<{ yjs_state: Buffer | null }>(
    'SELECT yjs_state FROM notas WHERE id = $1',
    [noteId],
  );
  const state = rows[0]?.yjs_state;
  return state ? new Uint8Array(state) : null;
}

/**
 * Persiste el documento Yjs de una nota:
 *  - yjs_state ← estado binario (fuente de verdad),
 *  - contenido ← proyección JSON ProseMirror derivada del propio Yjs,
 *  - recalcula los enlaces (backlinks) desde esa proyección.
 * No crea la nota: si no existe (id desconocido), no hace nada.
 */
export async function persistDoc(noteId: string, ydoc: Y.Doc): Promise<void> {
  const update = Y.encodeStateAsUpdate(ydoc);
  const contenido = yDocToProsemirrorJSON(ydoc, FRAGMENT) as DocNode;

  const { rowCount } = await query(
    `UPDATE notas SET yjs_state = $1, contenido = $2, actualizado_en = now() WHERE id = $3`,
    [Buffer.from(update), contenido, noteId],
  );

  if (rowCount && rowCount > 0) {
    await syncEnlaces(noteId, contenido);
  }
}
