import { config } from '../config.js';
import { query } from '../db.js';
import type { DocNode } from '../types.js';

const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';
// Debe coincidir con `embedding vector(1024)` en schema.sql.
const OUTPUT_DIMENSION = 1024;

interface VoyageEmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/** Extrae el texto plano de un documento TipTap/ProseMirror (concatena los nodos de texto). */
export function extractPlainText(doc: DocNode | null | undefined): string {
  const parts: string[] = [];

  function walk(node: DocNode | undefined): void {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') parts.push(node.text);
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  }

  walk(doc ?? undefined);
  return parts.join(' ').trim();
}

/**
 * Genera el embedding de un texto con Voyage AI.
 * `inputType` sigue la recomendación de Voyage para mejorar la calidad del retrieval:
 * 'document' al indexar contenido de notas, 'query' al embeder una búsqueda (T6.3).
 *
 * Reintenta ante 429 (rate limit) con backoff: las cuentas sin método de pago están
 * limitadas a 3 req/min, así que un lote de notas guardándose seguidas lo dispara con
 * normalidad aunque queden tokens gratis de sobra.
 */
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generarEmbedding(
  texto: string,
  inputType: 'document' | 'query' = 'document',
): Promise<number[]> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.voyage.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texto,
        model: config.voyage.model,
        input_type: inputType,
        output_dimension: OUTPUT_DIMENSION,
      }),
    });

    if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) break;

    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_DELAY_MS;
    console.warn(`[embeddings] 429 de Voyage AI, reintentando en ${waitMs}ms (intento ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`);
    await sleep(waitMs);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage AI respondió ${res.status}: ${body}`);
  }

  const json = (await res.json()) as VoyageEmbeddingsResponse;
  const embedding = json.data[0]?.embedding;
  if (!embedding) {
    throw new Error('Voyage AI no devolvió ningún embedding');
  }
  return embedding;
}

/** Formatea un embedding como literal `vector` de Postgres (`[0.1,0.2,...]`). */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/** Inversa de `toVectorLiteral`: parsea el texto que devuelve `pg` para una columna `vector`. */
export function parseVectorLiteral(literal: string): number[] {
  return literal.slice(1, -1).split(',').map(Number);
}

/**
 * Recalcula y persiste el embedding de una nota a partir de su contenido.
 * Pensada para llamarse "fire-and-forget" (no bloquea guardado ni respuesta al
 * cliente): captura sus propios errores y los loguea en vez de propagarlos.
 * Notas sin texto (vacías) se dejan sin embedding en lugar de llamar a la API.
 */
export async function actualizarEmbeddingNota(notaId: string, contenido: DocNode): Promise<void> {
  try {
    const texto = extractPlainText(contenido);
    if (!texto) return;

    const embedding = await generarEmbedding(texto, 'document');
    await query('UPDATE notas SET embedding = $1::vector WHERE id = $2', [
      toVectorLiteral(embedding),
      notaId,
    ]);
  } catch (err) {
    console.error(`[embeddings] error actualizando embedding de la nota ${notaId}:`, err);
  }
}
