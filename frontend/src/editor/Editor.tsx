import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef } from 'react';
import { WikiLink } from './WikiLinkNode';
import type { NoteContent } from '../types';

interface Props {
  /** Documento inicial. Sólo se aplica cuando cambia `noteId`. */
  content: NoteContent;
  /** Identificador de la nota actual (para recargar el editor al cambiar de nota). */
  noteId: string;
  /** Títulos de notas para el autocompletado de wikilinks. */
  titles: string[];
  onChange: (doc: NoteContent) => void;
  onNavigateWikilink: (target: string) => void;
}

export function Editor({ content, noteId, titles, onChange, onNavigateWikilink }: Props) {
  // Ref con los títulos, para que el autocompletado siempre lea la lista actual.
  const titlesRef = useRef(titles);
  titlesRef.current = titles;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Escribe algo… usa [[ para enlazar notas' }),
      WikiLink.configure({ getTitles: () => titlesRef.current }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getJSON() as NoteContent),
  });

  // Al cambiar de nota, reemplaza el contenido sin emitir onChange.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(content, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editor]);

  // Navegación al hacer click sobre un wikilink.
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
