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

- **Fase 1 (MVP)** — en desarrollo: CRUD de notas, editor por bloques, wikilinks,
  backlinks, auth passkey, PWA instalable.
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
- **Backend** → Render (plan gratuito, cold start ~30-60s asumible). Hay un blueprint
  en [`render.yaml`](render.yaml): New → Blueprint. Define en el dashboard las variables
  marcadas `sync:false`. Tras el primer deploy, ejecuta la migración una vez con
  `npm run migrate` (Render Shell) o localmente apuntando `DATABASE_URL` a Neon.
- **Frontend** → Netlify (plan gratuito). Base directory `frontend` (ver
  [`frontend/netlify.toml`](frontend/netlify.toml)).

### Cookies y iOS (importante)

La sesión se guarda en una cookie httpOnly. Safari en iOS **bloquea las cookies de
terceros**, así que si el frontend (Netlify) y el backend (Render) están en dominios
distintos, el login puede no persistir en iPhone/iPad. Dos opciones:

1. **Recomendada — proxy `/api` en Netlify** (cookies *first-party*): descomenta el
   bloque `[[redirects]]` de `/api/*` en `netlify.toml` apuntando a tu URL de Render,
   deja `VITE_API_URL` vacío, y pon `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` al dominio de
   Netlify. Así el navegador ve todo en el mismo origen.
2. Dominios separados con `COOKIE_SECURE=true` (cookie `SameSite=None; Secure`). Funciona
   en escritorio y Android; en iOS puede requerir que la PWA esté instalada en pantalla
   de inicio.

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
| `VITE_API_URL` | frontend | URL del backend, o vacío si se usa el proxy `/api`. |

## Primer uso

No hay registro público. La **primera** vez que abras la app, no habrá ninguna passkey:
verás el botón **«Registrar passkey»**. Al registrarla tomas posesión de la app y el
registro queda cerrado; a partir de ahí sólo aparece **«Entrar con passkey»**.
