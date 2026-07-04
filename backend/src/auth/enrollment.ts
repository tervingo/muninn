import { query } from '../db.js';

/** Abre la ventana de alta durante `minutes` minutos. Devuelve la marca de caducidad. */
export async function openEnrollment(minutes = 10): Promise<string> {
  const { rows } = await query<{ abierta_hasta: string }>(
    `INSERT INTO enrollment (id, abierta_hasta)
     VALUES (1, now() + make_interval(mins => $1))
     ON CONFLICT (id) DO UPDATE SET abierta_hasta = EXCLUDED.abierta_hasta
     RETURNING abierta_hasta`,
    [minutes],
  );
  return rows[0]!.abierta_hasta;
}

/** Cierra la ventana de alta (tras un registro con éxito o manualmente). */
export async function closeEnrollment(): Promise<void> {
  await query(`UPDATE enrollment SET abierta_hasta = now() - interval '1 second' WHERE id = 1`);
}

export async function isEnrollmentOpen(): Promise<boolean> {
  const { rows } = await query<{ open: boolean }>(
    `SELECT (abierta_hasta > now()) AS open FROM enrollment WHERE id = 1`,
  );
  return rows[0]?.open ?? false;
}
