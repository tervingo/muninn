import { DROPBOX_APP_KEY } from './config';

// Dropbox Chooser: widget cliente-only (sin OAuth) para elegir un archivo de la cuenta
// Dropbox del usuario y obtener un enlace para compartir. Doc: https://www.dropbox.com/developers/chooser
const DROPINS_SRC = 'https://www.dropbox.com/static/api/2/dropins.js';

interface DropboxChosenFile {
  id: string;
  name: string;
  link: string;
  bytes: number;
  icon: string;
  thumbnailLink?: string;
  isDir: boolean;
}

interface DropboxChooseOptions {
  success: (files: DropboxChosenFile[]) => void;
  cancel?: () => void;
  linkType?: 'preview' | 'direct';
  multiselect?: boolean;
  extensions?: string[];
  folderselect?: boolean;
}

declare global {
  interface Window {
    Dropbox?: {
      choose: (options: DropboxChooseOptions) => void;
    };
  }
}

let dropinsPromise: Promise<void> | null = null;

function loadDropinsScript(): Promise<void> {
  if (window.Dropbox) return Promise.resolve();
  if (dropinsPromise) return dropinsPromise;

  dropinsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = DROPINS_SRC;
    script.id = 'dropboxjs';
    script.dataset.appKey = DROPBOX_APP_KEY;
    script.onload = () => resolve();
    script.onerror = () => {
      dropinsPromise = null;
      reject(new Error('No se pudo cargar el selector de Dropbox.'));
    };
    document.body.appendChild(script);
  });
  return dropinsPromise;
}

/**
 * Abre el selector de archivos de Dropbox y resuelve con el archivo elegido (enlace tipo
 * "preview", el mismo que da "Copiar enlace" en Dropbox — no expira como los "direct").
 * Devuelve `null` si el usuario cancela.
 */
export async function chooseDropboxFile(): Promise<{ name: string; link: string } | null> {
  if (!DROPBOX_APP_KEY) {
    throw new Error(
      'Falta configurar VITE_DROPBOX_APP_KEY (app key del Dropbox Chooser) para poder adjuntar archivos.',
    );
  }
  await loadDropinsScript();
  const dropbox = window.Dropbox;
  if (!dropbox) throw new Error('El selector de Dropbox no está disponible.');

  return new Promise((resolve) => {
    dropbox.choose({
      linkType: 'preview',
      multiselect: false,
      success: (files) => {
        const file = files[0];
        resolve(file ? { name: file.name, link: file.link } : null);
      },
      cancel: () => resolve(null),
    });
  });
}
