import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { MuninnLink } from '../editor/link';
import type { NoteContent } from '../types';

// Editor "headless" reutilizable para convertir Markdown → JSON ProseMirror.
// Usa el mismo esquema base que el editor real (StarterKit + enlaces), sin Yjs.
let editor: Editor | null = null;

function getEditor(): Editor {
  if (!editor) {
    editor = new Editor({
      extensions: [StarterKit, MuninnLink, Markdown.configure({ html: false, linkify: true })],
    });
  }
  return editor;
}

/** Convierte texto Markdown en un documento (JSON ProseMirror) compatible con el editor. */
export function markdownToDoc(md: string): NoteContent {
  const ed = getEditor();
  ed.commands.setContent(md); // tiptap-markdown parsea la cadena como Markdown
  return ed.getJSON() as NoteContent;
}

/** Quita el frontmatter YAML (bloque --- ... ---) del inicio, si lo hay. */
export function stripFrontmatter(md: string): string {
  return md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** Normaliza una etiqueta igual que el backend/TagEditor. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

export function disposeMarkdownEditor(): void {
  editor?.destroy();
  editor = null;
}
