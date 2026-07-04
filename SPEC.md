# Especificación técnica — App de notas personal (tipo Obsidian)

## 1. Objetivo del proyecto

Aplicación web personal de gestión de notas, con editor rich-text por bloques, enlaces entre notas (estilo `[[wikilink]]`), contenido multimedia embebido, y sincronización en tiempo real entre dispositivos (Windows y iOS vía PWA). Uso exclusivo del propietario (single-user). Sin presupuesto de infraestructura: toda la pila debe funcionar en planes gratuitos.

## 2. Alcance funcional

### Fase 1 — MVP (prioridad)
- Crear, editar, listar, archivar y eliminar notas.
- Editor rich-text por bloques (párrafos, encabezados, listas, citas, código).
- Autenticación mediante **passkey (WebAuthn)**, un único usuario autorizado.
- Guardado persistente en PostgreSQL (sin tiempo real todavía; autosave periódico/on-blur es suficiente).
- Instalable como PWA en Windows, iPhone y iPad (manifest + service worker básico, funcionamiento offline de solo lectura).
- Enlaces entre notas `[[nombre de nota]]` con autocompletado y navegación al hacer click.
- Panel de backlinks: qué notas enlazan a la nota abierta.

### Fase 2 — Sincronización en tiempo real
- Integrar **Yjs** (CRDT) en el editor para edición colaborativa/multi-dispositivo sin conflictos.
- Transporte de sincronización vía WebSocket (servidor propio con `y-websocket` o equivalente).
- Persistencia periódica del estado Yjs en PostgreSQL.
- Soporte offline-first real: editar sin conexión y fusionar cambios al reconectar.

### Fase 3 — Multimedia
- Subida de imágenes, audio y vídeo embebidos en las notas.
- Almacenamiento de archivos en Cloudflare R2 (o Backblaze B2), la nota solo guarda la referencia/URL.
- Preview inline en el editor (imagen, reproductor de audio/vídeo).

### Fase 4 — Mejoras adicionales (backlog, no bloqueante)
- Búsqueda full-text (usar `tsvector` nativo de Postgres).
- Historial de versiones de cada nota (aprovechando el historial de cambios de Yjs).
- Exportación/importación de notas en formato Markdown estándar.
- Vista de grafo de notas (relaciones visuales).
- Notificaciones push (opcional, vía Web Push API, solo funcionará con la PWA instalada en el home screen en iOS).

## 3. Arquitectura técnica

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | React + Vite | PWA (manifest.json + service worker con Workbox) |
| Editor | TipTap | Con extensión `y-prosemirror` para integrar Yjs en fase 2 |
| Backend | Node.js + Express (o NestJS) | API REST + servidor WebSocket |
| Base de datos | PostgreSQL (Neon) | Plan gratuito, sin caducidad |
| Sincronización | Yjs + y-websocket | Fase 2 |
| Almacenamiento multimedia | Cloudflare R2 | Fase 3 |
| Autenticación | WebAuthn (passkeys) vía `SimpleWebAuthn` | Un único usuario autorizado, sin registro público |
| Hosting frontend | Netlify o Vercel | Plan gratuito |
| Hosting backend | Render (Node.js) | Plan gratuito (cold start ~30-60s asumible) |

## 4. Modelo de datos (borrador inicial, PostgreSQL)

```sql
-- Notas
CREATE TABLE notas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  contenido JSONB NOT NULL,        -- documento TipTap/ProseMirror en JSON
  yjs_state BYTEA,                 -- estado binario Yjs (fase 2, nullable en fase 1)
  creado_en TIMESTAMPTZ DEFAULT now(),
  actualizado_en TIMESTAMPTZ DEFAULT now(),
  archivada BOOLEAN DEFAULT false
);

-- Enlaces entre notas (para backlinks y grafo)
CREATE TABLE enlaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_origen_id UUID REFERENCES notas(id) ON DELETE CASCADE,
  nota_destino_id UUID REFERENCES notas(id) ON DELETE CASCADE,
  creado_en TIMESTAMPTZ DEFAULT now(),
  UNIQUE (nota_origen_id, nota_destino_id)
);

-- Adjuntos multimedia (fase 3)
CREATE TABLE adjuntos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id UUID REFERENCES notas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,               -- 'imagen' | 'audio' | 'video'
  url TEXT NOT NULL,
  nombre_original TEXT,
  creado_en TIMESTAMPTZ DEFAULT now()
);

-- Credenciales passkey (WebAuthn)
CREATE TABLE credenciales_passkey (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id TEXT UNIQUE NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ DEFAULT now()
);
```

## 5. Requisitos no funcionales

- **PWA instalable**: manifest con iconos, `display: standalone`, funcionamiento correcto en Safari iOS (Add to Home Screen) y en escritorio (Windows).
- **Sin coste de infraestructura** en la fase inicial: usar exclusivamente los planes gratuitos indicados en la tabla de arquitectura.
- **Offline resiliente**: la app debe poder abrirse y mostrar las últimas notas cacheadas sin conexión (fase 1); edición offline con fusión automática al reconectar (fase 2).
- **Responsive**: debe funcionar igual de bien en pantalla de escritorio que en iPhone/iPad, incluyendo soporte para teclado externo y Apple Pencil si aplica al editor.
- **Seguridad**: acceso restringido exclusivamente al propietario vía passkey; ninguna ruta de registro pública debe existir.

## 6. Estructura de repositorio propuesta

```
/notas-app
  /frontend        → React + Vite + PWA
  /backend         → Node.js API + WebSocket server
  /shared          → tipos/esquemas compartidos (si se usa TypeScript en ambos lados)
  docker-compose.yml (opcional, solo para desarrollo local con Postgres)
  README.md
  SPEC.md          → este documento
```

## 7. Variables de entorno / servicios externos a configurar

- `DATABASE_URL` → cadena de conexión de Neon.
- `R2_BUCKET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY` → credenciales Cloudflare R2 (fase 3).
- `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN` → configuración de SimpleWebAuthn.
- `FRONTEND_URL` / `BACKEND_URL` → para configurar CORS correctamente entre Netlify/Vercel y Render.

## 8. Criterios de aceptación por fase

**Fase 1 completa cuando:**
- Puedo instalar la app en mi iPhone, iPad y Windows desde el navegador.
- Puedo hacer login con passkey (Face ID / Touch ID / Windows Hello).
- Puedo crear, editar y ver notas con formato rich-text.
- Los enlaces `[[nota]]` funcionan y navegan correctamente, y veo los backlinks de cada nota.

**Fase 2 completa cuando:**
- Edito una nota en un dispositivo y el cambio aparece en otro dispositivo abierto simultáneamente, sin recargar.
- Edito offline y, al recuperar conexión, los cambios se fusionan sin pérdida de datos ni conflictos manuales.

**Fase 3 completa cuando:**
- Puedo insertar una imagen/audio/vídeo en una nota, y se visualiza correctamente en todos los dispositivos.

## 9. Notas para Claude Code

- Priorizar simplicidad sobre abstracción prematura: es un proyecto personal, no un producto multi-tenant.
- Ir fase por fase; no mezclar la implementación de Yjs (fase 2) con el CRUD inicial (fase 1).
- Usar TypeScript en frontend y backend si es razonable, para reducir errores en el modelo de datos compartido (nota, enlaces, adjuntos).
- Preguntar antes de introducir dependencias no mencionadas en este documento que cambien la arquitectura (por ejemplo, cambiar de Postgres a otra BD, o de TipTap a otro editor).
