import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const client = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

const UPLOAD_URL_TTL = 300; // segundos para completar la subida (PUT directo del navegador a R2)
const DOWNLOAD_URL_TTL = 300; // segundos de validez de la URL firmada de lectura (se regenera en cada GET)

export function presignUpload(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: config.r2.bucket, Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL },
  );
}

export function presignDownload(key: string): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }), {
    expiresIn: DOWNLOAD_URL_TTL,
  });
}

/** Borrado best-effort de objetos en R2 (hasta 1000 claves por llamada). */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await client.send(
    new DeleteObjectsCommand({
      Bucket: config.r2.bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
}
