import Link from '@tiptap/extension-link';

/**
 * Enlaces externos:
 *  - autolink: al escribir una URL se convierte en enlace,
 *  - linkOnPaste: al pegar una URL sobre texto seleccionado, lo enlaza,
 *  - openOnClick: al hacer click se abre en una pestaña nueva,
 *  - Mod-K: pide una URL y enlaza la selección (vacío = quitar el enlace).
 */
export const MuninnLink = Link.extend({
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const previa = this.editor.getAttributes('link').href as string | undefined;
        const url = window.prompt('URL del enlace (vacío para quitarlo):', previa ?? 'https://');
        if (url === null) return true; // cancelado
        if (url.trim() === '') {
          return this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
        }
        return this.editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href: url.trim() })
          .run();
      },
    };
  },
}).configure({
  openOnClick: true,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: {
    target: '_blank',
    rel: 'noopener noreferrer nofollow',
  },
});
