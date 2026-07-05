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

-- Adjuntos multimedia (fase 3, definido ya para no romper el esquema más adelante)
CREATE TABLE IF NOT EXISTS adjuntos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id UUID NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,               -- 'imagen' | 'audio' | 'video'
  url TEXT NOT NULL,
  nombre_original TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
