import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import Image from '@tiptap/extension-image';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useEffect, useRef, useState } from 'react';
import { WikiLink } from './WikiLinkNode';
import { MuninnLink } from './link';
import { WS_BASE } from '../config';
import { isImageFile, uploadImage } from '../attachments';
import type { NoteContent, WsStatus } from '../types';

interface Props {
  /** Documento inicial (proyección JSON). Se usa para sembrar la sala Yjs si está vacía. */
  content: NoteContent;
  /** Identificador de la nota actual (= sala Yjs). */
  noteId: string;
  /** Títulos de notas para el autocompletado de wikilinks. */
  titles: string[];
  onChange: (doc: NoteContent) => void;
  onNavigateWikilink: (target: string) => void;
  /** Notifica el estado de la conexión de sincronización. */
  onStatus?: (status: WsStatus) => void;
}

interface Conn {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
}

function docTieneContenido(doc: NoteContent | undefined): boolean {
  if (!doc?.content) return false;
  // Un doc "vacío" es un único párrafo sin texto.
  return doc.content.some((n) => n.type !== 'paragraph' || (n.content?.length ?? 0) > 0);
}

/**
 * Crea el Y.Doc + provider WebSocket en un efecto (no en useMemo): así, con el doble
 * montaje de StrictMode, la limpieza destruye el provider y el re-montaje crea uno nuevo,
 * en lugar de reutilizar uno ya destruido (que dejaría la conexión muerta).
 */
export function Editor(props: Props) {
  const [conn, setConn] = useState<Conn | null>(null);

  const onStatus = props.onStatus;
  useEffect(() => {
    onStatus?.('connecting');
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(`${WS_BASE}/yjs`, props.noteId, ydoc, { connect: true });
    const handleStatus = (e: { status: WsStatus }) => onStatus?.(e.status);
    provider.on('status', handleStatus);
    setConn({ ydoc, provider });
    return () => {
      provider.off('status', handleStatus);
      provider.destroy();
      ydoc.destroy();
      setConn(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.noteId]);

  if (!conn) return <div className="editor" />;
  // key={noteId}: el editor interno se reinicia limpio al cambiar de nota.
  return <CollabEditor key={props.noteId} conn={conn} {...props} />;
}

function CollabEditor({
  conn,
  content,
  noteId,
  titles,
  onChange,
  onNavigateWikilink,
}: Props & { conn: Conn }) {
  const titlesRef = useRef(titles);
  titlesRef.current = titles;
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      // Yjs gestiona el historial; desactivamos el de StarterKit para evitar conflictos.
      StarterKit.configure({ history: false }),
      Placeholder.configure({ placeholder: 'Escribe algo… usa [[ para enlazar notas' }),
      Collaboration.configure({ document: conn.ydoc }),
      MuninnLink,
      WikiLink.configure({ getTitles: () => titlesRef.current }),
      Image.configure({ inline: false }),
    ],
    editorProps: {
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((file) => void insertUploadedImage(file));
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile);
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((file) => void insertUploadedImage(file));
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as NoteContent),
  });

  // Siembra la sala desde la proyección JSON sólo si, tras sincronizar, sigue vacía.
  // (La persistencia autoritativa llega en la Tarea 3, en el servidor.)
  useEffect(() => {
    if (!editor) return;
    const seedIfEmpty = () => {
      if (editor.isEmpty && docTieneContenido(content)) {
        editor.commands.setContent(content, true);
      }
    };
    const onSync = (isSynced: boolean) => {
      if (isSynced) seedIfEmpty();
    };
    conn.provider.on('sync', onSync);
    if (conn.provider.synced) seedIfEmpty();
    return () => conn.provider.off('sync', onSync);
  }, [editor, conn, content]);

  // Sube la imagen y la inserta en la posición actual del cursor al terminar. No se usa
  // una vista previa optimista (blob: local): si se sincronizara vía Yjs antes de la subida,
  // esa URL no tendría sentido en otro dispositivo conectado.
  const insertUploadedImage = async (file: File) => {
    if (!editor) return;
    setUploading((n) => n + 1);
    try {
      const src = await uploadImage(noteId, file);
      editor.chain().focus().setImage({ src, alt: file.name }).run();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error subiendo la imagen.');
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-wikilink]');
    if (el) {
      e.preventDefault();
      const target = el.getAttribute('data-wikilink');
      if (target) onNavigateWikilink(target);
    }
  };

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <button
          type="button"
          className="icon-btn"
          title="Insertar imagen"
          onClick={() => fileInputRef.current?.click()}
        >
          🖼️
        </button>
        {uploading > 0 && <span className="muted">Subiendo imagen…</span>}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void insertUploadedImage(file);
          }}
        />
      </div>
      <div onClick={handleClick}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
