import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useEffect, useRef, useState } from 'react';
import { WikiLink } from './WikiLinkNode';
import { WS_BASE } from '../config';
import type { NoteContent } from '../types';

interface Props {
  /** Documento inicial (proyección JSON). Se usa para sembrar la sala Yjs si está vacía. */
  content: NoteContent;
  /** Identificador de la nota actual (= sala Yjs). */
  noteId: string;
  /** Títulos de notas para el autocompletado de wikilinks. */
  titles: string[];
  onChange: (doc: NoteContent) => void;
  onNavigateWikilink: (target: string) => void;
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

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(`${WS_BASE}/yjs`, props.noteId, ydoc, { connect: true });
    setConn({ ydoc, provider });
    return () => {
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
  titles,
  onChange,
  onNavigateWikilink,
}: Props & { conn: Conn }) {
  const titlesRef = useRef(titles);
  titlesRef.current = titles;

  const editor = useEditor({
    extensions: [
      // Yjs gestiona el historial; desactivamos el de StarterKit para evitar conflictos.
      StarterKit.configure({ history: false }),
      Placeholder.configure({ placeholder: 'Escribe algo… usa [[ para enlazar notas' }),
      Collaboration.configure({ document: conn.ydoc }),
      WikiLink.configure({ getTitles: () => titlesRef.current }),
    ],
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

  const handleClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-wikilink]');
    if (el) {
      e.preventDefault();
      const target = el.getAttribute('data-wikilink');
      if (target) onNavigateWikilink(target);
    }
  };

  return (
    <div className="editor" onClick={handleClick}>
      <EditorContent editor={editor} />
    </div>
  );
}
