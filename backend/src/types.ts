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
  tags: string[];
}

export interface NoteSummary {
  id: string;
  titulo: string;
  actualizado_en: string;
  archivada: boolean;
  tags: string[];
}

/** Una etiqueta con el número de notas que la usan. */
export interface TagCount {
  tag: string;
  count: number;
}

export interface Backlink {
  id: string;
  titulo: string;
}

/** Nota relacionada por similitud semántica (T6.2). `distancia` es la distancia
 * coseno del embedding (0 = idéntico, valores más altos = menos parecido). */
export interface RelatedNote {
  id: string;
  titulo: string;
  distancia: number;
}

export const EMPTY_DOC: NoteContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};
