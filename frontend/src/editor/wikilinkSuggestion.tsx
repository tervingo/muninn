import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { SuggestionList, type SuggestionListRef, type SuggestionItem } from './SuggestionList';

/**
 * Construye la configuración de `suggestion` para el nodo wikilink.
 * @param getTitles devuelve los títulos de notas existentes (para filtrar/autocompletar).
 */
export function buildWikilinkSuggestion(
  getTitles: () => string[],
): Omit<SuggestionOptions<SuggestionItem>, 'editor'> {
  return {
    items: ({ query }): SuggestionItem[] => {
      const q = query.trim();
      const titles = getTitles();
      const matches = titles
        .filter((t) => t.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 8)
        .map((t) => ({ target: t, isNew: false }));

      // Opción de crear una nota nueva si el texto no coincide exactamente con una existente.
      const exact = titles.some((t) => t.toLowerCase() === q.toLowerCase());
      if (q && !exact) {
        matches.push({ target: q, isNew: true });
      }
      return matches;
    },

    render: () => {
      let component: ReactRenderer<SuggestionListRef> | null = null;
      let popup: TippyInstance[] = [];

      return {
        onStart: (props: SuggestionProps<SuggestionItem>) => {
          component = new ReactRenderer(SuggestionList, {
            props,
            editor: props.editor,
          });
          if (!props.clientRect) return;
          popup = tippy('body', {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          });
        },

        onUpdate: (props: SuggestionProps<SuggestionItem>) => {
          component?.updateProps(props);
          if (props.clientRect) {
            popup[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
          }
        },

        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === 'Escape') {
            popup[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },

        onExit: () => {
          popup[0]?.destroy();
          component?.destroy();
        },
      };
    },
  };
}
