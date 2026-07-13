-- Esquema Muninn — Fase 1 (MVP)
-- Idempotente: se puede ejecutar varias veces sin error.

-- Notas
CREATE TABLE IF NOT EXISTS notas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  contenido JSONB NOT NULL,        -- documento TipTap/ProseMirror en JSON
  yjs_state BYTEA,                 -- estado binario Yjs (fase 2, nullable en fase 1)
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  archivada BOOLEAN NOT NULL DEFAULT false
);

-- Etiquetas de la nota (metadatos, no forman parte del documento Yjs).
ALTER TABLE notas ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Búsqueda/orden por título (los wikilinks resuelven por título, case-insensitive)
CREATE INDEX IF NOT EXISTS idx_notas_titulo_lower ON notas (lower(titulo));
CREATE INDEX IF NOT EXISTS idx_notas_actualizado ON notas (actualizado_en DESC);
-- Búsqueda por etiquetas (operadores de arrays @> / &&)
CREATE INDEX IF NOT EXISTS idx_notas_tags ON notas USING GIN (tags);

-- Enlaces entre notas (para backlinks y grafo)
CREATE TABLE IF NOT EXISTS enlaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_origen_id UUID NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  nota_destino_id UUID NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nota_origen_id, nota_destino_id)
);

CREATE INDEX IF NOT EXISTS idx_enlaces_destino ON enlaces (nota_destino_id);
CREATE INDEX IF NOT EXISTS idx_enlaces_origen ON enlaces (nota_origen_id);

-- Adjuntos multimedia (fase 3). Bucket R2 privado: `url` guarda la CLAVE del objeto
-- (no una URL pública); la lectura pasa siempre por GET /api/attachments/:id, que
-- genera una URL firmada de corta duración.
CREATE TABLE IF NOT EXISTS adjuntos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id UUID NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,               -- 'imagen' | 'audio' | 'video'
  url TEXT NOT NULL,                -- clave del objeto en R2
  nombre_original TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE adjuntos ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE adjuntos ADD COLUMN IF NOT EXISTS tamano_bytes BIGINT;
CREATE INDEX IF NOT EXISTS idx_adjuntos_nota ON adjuntos (nota_id);

-- Ventana de alta de dispositivos: permite que un dispositivo nuevo (sin sesión)
-- registre su passkey mientras el propietario la mantiene abierta desde otro dispositivo.
-- Fila única (id=1) con la marca temporal hasta la que el alta está permitida.
CREATE TABLE IF NOT EXISTS enrollment (
  id INT PRIMARY KEY DEFAULT 1,
  abierta_hasta TIMESTAMPTZ,
  CONSTRAINT enrollment_singleton CHECK (id = 1)
);

-- Credenciales passkey (WebAuthn)
CREATE TABLE IF NOT EXISTS credenciales_passkey (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id TEXT UNIQUE NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT,                  -- lista de transports separados por coma (opcional)
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Búsqueda semántica (fase 6). Embeddings de `contenido` generados con Voyage AI
-- (voyage-4 / voyage-4-lite, dimensión 1024 por defecto). Nulo hasta el primer
-- debounce de guardado (o hasta que corra el backfill sobre notas ya existentes).
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE notas ADD COLUMN IF NOT EXISTS embedding vector(1024);
CREATE INDEX IF NOT EXISTS idx_notas_embedding ON notas USING hnsw (embedding vector_cosine_ops);

-- Mapa semántico (fase 6, T6.4): posición 2D (UMAP) y cluster (k-means) precalculados
-- por `backend/scripts/cluster-notes.ts` (ejecución manual, no cron) a partir del
-- embedding — se persiste para no recalcular en cada carga de la UI.
CREATE TABLE IF NOT EXISTS mapa_notas (
  nota_id UUID PRIMARY KEY REFERENCES notas(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL,
  cluster_id INT NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
