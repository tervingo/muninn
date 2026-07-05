// Base del WebSocket de sincronización Yjs.
// En producción se conecta DIRECTAMENTE al backend de Render (el proxy /api de Netlify
// no reenvía WebSockets de forma fiable). En dev, al backend local.
// Se puede sobreescribir con VITE_WS_URL.
export const WS_BASE: string =
  import.meta.env.VITE_WS_URL ??
  (import.meta.env.DEV ? 'ws://localhost:3000' : 'wss://muninn-backend.onrender.com');
