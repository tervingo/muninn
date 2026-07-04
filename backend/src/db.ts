import pg from 'pg';
import { config } from './config.js';

// Neon requiere SSL. `rejectUnauthorized: false` es suficiente para el plan gratuito.
const needsSsl = /neon\.tech|sslmode=require/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as any[]);
}
