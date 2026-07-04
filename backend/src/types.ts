/**
 * Tipos del dominio, alineados con `shared/src/index.ts` (fuente de verdad del contrato).
 * Se mantienen aquí para que el backend sea autocontenido y desplegable de forma
 * independiente (Render) sin acoplar el build al paquete compartido.
 */

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export type NoteContent = DocNode;

export interface Note {
  id: string;
  titulo: string;
  contenido: NoteContent;
  creado_en: string;
  actualizado_en: string;
  archivada: boolean;
}

export interface NoteSummary {
  id: string;
  titulo: string;
  actualizado_en: string;
  archivada: boolean;
}

export interface Backlink {
  id: string;
  titulo: string;
}

export const EMPTY_DOC: NoteContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};
