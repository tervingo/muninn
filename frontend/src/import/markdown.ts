import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { MuninnLink } from '../editor/link';
import type { DocNode, NoteContent } from '../types';

// Editor "headless" reutilizable para convertir Markdown → JSON ProseMirror.
// Usa el mismo esquema base que el editor real (StarterKit + enlaces + imagen), sin Yjs.
let editor: Editor | null = null;

function getEditor(): Editor {
  if (!editor) {
    editor = new Editor({
      extensions: [
        StarterKit,
        MuninnLink,
        Image.configure({ inline: false }),
        Markdown.configure({ html: false, linkify: true }),
      ],
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

// --- Embeds de imágenes (importación de Obsidian) ---
//
// El selector de carpeta trae también los bytes de las imágenes del vault, pero éstas no
// tienen aún una URL válida (viven como Blobs en el navegador). Antes de convertir el
// Markdown a JSON, reescribimos las referencias a imágenes locales reconocidas a un
// esquema temporal `EMBED_SCHEME<nombre>`, que luego el ImportDialog resuelve en una
// segunda pasada (tras crear la nota y subir cada imagen a R2).

export const EMBED_SCHEME = 'obsidian-embed:';

const OBSIDIAN_EMBED_RE = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function basename(pathLike: string): string {
  const clean = pathLike.split(/[?#]/)[0] ?? '';
  const parts = clean.split(/[/\\]/);
  try {
    return decodeURIComponent(parts[parts.length - 1] ?? '').trim();
  } catch {
    return (parts[parts.length - 1] ?? '').trim();
  }
}

/**
 * Reescribe referencias a imágenes locales —embeds `![[img.png]]` de Obsidian y markdown
 * estándar `![alt](ruta/img.png)`— a `EMBED_SCHEME<nombre>` cuando el nombre de archivo
 * (sin distinguir mayúsculas) está en `imageNames`. El resto del texto, incluidas las URLs
 * http(s) externas, no se toca.
 */
export function resolveImageEmbeds(md: string, imageNames: Set<string>): string {
  let out = md.replace(OBSIDIAN_EMBED_RE, (match, ref: string) => {
    const name = basename(ref.trim());
    if (!imageNames.has(name.toLowerCase())) return match;
    return `![${name}](${EMBED_SCHEME}${encodeURIComponent(name)})`;
  });
  out = out.replace(MD_IMAGE_RE, (match, alt: string, url: string) => {
    if (/^[a-z]+:\/\//i.test(url) || url.startsWith(EMBED_SCHEME)) return match;
    const name = basename(url);
    if (!imageNames.has(name.toLowerCase())) return match;
    return `![${alt || name}](${EMBED_SCHEME}${encodeURIComponent(name)})`;
  });
  return out;
}

function walkImageSrcs(node: DocNode, visit: (src: string) => void): void {
  if (node.type === 'image' && typeof node.attrs?.src === 'string') visit(node.attrs.src);
  node.content?.forEach((child) => walkImageSrcs(child, visit));
}

/** Nombres (decodificados) de las imágenes aún pendientes de resolver en un documento. */
export function collectPendingImageEmbeds(doc: NoteContent): string[] {
  const names = new Set<string>();
  walkImageSrcs(doc, (src) => {
    if (src.startsWith(EMBED_SCHEME)) names.add(decodeURIComponent(src.slice(EMBED_SCHEME.length)));
  });
  return [...names];
}

/** Sustituye las referencias `EMBED_SCHEME<nombre>` por las URLs reales ya subidas. */
export function resolveImageEmbedRefs(doc: NoteContent, urlByName: Map<string, string>): NoteContent {
  function walk(node: DocNode): DocNode {
    if (node.type === 'image' && typeof node.attrs?.src === 'string' && node.attrs.src.startsWith(EMBED_SCHEME)) {
      const name = decodeURIComponent(node.attrs.src.slice(EMBED_SCHEME.length));
      const url = urlByName.get(name);
      if (url) return { ...node, attrs: { ...node.attrs, src: url } };
    }
    if (node.content) return { ...node, content: node.content.map(walk) };
    return node;
  }
  return walk(doc);
}
