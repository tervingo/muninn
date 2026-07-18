import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useEffect, useRef, useState } from 'react';
import { WikiLink } from './WikiLinkNode';
import { MuninnLink } from './link';
import { WS_BASE } from '../config';
import { isImageFile, uploadImage } from '../attachments';
import { api } from '../api';
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
  idb: IndexeddbPersistence;
  /** null hasta que se resuelve el ticket y conecta el WS (o si no hay red: T4 no bloquea en eso). */
  provider: WebsocketProvider | null;
}

function docTieneContenido(doc: NoteContent | undefined): boolean {
  if (!doc?.content) return false;
  // Un doc "vacío" es un único párrafo sin texto.
  return doc.content.some((n) => n.type !== 'paragraph' || (n.content?.length ?? 0) > 0);
}

/**
 * Crea el Y.Doc + persistencia local (IndexedDB, T4) + provider WebSocket en un efecto (no
 * en useMemo): así, con el doble montaje de StrictMode, la limpieza destruye todo y el
 * re-montaje crea instancias nuevas, en lugar de reutilizar unas ya destruidas.
 */
export function Editor(props: Props) {
  const [conn, setConn] = useState<Conn | null>(null);

  const onStatus = props.onStatus;
  useEffect(() => {
    let cancelled = false;
    let provider: WebsocketProvider | null = null;
    let handleStatus: ((e: { status: WsStatus }) => void) | null = null;
    onStatus?.('connecting');
    const ydoc = new Y.Doc();
    const idb = new IndexeddbPersistence(`muninn-${props.noteId}`, ydoc);

    // En cuanto carga lo que hubiera en IndexedDB (offline-first, T4) montamos ya el editor,
    // sin esperar a la red: así el contenido guardado localmente no se pierde ni bloquea la
    // UI si no hay conexión o el ticket tarda/falla. Si el WS ya hubiera conectado primero
    // (raro, pero posible), no lo pisamos — por eso el updater funcional con `??`.
    idb.on('synced', () => {
      if (!cancelled) setConn((prev) => prev ?? { ydoc, idb, provider: null });
    });

    // El ticket se pide por REST (autenticado con la cookie de sesión normal) porque el
    // WS de producción conecta directo a Render, sin pasar por el proxy de Netlify que
    // hace esa cookie first-party — ver mintWsTicket en el backend.
    const connectWs = async () => {
      if (cancelled || provider) return;
      let ticket: string;
      try {
        ({ ticket } = await api.getWsTicket());
      } catch (err) {
        console.error('No se pudo obtener el ticket de conexión (offline: solo copia local):', err);
        if (!cancelled) onStatus?.('disconnected');
        return;
      }
      if (cancelled || provider) return;
      provider = new WebsocketProvider(`${WS_BASE}/yjs`, props.noteId, ydoc, {
        connect: true,
        params: { ticket },
      });
      handleStatus = (e) => onStatus?.(e.status);
      provider.on('status', handleStatus);
      setConn({ ydoc, idb, provider });
    };
    void connectWs();

    // Si el ticket falló por estar offline, `y-websocket` nunca llega a existir y por tanto
    // no hay nada reintentando la conexión — sin esto, la nota se quedaría en modo "solo
    // local" hasta recargar la página aunque vuelva la red (T4 pide que fusione al reconectar
    // sin ese paso manual).
    const onOnline = () => void connectWs();
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      if (provider && handleStatus) provider.off('status', handleStatus);
      provider?.destroy();
      idb.destroy();
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
      // Sin `resizable`: el plugin de columnResizing de Table mantiene su propio
      // estado en un plugin de ProseMirror aparte, y colisiona con Yjs/Collaboration.
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
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
  // (La persistencia autoritativa llega en la Tarea 3, en el servidor.) Dos fuentes posibles
  // de "ya sincronizado" desde T4: IndexedDB (local, offline-first) y el WS (servidor) — la
  // que llegue primero decide; `editor.isEmpty` evita sembrar dos veces o pisar contenido real.
  useEffect(() => {
    if (!editor) return;
    const seedIfEmpty = () => {
      if (editor.isEmpty && docTieneContenido(content)) {
        editor.commands.setContent(content, true);
      }
    };
    const onIdbSynced = () => seedIfEmpty();
    const onWsSync = (isSynced: boolean) => {
      if (isSynced) seedIfEmpty();
    };
    conn.idb.on('synced', onIdbSynced);
    if (conn.idb.synced) seedIfEmpty();
    conn.provider?.on('sync', onWsSync);
    if (conn.provider?.synced) seedIfEmpty();
    return () => {
      conn.idb.off('synced', onIdbSynced);
      conn.provider?.off('sync', onWsSync);
    };
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
