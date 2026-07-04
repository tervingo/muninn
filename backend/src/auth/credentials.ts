import { query } from '../db.js';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';

export interface StoredCredential {
  id: string; // uuid (PK)
  credential_id: string; // base64url
  public_key: Buffer;
  counter: string; // bigint viene como string desde pg
  transports: string | null;
  creado_en: string;
}

/** Todas las credenciales registradas (el propietario puede tener varias, una por dispositivo). */
export async function getAllCredentials(): Promise<StoredCredential[]> {
  const { rows } = await query<StoredCredential>(
    `SELECT id, credential_id, public_key, counter, transports, creado_en
     FROM credenciales_passkey
     ORDER BY creado_en`,
  );
  return rows;
}

/** Busca una credencial por su credential_id (base64url), o null. */
export async function getCredentialByCredentialId(
  credentialId: string,
): Promise<StoredCredential | null> {
  const { rows } = await query<StoredCredential>(
    `SELECT id, credential_id, public_key, counter, transports, creado_en
     FROM credenciales_passkey WHERE credential_id = $1`,
    [credentialId],
  );
  return rows[0] ?? null;
}

export async function countCredentials(): Promise<number> {
  const { rows } = await query<{ n: string }>('SELECT count(*)::int AS n FROM credenciales_passkey');
  return Number(rows[0]?.n ?? 0);
}

export async function hasCredential(): Promise<boolean> {
  return (await countCredentials()) > 0;
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

/** Borra una credencial por su uuid. Devuelve true si se borró alguna. */
export async function deleteCredentialById(id: string): Promise<boolean> {
  const { rowCount } = await query('DELETE FROM credenciales_passkey WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}
