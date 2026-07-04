import { query } from '../db.js';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';

export interface StoredCredential {
  credential_id: string; // base64url
  public_key: Buffer;
  counter: string; // bigint viene como string desde pg
  transports: string | null;
}

/** Devuelve la única credencial registrada, o null si aún no hay ninguna. */
export async function getCredential(): Promise<StoredCredential | null> {
  const { rows } = await query<StoredCredential>(
    'SELECT credential_id, public_key, counter, transports FROM credenciales_passkey LIMIT 1',
  );
  return rows[0] ?? null;
}

export async function hasCredential(): Promise<boolean> {
  const { rows } = await query<{ n: string }>('SELECT count(*)::int AS n FROM credenciales_passkey');
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function saveCredential(params: {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}): Promise<void> {
  await query(
    `INSERT INTO credenciales_passkey (credential_id, public_key, counter, transports)
     VALUES ($1, $2, $3, $4)`,
    [
      params.credentialId,
      Buffer.from(params.publicKey),
      params.counter,
      params.transports?.join(',') ?? null,
    ],
  );
}

export async function updateCounter(credentialId: string, counter: number): Promise<void> {
  await query('UPDATE credenciales_passkey SET counter = $1 WHERE credential_id = $2', [
    counter,
    credentialId,
  ]);
}
