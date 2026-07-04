# Muninn

Aplicación web personal de notas tipo Obsidian: editor rich-text por bloques,
enlaces entre notas (`[[wikilink]]`), backlinks, y (en fases posteriores)
sincronización en tiempo real y multimedia embebido.

Uso **single-user** (solo el propietario), autenticación con **passkey (WebAuthn)**,
diseñada para funcionar íntegramente en planes gratuitos.

Ver [SPEC.md](SPEC.md) para la especificación completa.

## Estructura

```
/muninn
  /shared     → tipos TypeScript compartidos (modelo de datos, contratos API)
  /backend    → API REST Node.js + Express + TypeScript (Postgres/Neon, WebAuthn)
  /frontend   → React + Vite + TipTap, instalable como PWA
```

## Estado

- **Fase 1 (MVP)** — ✅ desplegada en producción: CRUD de notas, editor por bloques,
  wikilinks, backlinks, auth passkey multi-dispositivo, PWA instalable.
  - Frontend: https://muninn-huginn.netlify.app (Netlify)
  - Backend: https://muninn-backend.onrender.com (Render, plan Starter)
- Fase 2 — sincronización en tiempo real (Yjs). *Pendiente.*
- Fase 3 — multimedia (Cloudflare R2). *Pendiente.*

## Desarrollo local

Requisitos: Node.js ≥ 20, una base de datos PostgreSQL (local o Neon).

```bash
# Backend
cd backend
cp .env.example .env      # rellenar DATABASE_URL, WEBAUTHN_*
npm install
npm run migrate           # crea el esquema
npm run dev               # arranca en http://localhost:3000

# Frontend (en otra terminal)
cd frontend
cp .env.example .env      # apuntar VITE_API_URL al backend
npm install
npm run dev               # arranca en http://localhost:5173
```

## Despliegue

- **Base de datos** → Neon (Postgres, plan gratuito). Crea el proyecto, copia la
  connection string *pooled* (`...-pooler...`, con `?sslmode=require`) a `DATABASE_URL`.
- **Backend** → Render. Hay un blueprint en [`render.yaml`](render.yaml): New → Blueprint.
  Define en el dashboard las variables marcadas `sync:false`. El build usa
  `npm install --include=dev && npm run build` (necesario porque `NODE_ENV=production`
  omitiría `@types`/`typescript`). Tras el primer deploy, ejecuta la migración una vez con
  `npm run migrate` (Render Shell) o localmente apuntando `DATABASE_URL` a Neon.
- **Frontend** → Netlify. Base directory `frontend` (ver
  [`frontend/netlify.toml`](frontend/netlify.toml)). **No** definas `VITE_API_URL`: en
  producción el cliente usa rutas relativas (`/api/...`) que pasan por el proxy.

### Cookies y iOS (importante)

La sesión se guarda en una cookie httpOnly. Safari en iOS **bloquea las cookies de
terceros**, así que el frontend (Netlify) y el backend (Render) NO deben verse como
dominios distintos. Solución en uso: **proxy `/api` en Netlify** (cookies *first-party*).

- [`frontend/public/_redirects`](frontend/public/_redirects) reenvía `/api/*` al backend
  de Render. La regla `/api/*` **debe ir antes** del catch-all SPA `/*` (si no, `index.html`
  captura las llamadas a la API).
- El cliente ([`frontend/src/api.ts`](frontend/src/api.ts)) usa rutas relativas en
  producción y `http://localhost:3000` en dev, así que el navegador ve todo en el mismo
  origen.
- Por el proxy, `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` / `FRONTEND_URL` en Render deben ser
  el **dominio de Netlify**, no el de Render, y `COOKIE_SECURE=true`.

En **local** no hay problema: `VITE_API_URL=http://localhost:3000` y `COOKIE_SECURE=false`.

### Variables de entorno

Ver plantillas en [`backend/.env.example`](backend/.env.example) y
[`frontend/.env.example`](frontend/.env.example).

| Variable | Dónde | Descripción |
|---|---|---|
| `DATABASE_URL` | backend | Connection string de Neon (con `sslmode=require`). |
| `SESSION_SECRET` | backend | Secreto largo y aleatorio para firmar las cookies. |
| `FRONTEND_URL` | backend | Origen del frontend, para CORS. |
| `WEBAUTHN_RP_ID` | backend | Dominio sin protocolo (p. ej. `mi-app.netlify.app`). |
| `WEBAUTHN_ORIGIN` | backend | Origen completo del frontend (con `https://`). |
| `COOKIE_SECURE` | backend | `true` en producción (HTTPS), `false` en local. |
| `VITE_API_URL` | frontend | Solo local/dev (`http://localhost:3000`). En producción **no se define**: se usan rutas relativas + proxy. |

## Primer uso

No hay registro público. La **primera** vez que abras la app, no habrá ninguna passkey:
verás el botón **«Registrar passkey»**. Al registrarla tomas posesión de la app y el
registro público queda cerrado; a partir de ahí sólo aparece **«Entrar con passkey»**.

**Multi-dispositivo:** las passkeys están ligadas al dominio y no se sincronizan entre
Windows y Apple. Para entrar desde varios dispositivos, una vez dentro abre
**«Dispositivos»** y usa **«Añadir passkey en este dispositivo»** en cada uno (Windows
Hello, Face ID en iPhone, Touch ID en iPad). Añadir passkeys requiere sesión activa; no
se puede borrar la última para no reabrir el registro al público.

**Dev vs producción:** las credenciales viven en la BD. Como la passkey de `localhost`
no vale en el dominio de producción (y viceversa), conviene dar a producción **su propia
base de datos** (una *branch* de Neon, gratis) para que arranque vacía y puedas registrar
la primera passkey de producción. Así dev y producción no comparten credenciales ni datos.
