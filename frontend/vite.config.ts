import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  // El proyecto vive dentro de Dropbox, que bloquea el `rename` de node_modules/.vite
  // durante la optimización de dependencias (errores EBUSY / respuestas 504). Movemos
  // la caché de Vite fuera de la carpeta sincronizada para evitarlo.
  cacheDir: path.join(os.tmpdir(), 'muninn-vite-cache'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Muninn — Notas',
        short_name: 'Muninn',
        description: 'Notas personales tipo Obsidian con enlaces y backlinks.',
        theme_color: '#1e1e2e',
        background_color: '#1e1e2e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Cachea las respuestas GET de la API para lectura offline (fase 1).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/notes'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'muninn-api-notes',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
