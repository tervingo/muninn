/**
 * Tipos y contratos compartidos entre frontend y backend.
 * Reflejan el modelo de datos definido en SPEC.md (§4).
 */

/** Documento del editor (TipTap/ProseMirror) serializado como JSON. */
export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export type NoteContent = DocNode;

/** Una nota tal como la devuelve la API. */
export interface Note {
  id: string;
  titulo: string;
  contenido: NoteContent;
  creado_en: string; // ISO 8601
  actualizado_en: string; // ISO 8601
  archivada: boolean;
}

/** Resumen de nota para listados (sin el cuerpo completo). */
export interface NoteSummary {
  id: string;
  titulo: string;
  actualizado_en: string;
  archivada: boolean;
}

/** Payload para crear una nota. */
export interface CreateNoteInput {
  titulo: string;
  contenido?: NoteContent;
}

/** Payload para actualizar una nota (campos parciales). */
export interface UpdateNoteInput {
  titulo?: string;
  contenido?: NoteContent;
  archivada?: boolean;
}

/** Un backlink: nota que enlaza a la nota consultada. */
export interface Backlink {
  id: string;
  titulo: string;
}

/** Documento TipTap vacío por defecto. */
export const EMPTY_DOC: NoteContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/** Respuesta genérica de error de la API. */
export interface ApiError {
  error: string;
}

/** Estado de autenticación devuelto por el backend. */
export interface AuthStatus {
  authenticated: boolean;
  /** Indica si ya existe una passkey registrada (para decidir registro vs login). */
  hasCredential: boolean;
}
