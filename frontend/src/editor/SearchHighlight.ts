import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchState {
  term: string;
  results: SearchMatch[];
  /** -1 = ninguna coincidencia activa (término vacío o sin resultados). */
  index: number;
}

export const SearchPluginKey = new PluginKey<SearchState>('search');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatches(doc: ProseMirrorNode, term: string): SearchMatch[] {
  if (!term.trim()) return [];
  const re = new RegExp(escapeRegExp(term), 'gi');
  const results: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(node.text))) {
      results.push({ from: pos + match.index, to: pos + match.index + match[0].length });
    }
  });
  return results;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      /** Busca `term` en el documento y resalta todas las coincidencias (vacío = quita el resaltado). */
      setSearchTerm: (term: string) => ReturnType;
      /** Mueve el foco a la siguiente coincidencia (cíclico). */
      searchNext: () => ReturnType;
      /** Mueve el foco a la coincidencia anterior (cíclico). */
      searchPrev: () => ReturnType;
      /** Quita el resaltado y limpia el estado de búsqueda. */
      clearSearch: () => ReturnType;
    };
  }
}

/**
 * Busca texto dentro de la nota y resalta las coincidencias con decoraciones (no toca el
 * documento ni genera un update de Yjs — es puramente visual, vive en el estado del plugin).
 */
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: SearchPluginKey,
        state: {
          init: () => ({ term: '', results: [], index: -1 }),
          apply(tr, prev) {
            const meta = tr.getMeta(SearchPluginKey) as SearchState | undefined;
            if (meta) return meta;
            // Si el doc cambia mientras hay una búsqueda activa (edición propia o remota vía
            // Yjs), recalculamos las posiciones en vez de dejar decoraciones desalineadas.
            if (tr.docChanged && prev.term) {
              const results = findMatches(tr.doc, prev.term);
              return {
                term: prev.term,
                results,
                index: results.length ? Math.min(prev.index, results.length - 1) : -1,
              };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const s = SearchPluginKey.getState(state);
            if (!s || s.results.length === 0) return null;
            const decorations = s.results.map((r, i) =>
              Decoration.inline(r.from, r.to, {
                class: i === s.index ? 'search-match search-match-active' : 'search-match',
              }),
            );
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string) =>
        ({ tr, dispatch, state }) => {
          const results = findMatches(state.doc, term);
          if (dispatch) {
            dispatch(tr.setMeta(SearchPluginKey, { term, results, index: results.length ? 0 : -1 }));
          }
          return true;
        },
      searchNext:
        () =>
        ({ tr, dispatch, state }) => {
          const s = SearchPluginKey.getState(state);
          if (!s || s.results.length === 0) return false;
          const index = (s.index + 1) % s.results.length;
          if (dispatch) dispatch(tr.setMeta(SearchPluginKey, { ...s, index }));
          return true;
        },
      searchPrev:
        () =>
        ({ tr, dispatch, state }) => {
          const s = SearchPluginKey.getState(state);
          if (!s || s.results.length === 0) return false;
          const index = (s.index - 1 + s.results.length) % s.results.length;
          if (dispatch) dispatch(tr.setMeta(SearchPluginKey, { ...s, index }));
          return true;
        },
      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(SearchPluginKey, { term: '', results: [], index: -1 }));
          return true;
        },
    };
  },
});
