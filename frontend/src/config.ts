// Base del WebSocket de sincronización Yjs.
// En producción se conecta DIRECTAMENTE al backend de Render (el proxy /api de Netlify
// no reenvía WebSockets de forma fiable). En dev, al backend local.
// Se puede sobreescribir con VITE_WS_URL.
export const WS_BASE: string =
  import.meta.env.VITE_WS_URL ??
  (import.meta.env.DEV ? 'ws://localhost:3000' : 'wss://muninn-backend.onrender.com');

// App key del Dropbox Chooser (panel de desarrolladores de Dropbox, no es secreta: se
// expone en el cliente por diseño). Sin ella, el botón "Adjuntar de Dropbox" se deshabilita.
export const DROPBOX_APP_KEY: string = import.meta.env.VITE_DROPBOX_APP_KEY ?? '';
