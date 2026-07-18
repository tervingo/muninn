import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Haiku 4.5 es de sobra para RAG con contexto ya bien recuperado por la búsqueda
// semántica (T6.3): la tarea es "responde con esto delante", no razonamiento
// abierto. Precio marginal por pregunta, ver estimación en la conversación.
const MODEL = 'claude-haiku-4-5';
const MAX_EXCERPT_CHARS = 1500;

const ChatAnswerSchema = z.object({
  respuesta: z.string(),
  notas_citadas: z.array(z.string()),
});

export interface NotaContexto {
  id: string;
  titulo: string;
  texto: string;
  tags: string[];
}

function truncar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

const SYSTEM_PROMPT = `Eres el asistente de Muninn, una app de notas personal.
Respondes preguntas usando ÚNICAMENTE la información de los extractos de notas
proporcionados a continuación — no uses conocimiento externo ni inventes información.
Las etiquetas de cada nota son metadatos de categoría (tema, idioma, proyecto…): úsalas
como contexto para interpretar la nota, pero la respuesta debe basarse en el texto.

Si los extractos no contienen información suficiente para responder, dilo
explícitamente en vez de inventar una respuesta.

Responde en español, de forma breve y directa. En "notas_citadas" incluye solo
los ids (tal cual aparecen entre corchetes) de las notas que realmente hayas
usado para construir la respuesta — puede quedar vacío si ninguna sirvió.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string' },
    notas_citadas: { type: 'array', items: { type: 'string' } },
  },
  required: ['respuesta', 'notas_citadas'],
  additionalProperties: false,
};

/**
 * Responde una pregunta a partir de extractos de notas ya recuperados por
 * similitud semántica. Devuelve la respuesta y los ids de las notas que Claude
 * dice haber usado, filtrados contra las notas realmente proporcionadas (nunca
 * se devuelve un id que no estuviera en `notas`).
 */
export async function responderPregunta(
  pregunta: string,
  notas: NotaContexto[],
): Promise<{ respuesta: string; idsUsados: string[] }> {
  const contexto = notas
    .map((n) => {
      const etiquetas = n.tags.length ? ` — Etiquetas: ${n.tags.map((t) => `#${t}`).join(', ')}` : '';
      return `[id: ${n.id}] Título: "${n.titulo}"${etiquetas}\n${truncar(n.texto, MAX_EXCERPT_CHARS)}`;
    })
    .join('\n\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Notas disponibles:\n\n${contexto}\n\nPregunta: ${pregunta}`,
      },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
    },
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) {
    throw new Error('Claude no devolvió una respuesta de texto.');
  }

  const parsed = ChatAnswerSchema.parse(JSON.parse(textBlock.text));

  const idsValidos = new Set(notas.map((n) => n.id));
  const idsUsados = parsed.notas_citadas.filter((id) => idsValidos.has(id));

  return { respuesta: parsed.respuesta, idsUsados };
}
