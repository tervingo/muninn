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
Ver `SPEC.md` en el repo para la especificación por fases.

## Stack y estructura
Monorepo, cada lado autocontenido y desplegable por separado:
- `backend/` — Node.js + Express + TypeScript (ESM, tsx/tsc). Postgres (Neon, `pg`).
  WebAuthn (`@simplewebauthn/server`). WebSocket Yjs (`ws` + `yjs` + `y-protocols` + `y-prosemirror`).
- `frontend/` — React + Vite + TypeScript, editor TipTap, PWA (`vite-plugin-pwa`).
- `shared/` — solo referencia de tipos (no se importa en runtime; cada lado replica sus tipos).

## Despliegue (Fase 1 y 2 EN PRODUCCIÓN)
- Frontend: **https://muninn-huginn.netlify.app** (Netlify; `muninn.netlify.app` estaba pillado).
- Backend: **https://muninn-backend.onrender.com** (Render, plan **Starter** always-on, sin cold start).
- BD: **Neon**, dos branches: `production` (Render) y `dev` (local, en `backend/.env`).
- Netlify proxya `/api/*` → Render vía `frontend/public/_redirects` (la regla `/api/*` DEBE ir
  antes del catch-all SPA `/*`). Cookies first-party → funciona en Safari iOS.
- El cliente REST usa rutas relativas en prod y `http://localhost:3000` en dev
  (`frontend/src/api.ts`). El **WebSocket** NO pasa por el proxy: conecta directo a Render
  (`wss://muninn-backend.onrender.com`) en prod y `ws://localhost:3000` en dev (`frontend/src/config.ts`).
- Render build: `npm install --include=dev && npm run build` (NODE_ENV=production omitía @types/typescript).
- Env en Render: `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN`/`FRONTEND_URL` = dominio de Netlify; `COOKIE_SECURE=true`.
- Migraciones: `npm run migrate` (aplica `backend/src/schema.sql`, idempotente). Ejecutar en dev Y prod
  al cambiar el esquema (yo lo corro con DATABASE_URL de prod inline).

## Autenticación
Passkey WebAuthn, single-user. Sesión = JWT en cookie httpOnly (sobrevive cold starts).
Primera passkey = bootstrap (registro abierto). Passkeys adicionales (otros dispositivos)
requieren sesión activa O una **ventana de alta** de 10 min (`enrollment` tabla, `/api/auth/enroll/open`),
para dar de alta dispositivos de otro ecosistema (Windows Hello no sincroniza con Apple/iCloud).
Diálogo "Dispositivos" en la UI. No se puede borrar la última passkey.

## Modelo de sincronización (Fase 2)
**Yjs es la fuente de verdad del documento**; `contenido` (JSON ProseMirror) es una proyección
derivada, de solo lectura para queries (backlinks, listados, búsqueda futura). El editor NO
guarda `contenido` por REST; solo el **título** y las **etiquetas** van por REST.
- Servidor WS (`backend/src/yjs/`): relay por sala (`/yjs/<noteId>`), carga `yjs_state` al abrir,
  guarda `yjs_state` + `contenido` derivado (con `y-prosemirror`) con debounce 2.5s y al cerrarse
  la última conexión; recalcula backlinks al persistir. Docs en memoria; se liberan sin conexiones.
- Cliente (`frontend/src/editor/Editor.tsx`): provider creado en useEffect (no useMemo) por el
  doble montaje de StrictMode; editor interno keyed por nota. Vite `resolve.dedupe:['yjs']`.
- Notas importadas/creadas por REST solo tienen `contenido`; al abrirlas el cliente siembra Yjs
  si la sala está vacía y el servidor persiste `yjs_state`.

## Funcionalidades implementadas
- Fase 1: CRUD notas, archivar, editor por bloques (StarterKit), `[[wikilinks]]` con autocompletado,
  backlinks, PWA instalable, auth passkey multi-dispositivo. Logo propio (iconos desde `public/muninn.png`,
  fondo transparente; script `frontend/scripts/generate-icons.ps1`).
- Fase 2 T1–T3: sync en vivo + persistencia dual (ver arriba). Enlaces externos (`@tiptap/extension-link`:
  autolink, link al pegar, abrir en pestaña nueva, Mod-K).
- **Etiquetas**: columna `tags TEXT[]` (índice GIN). Chips en la nota (añadir/quitar), filtro por
  etiqueta (AND) en la barra lateral con recuentos. `GET /api/notes/tags`, `?tags=a,b`. Metadatos REST.
- **Importar de Obsidian** (`frontend/src/components/ImportDialog.tsx`, `src/import/markdown.ts`): selector
  de carpeta (webkitdirectory) → Markdown a JSON con `tiptap-markdown` (headless) → alta masiva
  `POST /api/notes/import`. Título = nombre de archivo; etiquetas = TODAS las carpetas de la ruta
  (incluida la raíz seleccionada) + `obsidian`. Frontmatter eliminado; `[[wikilinks]]` como texto
  (siguen generando backlinks); `#hashtags` del contenido ignorados. Imágenes NO tratadas aún.
- **Borrado masivo**: `POST /api/notes/bulk-delete` {ids}; botón "Eliminar N resultados" en el filtro
  de etiquetas (solo visible con filtro activo, para no borrar todo por accidente).

## Fase 3 — imágenes (Cloudflare R2) — EN PRODUCCIÓN
Solo imágenes por ahora (audio/vídeo quedan para más adelante, misma infraestructura de adjuntos).
Bucket R2 **privado**: la nota nunca guarda una URL pública, solo `/api/attachments/:id`.
- **Esquema**: tabla `adjuntos` (ya existía en el schema, sin usar) — `url` ahora guarda la CLAVE del
  objeto en R2 (no una URL), + `mime_type`, `tamano_bytes`, índice por `nota_id`.
- **Subida**: `POST /api/attachments` {notaId, nombreOriginal, mimeType, tamano} (auth, valida tipo
  imagen y tamaño ≤20MB, la nota debe existir) → inserta la fila y devuelve `{id, uploadUrl}` (PUT
  presignado, TTL 5 min). El binario va DIRECTO del navegador a R2 (`backend/src/lib/r2.ts`,
  `@aws-sdk/client-s3` + `s3-request-presigner`), no pasa por Render.
- **Lectura**: `GET /api/attachments/:id` (auth) → redirect 302 a una URL de lectura firmada
  (TTL 5 min, `Cache-Control: private, max-age=250`). Como es ruta relativa `/api/attachments/:id`,
  funciona igual en Netlify (proxy `/api/*`) y en dev (proxy añadido en `vite.config.ts`, solo para
  <img src>; las llamadas REST de `api.ts` siguen usando BASE absoluto).
- **Limpieza**: al borrar una nota (`DELETE /api/notes/:id` o `bulk-delete`) se borran también sus
  objetos en R2 (best-effort, `deleteObjects` en `lib/r2.ts`) antes del `DELETE` en Postgres (el
  `ON DELETE CASCADE` se lleva las filas de `adjuntos`).
- **Editor** (`frontend/src/editor/Editor.tsx`): `@tiptap/extension-image`. Pegar/soltar una imagen o
  el botón 🖼️ de la mini-toolbar suben primero a R2 y SOLO ENTONCES insertan el nodo con la URL final
  en el cursor — sin preview optimista con blob: local (se sincronizaría por Yjs y no tendría sentido
  en otro dispositivo).
- **Importación de Obsidian con imágenes** (`ImportDialog.tsx` + `import/markdown.ts`): dos fases.
  1) `resolveImageEmbeds()` reescribe `![[img.png]]` y `![alt](ruta/img.png)` a un esquema temporal
     `obsidian-embed:<nombre>` SOLO si el nombre coincide con un archivo de imagen del vault
     seleccionado (dedupe por nombre de archivo en minúsculas — si hay nombres duplicados en carpetas
     distintas, gana el último). El resto del Markdown (incluidas URLs http(s)) no se toca.
  2) Las notas se crean primero por lotes (`POST /api/notes/import` ahora devuelve también `ids` en el
     mismo orden) porque `adjuntos.nota_id` es NOT NULL — la imagen no puede subirse antes de que la
     nota exista. Solo entonces se suben las imágenes referenciadas (con el id real de cada nota) y se
     hace un `PATCH` reescribiendo `obsidian-embed:` por la URL definitiva
     (`collectPendingImageEmbeds` / `resolveImageEmbedRefs`).
- **CORS en el bucket R2** (imprescindible, si no las subidas fallan con "Failed to fetch"/CORS en
  consola): en Cloudflare dashboard → R2 → bucket → Settings → CORS Policy, permitir `PUT` desde
  `http://localhost:5173` y `https://muninn-huginn.netlify.app`, header `Content-Type`.
- **Env** (Render y `backend/.env`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME` (requeridos, igual que `DATABASE_URL`); `R2_ENDPOINT` opcional (se deriva del
  account id). Smoke test sin pasar por el backend: `node backend/test/r2-smoke.mjs`.
- Verificado manualmente en dev (subida por botón, import de vault con `![[img.png]]`, borrado con
  limpieza en R2) usando un WebAuthn *virtual authenticator* vía CDP de Playwright — Windows Hello no
  siempre dispara el diálogo OS dentro de un navegador controlado por automatización.

## Fase 6 — búsqueda semántica (PENDIENTE, priorizada sobre T4/T5/Fase 3b/Fase 4)

> T4 (offline-first), T5 (auth del socket), Fase 3b (audio/vídeo) y el backlog de Fase 4
> (full-text, historial, export, grafo, push) quedan **aparcados temporalmente**. Se retoman
> después de esta fase. Motivo: con cientos de notas sin más clasificación que etiquetas planas,
> el descubrimiento de conexiones no vistas aporta más valor inmediato que estas tareas.

Objetivo: encontrar notas por significado, no solo por texto exacto o etiqueta, y descubrir
relaciones entre notas que nunca se enlazaron manualmente con `[[wikilinks]]`. Se implementa en
sub-fases incrementales, cada una desplegable y útil por sí sola.

### Decisiones de diseño
- **Proveedor de embeddings: Voyage AI** (`voyage-4-lite` o `voyage-4`, a confirmar por calidad/coste
  tras probar). 200M tokens gratis por cuenta, de forma permanente — muy por encima del volumen de
  notas personales previsto. Var. env.: `VOYAGE_API_KEY`.
- **Almacén de vectores: pgvector en Neon** (mismo Postgres, sin infraestructura nueva). Confirmar
  que la extensión está disponible en el plan gratuito de Neon antes de empezar (`CREATE EXTENSION
  IF NOT EXISTS vector;`).
- **Fuente del texto a embeder**: el mismo `contenido` (JSON ProseMirror) que ya se deriva de Yjs con
  debounce 2.5s — no un pipeline nuevo. Se extrae texto plano de ese JSON (helper nuevo, reutilizable
  con lo que ya exista para backlinks) y se generan/actualizan embeddings desde el mismo punto donde
  hoy se persiste `contenido` en `backend/src/yjs/`.
- **Generación de embeddings asíncrona y no bloqueante**: nunca debe retrasar el guardado de la nota
  ni la respuesta al cliente. Fire-and-forget con log de error si falla la llamada a Voyage (reintento
  simple o cola en memoria, a valorar según cómo de fiable resulte en la práctica).

### T6.1 — Infraestructura de embeddings
- Migración: `CREATE EXTENSION IF NOT EXISTS vector;` + `ALTER TABLE notas ADD COLUMN embedding
  vector(1024);` (ajustar dimensión según el modelo Voyage elegido) + índice HNSW o IVFFlat con
  `vector_cosine_ops` para que la búsqueda por similitud no haga un escaneo completo al crecer el
  número de notas.
- `backend/src/lib/embeddings.ts`: cliente Voyage AI, función `generarEmbedding(texto: string):
  Promise<number[]>` y función `actualizarEmbeddingNota(notaId, contenido)` que extrae texto plano,
  llama a Voyage y hace `UPDATE notas SET embedding = $1 WHERE id = $2`.
- Enganchar `actualizarEmbeddingNota` en el punto de persistencia de `contenido` en
  `backend/src/yjs/` (mismo debounce de 2.5s que ya dispara el recálculo de backlinks) y también en
  `POST /api/notes/import` (alta masiva) y en la creación/edición de notas vía REST si aplica.
- Migración de datos: script puntual para generar embeddings de todas las notas ya existentes
  (`backend/scripts/backfill-embeddings.ts`), ejecutable una vez en dev y una vez en prod.

### T6.2 — Notas relacionadas (mayor valor / menor esfuerzo, hacer primero)
- `GET /api/notes/:id/related?limit=5` (auth) → `SELECT id, titulo FROM notas WHERE id != $1 AND NOT
  archivada ORDER BY embedding <=> (SELECT embedding FROM notas WHERE id = $1) LIMIT $2`. Devolver
  también la distancia/similitud por si la UI quiere mostrarla o filtrar un umbral mínimo.
- Frontend: panel lateral en la vista de nota (junto al panel de backlinks existente), sección
  "Relacionadas" con las notas devueltas, click navega igual que un backlink.
- Manejar el caso de nota sin embedding aún (recién creada, antes del primer debounce) sin romper la UI.

### T6.3 — Búsqueda semántica
- `GET /api/notes/search/semantic?q=...&limit=10` (auth) → generar embedding de `q` con Voyage,
  buscar por `<=>` igual que en T6.2 pero contra la consulta en lugar de contra una nota. Evaluar si
  combinar con el filtro de etiquetas existente (`?tags=a,b`) para acotar la búsqueda semántica a un
  subconjunto.
- Frontend: nueva caja de búsqueda (o ampliar la existente) que distinga búsqueda literal (ya
  implementable con `tsvector`, sigue en el backlog de Fase 4) de búsqueda semántica — a decidir si
  son dos modos explícitos o un único cuadro con heurística.

### T6.4 — Mapa semántico (visual, hacerlo cuando ya haya volumen suficiente de notas indexadas)
- Job batch (`backend/scripts/cluster-notes.ts`, ejecución manual por ahora, no cron) que lee todos
  los embeddings, aplica reducción de dimensionalidad a 2D (librería `umap-js`, evaluar alternativas
  en Node) y clustering (k-means simple o similar).
- Tabla nueva `mapa_notas` (`nota_id`, `x`, `y`, `cluster_id`, `actualizado_en`) para no recalcular en
  cada carga de la UI.
- `GET /api/notes/map` (auth) → devuelve los puntos para pintar el mapa.
- Frontend: vista nueva tipo "constelación" (canvas o SVG), cada punto una nota, color por cluster,
  click abre la nota. Complementa al grafo de backlinks existente, no lo sustituye.

### T6.5 — Chat RAG sobre las notas (dejar para el final, mayor complejidad de prompt)
- `POST /api/chat` {pregunta} (auth) → embeder la pregunta, recuperar top-k notas por similitud,
  construir prompt con extractos de esas notas, llamar a la API de Claude (Anthropic SDK, modelo a
  decidir) pidiendo que responda citando qué nota(s) usó.
- Var. env. nueva: `ANTHROPIC_API_KEY`.
- Frontend: vista de chat simple, respuesta con enlaces clicables a las notas citadas.
- Cuidado con coste: a diferencia de los embeddings (prácticamente gratis a este volumen), cada
  pregunta implica una llamada a un modelo de generación — no crítico para uso personal, pero
  conviene no ejecutarlo en cada tecleo, solo al enviar la pregunta.

## Pendiente (aparcado hasta cerrar Fase 6)
- **T4 — offline-first (`y-indexeddb`)**: valor medio. Editar offline que sobreviva a recargar/cerrar
  pestaña y fusione al reconectar; cierra una pequeña ventana de pérdida de datos si editas durante un
  corte breve y cierras antes de reconectar (desde T3 el contenido solo se persiste vía socket).
- **T5 — autenticación del socket**: el WebSocket está **SIN autenticar** (solo protege UUID inadivinable).
  Es el hueco de seguridad real. Plan: token corto desde un endpoint REST autenticado, validado en el
  handshake del WS. Recomendado hacerlo.
- Fase 3b: audio/vídeo (misma infraestructura de `adjuntos`, falta UI de reproductor inline).
- Borrado manual de un adjunto individual sin borrar la nota entera (hoy solo se limpia en cascada).
- Backlog Fase 4: búsqueda full-text (`tsvector`), historial de versiones, export Markdown, grafo, push.

## Notas de entorno (Windows + Dropbox)
- `node_modules` marcados `com.dropbox.ignored=1` (dev/backend y frontend) y caché de Vite movida a
  temp (`cacheDir` en `vite.config.ts`) porque Dropbox bloqueaba renames (EBUSY/504).
- Bash `pkill` no mata procesos node de Windows; liberar puertos con PowerShell (Get-NetTCPConnection
  → Stop-Process). Servidores dev: backend `npx tsx watch src/index.ts` (:3000), frontend `npm run dev` (:5173).
- Tests manuales Yjs en `backend/test/*.mjs` (yjs-sync, yjs-persist) y `frontend/test/provider-sync.mjs`.

Último commit conocido: `4269ecd` (import Obsidian + bulk delete). Modelo usado en el chat: Claude Sonnet 5.
