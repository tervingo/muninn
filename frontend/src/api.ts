import type {
  AuthStatus,
  Backlink,
  Note,
  NoteContent,
  NoteSummary,
  PasskeyDevice,
  TagCount,
} from './types';

// En producción usamos rutas relativas (mismo origen) para pasar por el proxy /api de
// Netlify → cookies first-party. En dev, el backend está en localhost:3000.
// VITE_API_URL (si se define) tiene prioridad sobre ambos.
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  registerOptions: () => request<any>('/api/auth/register/options', { method: 'POST' }),
  registerVerify: (body: unknown) =>
    request<{ verified: boolean }>('/api/auth/register/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  loginOptions: () => request<any>('/api/auth/login/options', { method: 'POST' }),
  loginVerify: (body: unknown) =>
    request<{ verified: boolean }>('/api/auth/login/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  openEnrollment: () =>
    request<{ abierta_hasta: string }>('/api/auth/enroll/open', { method: 'POST' }),
  listDevices: () => request<PasskeyDevice[]>('/api/auth/credentials'),
  deleteDevice: (id: string) =>
    request<void>(`/api/auth/credentials/${id}`, { method: 'DELETE' }),

  // Notas
  listNotes: (archivadas = false, tags: string[] = []) => {
    const qs = new URLSearchParams({ archivadas: String(archivadas) });
    if (tags.length) qs.set('tags', tags.join(','));
    return request<NoteSummary[]>(`/api/notes?${qs.toString()}`);
  },
  listTags: () => request<TagCount[]>('/api/notes/tags'),
  importNotes: (notas: Array<{ titulo: string; contenido: NoteContent; tags: string[] }>) =>
    request<{ imported: number }>('/api/notes/import', {
      method: 'POST',
      body: JSON.stringify({ notas }),
    }),
  getNote: (id: string) => request<Note>(`/api/notes/${id}`),
  getBacklinks: (id: string) => request<Backlink[]>(`/api/notes/${id}/backlinks`),
  createNote: (titulo: string, contenido?: NoteContent) =>
    request<Note>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ titulo, contenido }),
    }),
  updateNote: (
    id: string,
    patch: Partial<{ titulo: string; contenido: NoteContent; archivada: boolean; tags: string[] }>,
  ) =>
    request<Note>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteNote: (id: string) => request<void>(`/api/notes/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids: string[]) =>
    request<{ deleted: number }>('/api/notes/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};
