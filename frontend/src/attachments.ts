import { api } from './api';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
]);

export function isImageFile(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.has(file.type);
}

/** URL relativa del adjunto (funciona igual en dev y en prod, ver vite.config.ts / _redirects). */
export function attachmentUrl(id: string): string {
  return `/api/attachments/${id}`;
}

/**
 * Sube una imagen a R2 para una nota ya existente: pide una URL firmada al backend y
 * hace el PUT directamente contra R2 (el binario no pasa por Render).
 * Devuelve la URL (relativa) para insertarla en el editor.
 */
export async function uploadImage(notaId: string, file: File): Promise<string> {
  if (!isImageFile(file)) {
    throw new Error(`Tipo de imagen no soportado: ${file.type || 'desconocido'}`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('La imagen supera el tamaño máximo (20MB).');
  }
  const { id, uploadUrl } = await api.createAttachment(notaId, file.name, file.type, file.size);
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!put.ok) {
    throw new Error('Error subiendo la imagen a R2.');
  }
  return attachmentUrl(id);
}
