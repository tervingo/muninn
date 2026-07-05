/** Tipos del dominio (alineados con `shared/src/index.ts`). */

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

export interface AuthStatus {
  authenticated: boolean;
  hasCredential: boolean;
  /** Hay una ventana de alta abierta: un dispositivo nuevo puede registrar su passkey. */
  enrollOpen: boolean;
}

export interface PasskeyDevice {
  id: string;
  transports: string | null;
  creado_en: string;
}

export const EMPTY_DOC: NoteContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/** Estado de la conexión WebSocket de sincronización. */
export type WsStatus = 'connecting' | 'connected' | 'disconnected';
