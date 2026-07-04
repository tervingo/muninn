import { Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { buildWikilinkSuggestion } from './wikilinkSuggestion';
import type { SuggestionItem } from './SuggestionList';

export interface WikiLinkOptions {
  /** Devuelve los títulos de notas existentes, para el autocompletado. */
  getTitles: () => string[];
}

export const WikiLinkPluginKey = new PluginKey('wikilink');

/**
 * Nodo inline atómico que representa un enlace `[[Título]]` a otra nota.
 * Guarda el título destino en `attrs.target`. Se renderiza como un <span>
 * con `data-wikilink`, sobre el que el editor detecta clicks para navegar.
 */
export const WikiLink = Node.create<WikiLinkOptions>({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addOptions() {
    return {
      getTitles: () => [],
    };
  },

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-wikilink') ?? '',
        renderHTML: (attrs) => ({ 'data-wikilink': attrs.target as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ class: 'wikilink' }, HTMLAttributes),
      `[[${node.attrs.target}]]`,
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.target}]]`;
  },

  addProseMirrorPlugins() {
    const nodeName = this.name;
    return [
      Suggestion<SuggestionItem>({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        pluginKey: WikiLinkPluginKey,
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: nodeName, attrs: { target: props.target } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        ...buildWikilinkSuggestion(this.options.getTitles),
      }),
    ];
  },
});
