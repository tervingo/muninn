---
name: muninn-project
description: "Muninn — app de notas single-user tipo Obsidian; estado completo, arquitectura, despliegue y trabajo pendiente"
metadata: 
  node_type: memory
  type: project
  originSessionId: bfa894af-6fa5-4619-a5fa-b2837a5f9d99
---

# Muninn — estado del proyecto

App de notas personal **single-user** (dueño: Juan A. Alonso), tipo Obsidian.
Dir: `c:\Users\j4alo\Dropbox\Eltomalturta\muninn`. Repo: https://github.com/tervingo/muninn.git (rama `main`).
Ver `SPEC.md` en el repo para la especificación original por fases (documento de partida, no rastrea
progreso — este documento sí).

## Stack y estructura
Monorepo, cada lado autocontenido y desplegable por separado:
- `backend/` — Node.js + Express + TypeScript (ESM, tsx/tsc). Postgres (Neon, `pg`).
  WebAuthn (`@simplewebauthn/server`). WebSocket Yjs (`ws` + `yjs` + `y-protocols` + `y-prosemirror`).
- `frontend/` — React + Vite + TypeScript, editor TipTap, PWA (`vite-plugin-pwa`).
- `shared/` — solo referencia de tipos (no se importa en runtime; cada lado replica sus tipos).

## Despliegue (EN PRODUCCIÓN)
- Frontend: **https://muninn-huginn.netlify.app** (Netlify; `muninn.netlify.app` estaba pillado).
- Backend: **https://muninn-backend.onrender.com** (Render, plan **Starter** always-on, sin cold start).
- BD: **Neon**, dos branches: `production` (Render) y `dev` (local, en `backend/.env`).
- Netlify proxya `/api/*` → Render vía `frontend/public/_redirects` (la regla `/api/*` DEBE ir
  antes del catch-all SPA `/*`). Cookies first-party → funciona en Safari iOS.
- El cliente REST usa rutas relativas en prod y `http://localhost:3000` en dev
  (`frontend/src/api.ts`). El **WebSocket** NO pasa por el proxy: conecta directo a Render
  (`wss://muninn-backend.onrender.com`) en prod y `ws://localhost:3000` en dev (`frontend/src/config.ts`).
- Render build: `npm install --include=dev && npm run build` (NODE_ENV=production omitía @types/typescript).
- Env en Render: `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN`/`FRONTEND_URL` = dominio de Netlify; `COOKIE_SECURE=true`;
  `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY` (Fase 6). `VITE_DROPBOX_APP_KEY` va en Netlify (build var, frontend).
- Migraciones: `npm run migrate` (aplica `backend/src/schema.sql`, idempotente). Ejecutar en dev Y prod
  al cambiar el esquema (con `DATABASE_URL` de prod inline, nunca persistido a disco).

## Autenticación
Passkey WebAuthn, single-user. Sesión = JWT en cookie httpOnly (sobrevive cold starts).
Primera passkey = bootstrap (registro abierto). Passkeys adicionales (otros dispositivos)
requieren sesión activa O una **ventana de alta** de 10 min (`enrollment` tabla, `/api/auth/enroll/open`),
para dar de alta dispositivos de otro ecosistema (Windows Hello no sincroniza con Apple/iCloud).
Diálogo "Dispositivos" en la UI. No se puede borrar la última passkey.

## Modelo de sincronización
**Yjs es la fuente de verdad del documento**; `contenido` (JSON ProseMirror) es una proyección
derivada, de solo lectura para queries (backlinks, listados, embeddings). El editor NO guarda
`contenido` por REST; solo el **título** y las **etiquetas** van por REST.
- Servidor WS (`backend/src/yjs/`): relay por sala (`/yjs/<noteId>`), carga `yjs_state` al abrir,
  guarda `yjs_state` + `contenido` derivado (con `y-prosemirror`) con debounce 2.5s y al cerrarse
  la última conexión; recalcula backlinks al persistir. Docs en memoria; se liberan sin conexiones.
- Cliente (`frontend/src/editor/Editor.tsx`): `Y.Doc` + `IndexeddbPersistence` (T4) + `WebsocketProvider`
  creados en `useEffect` (no `useMemo`) por el doble montaje de StrictMode; editor interno keyed por
  nota. Vite `resolve.dedupe:['yjs']`.
- El WebSocket exige un ticket de sesión de corta vida (T5, ver más abajo) — no basta con conocer el
  `noteId`.
- Notas importadas/creadas por REST solo tienen `contenido`; al abrirlas el cliente siembra Yjs
  **solo cuando el WebSocket confirma que la sala está vacía en el servidor** (nunca por el estado de
  IndexedDB — ver el incidente de duplicación más abajo, causa raíz exacta de por qué esto importa).

## Funcionalidades implementadas
- **Fase 1**: CRUD notas, archivar, editor por bloques (StarterKit), `[[wikilinks]]` con autocompletado,
  backlinks, PWA instalable, auth passkey multi-dispositivo. Logo propio (iconos desde `public/muninn.png`,
  fondo transparente; script `frontend/scripts/generate-icons.ps1`).
- **Fase 2 (T1–T3)**: sync en vivo + persistencia dual (ver modelo de sincronización arriba). Enlaces
  externos (`@tiptap/extension-link`: autolink, link al pegar, abrir en pestaña nueva, Mod-K).
- **Etiquetas**: columna `tags TEXT[]` (índice GIN). Chips en la nota (añadir/quitar), filtro por
  etiqueta (AND) en la barra lateral con recuentos y botón "limpiar" (`tag-filter-clear`, mismo color
  de acento que los chips activos). `GET /api/notes/tags`, `?tags=a,b`. Metadatos REST.
  **Añadir/quitar en bloque**: `POST /api/notes/bulk-tag` {ids, tag, action: 'add'|'remove'} — un
  UPDATE masivo (`tags || $2`/`array_remove`), no un bucle por nota. Controles en el frontend tanto
  en la vista de filtro por etiqueta como en resultados de búsqueda semántica.
- **Importar de Obsidian** (`frontend/src/components/ImportDialog.tsx`, `src/import/markdown.ts`): selector
  de carpeta (webkitdirectory) → Markdown a JSON con `tiptap-markdown` (headless) → alta masiva
  `POST /api/notes/import`. Título = nombre de archivo; etiquetas = TODAS las carpetas de la ruta
  (incluida la raíz seleccionada) + `obsidian`. Frontmatter eliminado; `[[wikilinks]]` como texto
  (siguen generando backlinks); `#hashtags` del contenido ignorados. Imágenes: ver Fase 3.
  - **Emparejamiento de imágenes por ruta completa, no solo nombre**: los vaults exportados de
    Evernote guardan los adjuntos en `_resources/<nota>.resources/<archivo>` con nombres de archivo
    repetidos entre notas (p. ej. "ScreenClip.png" en 24 notas distintas de un mismo notebook). Si
    el embed trae ruta, se resuelve relativa a la carpeta de la nota y se empareja por ruta completa
    (siempre única); si no, cae al basename (vault plano normal). Antes de este fix, notas distintas
    podían acabar con la imagen de otra en silencio.
  - **Tag `#evernote` automático**: si la carpeta importada tiene una subcarpeta `_resources` (huella
    del exportador Evernote→Obsidian), las notas de esa carpeta lo llevan aunque no se seleccione la
    carpeta "Evernote" en sí (el navegador no ve carpetas por encima de la seleccionada — limitación
    dura de `webkitdirectory`, no un bug). Notebooks sin ninguna imagen no dejan ningún archivo bajo
    `_resources` para detectar, así que hay también una casilla manual "Viene de Evernote" como refuerzo.
- **Tablas**: `@tiptap/extension-table` (+`-row`/`-header`/`-cell`, sin `resizable` porque ese plugin
  lleva estado propio en ProseMirror que choca con Yjs/Collaboration) en el editor real y en el
  conversor de importación. Antes de esto, StarterKit no tenía nodos de tabla y `tiptap-markdown` no
  tenía dónde meterlas — el resultado era el texto de las celdas pegado sin espacios en notas
  importadas con tablas.
- **Adjuntar de Dropbox**: botón 📎 en la barra del editor (`frontend/src/dropbox.ts`) usa el
  **Dropbox Chooser** (widget oficial, sin OAuth — solo requiere una app key pública, `VITE_DROPBOX_APP_KEY`)
  para elegir un archivo de la cuenta Dropbox del usuario e insertarlo como enlace `link_type: 'preview'`
  (el mismo tipo de enlace permanente que da "Copiar enlace" en Dropbox). Sin la app key el botón queda
  deshabilitado con tooltip. **Requiere registrar el dominio en el App Console de Dropbox** ("Chooser /
  Saver / Embedder domains") — sin eso da "App is misconfigured" al abrir el selector.
- **Lightbox de imágenes**: click en cualquier imagen de una nota abre una ventana con la imagen
  ampliada (`ImageLightbox.tsx`, mismo patrón `.modal-overlay` que el resto de diálogos); click en
  cualquier parte la cierra.
- **Buscar texto dentro de la nota**: botón 🔍 en la barra del editor abre una caja de búsqueda que
  resalta coincidencias con decoraciones de ProseMirror (`editor/SearchHighlight.ts`, extensión propia
  — no hay equivalente gratuito en TipTap core), con contador, navegación ▲/▼ (o Enter/Shift+Enter) y
  cierre con ✕/Escape. No toca el documento ni genera update de Yjs; recalcula posiciones si el doc
  cambia mientras la búsqueda está abierta.
- **Exportar nota a PDF**: botón "PDF" junto a Archivar/Eliminar, usa `window.print()` con una hoja
  `@media print` dedicada (oculta topbar/sidebar/toolbar/backlinks/relacionadas, fuerza fondo blanco/
  texto negro). Sin librerías nuevas ni backend — el PDF lo genera el propio navegador con texto real,
  no una imagen rasterizada.
- **Borrado masivo**: `POST /api/notes/bulk-delete` {ids}; botón "Eliminar N resultados" en el filtro
  de etiquetas (solo visible con filtro activo, para no borrar todo por accidente).
- **Backlinks — `resyncAllEnlaces()` en O(1) consultas**: se llama en cada creación de nota y en cada
  importación masiva. La versión original hacía una ida y vuelta a la BD por cada nota EXISTENTE en la
  tabla (no solo las nuevas) — con el vault creciendo por importaciones de Evernote, esto llegó a agotar
  el timeout del proxy Netlify→Render (504 real, con ~100 notas ya en la tabla). Reescrito en
  `backend/src/lib/wikilinks.ts` para resolver los títulos en memoria contra un único SELECT y hacer
  como mucho un DELETE + INSERT masivos.

## Fase 3 — imágenes (Cloudflare R2) — EN PRODUCCIÓN
Solo imágenes por ahora (audio/vídeo quedan para Fase 3b, misma infraestructura de adjuntos).
Bucket R2 **privado**: la nota nunca guarda una URL pública, solo `/api/attachments/:id`.
- **Esquema**: tabla `adjuntos` — `url` guarda la CLAVE del objeto en R2 (no una URL), +
  `mime_type`, `tamano_bytes`, índice por `nota_id`.
- **Subida**: `POST /api/attachments` {notaId, nombreOriginal, mimeType, tamano} (auth, valida tipo
  imagen y tamaño ≤20MB) → inserta la fila y devuelve `{id, uploadUrl}` (PUT presignado, TTL 5 min).
  El binario va DIRECTO del navegador a R2 (`backend/src/lib/r2.ts`, `@aws-sdk/client-s3` +
  `s3-request-presigner`), no pasa por Render.
- **Lectura**: `GET /api/attachments/:id` (auth) → redirect 302 a una URL de lectura firmada
  (TTL 5 min, `Cache-Control: private, max-age=250`). Ruta relativa `/api/attachments/:id`, funciona
  igual en Netlify (proxy `/api/*`) y en dev (proxy en `vite.config.ts`, solo para `<img src>`).
- **Limpieza**: al borrar una nota se borran también sus objetos en R2 (best-effort, `deleteObjects`
  en `lib/r2.ts`) antes del `DELETE` en Postgres.
- **Editor**: `@tiptap/extension-image`. Pegar/soltar una imagen o el botón 🖼️ suben primero a R2 y
  SOLO ENTONCES insertan el nodo con la URL final — sin preview optimista con blob: local (se
  sincronizaría por Yjs y no tendría sentido en otro dispositivo).
- **Importación de Obsidian con imágenes**: dos fases. 1) `resolveImageEmbeds()` reescribe
  `![[img.png]]` y `![alt](ruta/img.png)` a un esquema temporal `obsidian-embed:<nombre>`. 2) Las
  notas se crean primero por lotes (`adjuntos.nota_id` es NOT NULL) — solo entonces se suben las
  imágenes y se hace `PATCH` reescribiendo la referencia temporal por la URL definitiva.
- **CORS en el bucket R2** (imprescindible): Cloudflare dashboard → R2 → bucket → Settings → CORS
  Policy, permitir `PUT` desde `http://localhost:5173` y `https://muninn-huginn.netlify.app`, header
  `Content-Type`. Sin esto las subidas fallan con "Failed to fetch" / error CORS en consola.
- **Env**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (requeridos);
  `R2_ENDPOINT` opcional. Smoke test sin pasar por el backend: `node backend/test/r2-smoke.mjs`.

## Fase 6 — búsqueda semántica (COMPLETA, T6.1–T6.5, EN PRODUCCIÓN)
Se priorizó por delante de T4/T5/Fase 3b/backlog Fase 4: con cientos de notas sin más clasificación
que etiquetas planas, el descubrimiento de conexiones no vistas aportaba más valor inmediato. Las 5
sub-fases están cerradas y desplegadas.
- **Proveedor**: Voyage AI, modelo `voyage-4-lite` por defecto (`VOYAGE_MODEL`), dimensión 1024.
  200M tokens gratis permanentes. Rate limit sin tarjeta: 3 req/min (muy bajo, se dispara en
  imports/backfills); con tarjeta añadida sube a Tier 1: 2000 req/min.
  `backend/src/lib/embeddings.ts`: `generarEmbedding()` reintenta ante 429 con backoff (respeta
  `Retry-After`, si no 20s, hasta 3 intentos).
- **Esquema**: `CREATE EXTENSION vector` + `notas.embedding vector(1024)` + índice HNSW
  (`vector_cosine_ops`).
- **T6.1 — infraestructura**: `actualizarEmbeddingNota(notaId, contenido)` (fire-and-forget, nunca
  lanza, loguea y sigue) enganchada en el mismo punto que `syncEnlaces`: guardado Yjs
  (`yjs/persistence.ts`), crear/editar por REST y `POST /api/notes/import` (en secuencia, no en
  paralelo, para no saturar Voyage). Script `backend/scripts/backfill-embeddings.ts`
  (`npm run backfill-embeddings`, solo toca `WHERE embedding IS NULL`, idempotente). Notas sin texto
  (solo imagen) se quedan sin embedding a propósito, no es un fallo.
  `GET/POST/PATCH /api/notes...` seleccionan columnas explícitas (constante `NOTA_COLUMNAS`) para NO
  filtrar el embedding (1024 floats) al frontend.
- **T6.2 — notas relacionadas**: `GET /api/notes/:id/related?limit=5` (auth, clamp 1-20) — ordena
  por `embedding <=> embedding_origen`, excluye archivadas y la nota misma; sin embedding aún
  devuelve `[]` en vez de romper. Panel "Relacionadas" junto a Backlinks.
- **T6.3 — búsqueda semántica**: `GET /api/notes/search/semantic?q=...&limit=10&tags=a,b` (auth,
  `input_type: 'query'` al embeder la consulta, distinto de `'document'` al indexar notas). Caja de
  búsqueda en la sidebar, debounce 500ms (Enter = inmediata), sustituye lista+filtro de etiquetas
  mientras hay texto. Un único modo de búsqueda (no literal vs. semántica) porque la búsqueda
  `tsvector` aún no existe (sigue en backlog Fase 4).
- Tipo compartido `RelatedNote { id, titulo, distancia }` (distancia coseno, 0 = idéntico), reusado
  para T6.2 y T6.3.
- **T6.4 — mapa semántico**: `backend/scripts/cluster-notes.ts` (`npm run cluster-notes`, manual, no
  cron) proyecta los embeddings a 2D con `umap-js` (distancia coseno) y agrupa esa proyección 2D con
  `ml-kmeans` — K entre 2 y 8. Tabla `mapa_notas` (`nota_id`, `x`, `y`, `cluster_id`).
  `GET /api/notes/map`. Botón "Mapa" → SVG tipo constelación; paleta validada contra el fondo oscuro
  real de Muninn. Hay que re-ejecutar el script tras importaciones grandes.
- **T6.5 — chat RAG**: `POST /api/chat` {pregunta} — embede la pregunta, recupera las 5 notas más
  parecidas, y le pide a **Claude Haiku 4.5** (`backend/src/lib/claude.ts`) que responda solo con esa
  información. Salida estructurada (`output_config.format` con JSON Schema, no `zodOutputFormat` —
  requiere `zod/v4` y el proyecto usa zod v3) con `{respuesta, notas_citadas}`; los ids citados se
  filtran server-side contra las notas realmente recuperadas. Coste real: fracciones de céntimo por
  pregunta con Haiku 4.5. `extractStructuredText` (conserva saltos de línea por párrafo, a diferencia
  de `extractPlainText` que usan los embeddings) se usa SOLO para construir el contexto del chat.
  Botón "Chat" → diálogo de conversación, respuestas con fuentes citadas como enlaces clicables.
  El contexto incluye también las **etiquetas** de cada nota (línea `— Etiquetas: #a, #b`), para que
  Claude pueda responder sobre categoría/tema/idioma; deliberadamente no se tocó el retrieval
  (T6.2/T6.3 siguen sin usar tags para ordenar resultados).

## T5 — autenticación del WebSocket (COMPLETA, EN PRODUCCIÓN)
El `upgrade` handler del WS de Yjs no comprobaba ninguna sesión — cualquiera que conociera un `noteId`
podía leer/escribir esa nota sin passkey. La cookie de sesión no sirve para arreglarlo directamente:
en producción el WS conecta DIRECTO a Render, sin pasar por el proxy `/api` de Netlify que hace la
cookie first-party — así que la cookie queda scoped al dominio de Netlify y nunca llega al `upgrade`
en el dominio de Render (Domain mismatch, no un tema de SameSite).
- **Solución — ticket de corta vida**: `GET /api/auth/ws-ticket` (protegido por `requireAuth`, sí pasa
  por el proxy con la cookie normal) devuelve un JWT de propósito `'ws'`, TTL **12h**
  (`backend/src/auth/tokens.ts`, `mintWsTicket`/`verifyWsTicket`). El cliente lo pide ANTES de crear
  el `WebsocketProvider` y lo manda como query param; el `upgrade` handler lo valida y responde 401 +
  destroy si falta o es inválido. 12h porque `y-websocket` fija la URL de conexión una sola vez y la
  reutiliza en cada reintento de reconexión — si el ticket caduca a media sesión, las reconexiones
  fallan en silencio hasta reabrir la nota. Límite conocido y aceptado: una pestaña desconectada más
  de ~12h seguidas no reconecta sola.

## T4 — offline-first con y-indexeddb (COMPLETA, EN PRODUCCIÓN)
Antes, el contenido solo se persistía vía el socket Yjs — editar durante un corte de red y cerrar la
pestaña antes de reconectar perdía esos cambios sin aviso.
- `IndexeddbPersistence` (paquete `y-indexeddb`, DB `muninn-<noteId>`) junto al `WebsocketProvider`.
  El editor se monta desde la copia local en cuanto carga, sin esperar a la red — `Conn.provider` es
  `WebsocketProvider | null`. Las ediciones offline se guardan al instante en IndexedDB; al
  reconectar, Yjs fusiona automáticamente lo local con el servidor (CRDT).
- Reintento en `window.addEventListener('online', ...)`: si el ticket de T5 fallaba por estar
  offline, sin este listener la nota se habría quedado en modo "solo local" hasta recargar la página.

## Incidente: T4 duplicaba notas al abrirlas (RESUELTO)
Bug real en producción, introducido por T4. La siembra "si el Y.Doc está vacío, cárgalo desde la
proyección REST" se disparaba tanto por el sync de IndexedDB como por el del WS. Pero IndexedDB vacío
solo significa que ESE navegador no tiene caché local de la nota — no que la nota esté vacía en el
servidor. Al abrir una nota sin caché local, se sembraba contenido Yjs NUEVO que, al conectar el WS,
se fusionaba con el ya existente en vez de sustituirlo: mismo texto duplicado como operaciones Yjs
distintas. Cada apertura sin caché añadía otra copia.
- **Fix** (`e1eeb96`): la siembra depende ÚNICAMENTE del `sync` del WebSocket, nunca del `synced` de
  IndexedDB.
- **Limpieza de producción**: 7 notas afectadas detectadas con un script de solo lectura. 6 reparadas
  recortando directamente el `yjs_state` (dos de ellas tenían más de una capa de duplicación — hizo
  falta iterar). Una ("Aceptar no es resignarse Ψ") no se pudo reparar automáticamente por haberse
  editado después de duplicarse — el usuario la revisó/arregló a mano.
- **Lección para futuros cambios de sync/persistencia**: cualquier señal de "sincronizado" puramente
  LOCAL (caché de este dispositivo) nunca debe decidir si sembrar/sobrescribir contenido — solo una
  señal AUTORITATIVA (el servidor, vía WS) puede confirmar que un documento está vacío en todas partes.

## Pendiente
- Fase 3b: audio/vídeo (misma infraestructura de `adjuntos`, falta UI de reproductor inline).
- Borrado manual de un adjunto individual sin borrar la nota entera (hoy solo se limpia en cascada).
- Backlog Fase 4: búsqueda full-text (`tsvector`), historial de versiones, export Markdown, grafo, push.

## Notas de entorno (Windows + Dropbox)
- `node_modules` marcados `com.dropbox.ignored=1` (dev/backend y frontend) y caché de Vite movida a
  temp (`cacheDir` en `vite.config.ts`) porque Dropbox bloqueaba renames (EBUSY/504).
- Bash `pkill` no mata procesos node de Windows; liberar puertos con `netstat -ano | grep LISTENING`
  para el PID del puerto (3000/5173) + `taskkill //PID <pid> //F`. Servidores dev: backend
  `npx tsx watch src/index.ts` (:3000), frontend `npm run dev` (:5173).
- Tests manuales Yjs en `backend/test/*.mjs` (yjs-sync, yjs-persist) y `frontend/test/provider-sync.mjs`.
- **Ramas Neon dev vs prod y passkeys**: si se crea una rama `dev` nueva a partir de una rama que solo
  tenía la passkey del móvil (rpID = dominio Netlify), el login local (rpID=localhost) falla sin
  diálogo. Solución: `TRUNCATE credenciales_passkey` SOLO en la BD dev (nunca en prod) para reabrir
  el registro bootstrap y crear una passkey Windows Hello nueva para localhost.
- **Probar WebAuthn con Playwright/CDP**: Windows Hello no siempre dispara el diálogo OS dentro de un
  navegador controlado por automatización. Alternativa que sí funciona:
  `page.context().newCDPSession(page)` → `WebAuthn.enable` + `addVirtualAuthenticator`
  (`protocol: 'ctap2', transport: 'internal', hasResidentKey: true, isUserVerified: true,
  automaticPresenceSimulation: true`) ANTES de pulsar "Registrar/Entrar con passkey". Requiere
  `hasCredential` en `false` (bootstrap).
- **Probar UI autenticada sin WebAuthn** (cuando ya existe una passkey real): mintar el JWT de sesión
  directamente con el mismo `SESSION_SECRET` del `.env`
  (`jwt.sign({ sub: 'owner' }, secret, { expiresIn: '30d' })`, cookie `muninn_session`) e inyectarlo
  con `page.context().addCookies([...])` antes de navegar. Legítimo para pruebas locales propias,
  nunca usar con el `SESSION_SECRET` de prod.
- Playwright `browser_file_upload` está sandboxed a la carpeta del proyecto (o `.playwright-mcp/`
  dentro de él). Para un input `webkitdirectory`, pasar la ruta de la CARPETA sí simula una selección
  de directorio completa.

Último commit conocido: `1e9f784` (exportar nota a PDF). T4, T5 y Fase 6 (T6.1–T6.5) completos y en
producción — no queda nada pendiente de la lista original salvo Fase 3b (audio/vídeo) y el backlog de
Fase 4. Modelo usado en el chat de Claude Code: Sonnet 5.
