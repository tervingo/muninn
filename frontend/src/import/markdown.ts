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

/** Trocea una ruta en sus segmentos, decodificando cada uno (tolerante a `%xx` inválido). */
function splitPathSegments(pathLike: string): string[] {
  const clean = pathLike.split(/[?#]/)[0] ?? '';
  return clean.split(/[/\\]/).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
}

function basename(pathLike: string): string {
  const parts = splitPathSegments(pathLike);
  return (parts[parts.length - 1] ?? '').trim();
}

/**
 * Resuelve una ruta relativa (con `.`/`..`) contra la carpeta de la nota que la referencia,
 * dentro del vault seleccionado. P. ej. `resolveRelativePath('cymraeg', './_resources/a.png')`
 * → `cymraeg/_resources/a.png`.
 */
function resolveRelativePath(noteDir: string, ref: string): string {
  const stack = noteDir ? noteDir.split('/') : [];
  for (const raw of splitPathSegments(ref)) {
    const seg = raw.trim();
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.join('/');
}

/**
 * Reescribe referencias a imágenes locales —embeds `![[img.png]]` de Obsidian y markdown
 * estándar `![alt](ruta/img.png)`— a `EMBED_SCHEME<clave>` cuando se reconoce la imagen en
 * `imageKeys` (claves en minúsculas: ruta completa dentro del vault, y también nombre de
 * archivo solo). Si la referencia incluye una ruta (p. ej. `./_resources/Nota.resources/x.png`,
 * típico de vaults exportados de Evernote donde varias notas reusan el mismo nombre de archivo
 * en subcarpetas distintas) se resuelve esa ruta relativa a la carpeta de la nota y se empareja
 * por ruta completa primero, para no confundir imágenes homónimas de notas distintas; si no hay
 * ruta o no se encuentra, cae de vuelta al nombre de archivo solo (comportamiento previo). El
 * resto del texto, incluidas las URLs http(s) externas, no se toca.
 */
export function resolveImageEmbeds(md: string, noteDir: string, imageKeys: Set<string>): string {
  function resolveKey(ref: string): string | null {
    const trimmed = ref.trim();
    if (/[/\\]/.test(trimmed)) {
      const fullPath = resolveRelativePath(noteDir, trimmed).toLowerCase();
      if (imageKeys.has(fullPath)) return fullPath;
    }
    const name = basename(trimmed).toLowerCase();
    return imageKeys.has(name) ? name : null;
  }

  let out = md.replace(OBSIDIAN_EMBED_RE, (match, ref: string) => {
    const key = resolveKey(ref);
    if (!key) return match;
    return `![${basename(ref)}](${EMBED_SCHEME}${encodeURIComponent(key)})`;
  });
  out = out.replace(MD_IMAGE_RE, (match, alt: string, url: string) => {
    if (/^[a-z]+:\/\//i.test(url) || url.startsWith(EMBED_SCHEME)) return match;
    const key = resolveKey(url);
    if (!key) return match;
    return `![${alt || basename(url)}](${EMBED_SCHEME}${encodeURIComponent(key)})`;
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
