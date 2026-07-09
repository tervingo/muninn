/**
 * Prueba de humo de la Fase 3 (adjuntos R2). No requiere el backend corriendo: valida
 * directamente las credenciales/endpoint de Cloudflare R2 leídas de backend/.env.
 *
 *   node test/r2-smoke.mjs
 *
 * Flujo: presigned PUT → sube un buffer de prueba → presigned GET → descarga y compara →
 * borra el objeto. Falla con un mensaje claro si faltan variables de entorno o las
 * credenciales/bucket no son válidos.
 */
import 'dotenv/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT } = process.env;
for (const [name, value] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME })) {
  if (!value) throw new Error(`Falta ${name} en backend/.env`);
}

const client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const key = `smoke-test/${Date.now()}.txt`;
const body = `muninn r2 smoke test ${new Date().toISOString()}`;

console.log('Bucket:', R2_BUCKET_NAME, '| Key:', key);

const putUrl = await getSignedUrl(
  client,
  new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, ContentType: 'text/plain' }),
  { expiresIn: 60 },
);
const putRes = await fetch(putUrl, { method: 'PUT', body, headers: { 'Content-Type': 'text/plain' } });
if (!putRes.ok) throw new Error(`PUT falló: ${putRes.status} ${await putRes.text()}`);
console.log('✔ PUT presignado OK');

const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }), {
  expiresIn: 60,
});
const getRes = await fetch(getUrl);
if (!getRes.ok) throw new Error(`GET falló: ${getRes.status} ${await getRes.text()}`);
const downloaded = await getRes.text();
if (downloaded !== body) throw new Error(`Contenido no coincide: "${downloaded}" !== "${body}"`);
console.log('✔ GET presignado OK, contenido verificado');

await client.send(new DeleteObjectsCommand({ Bucket: R2_BUCKET_NAME, Delete: { Objects: [{ Key: key }] } }));
console.log('✔ Objeto de prueba borrado. R2 configurado correctamente.');
