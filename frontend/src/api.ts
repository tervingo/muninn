import type {
  AuthStatus,
  Backlink,
  Note,
  NoteContent,
  NoteSummary,
} from './types';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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

  // Notas
  listNotes: (archivadas = false) =>
    request<NoteSummary[]>(`/api/notes?archivadas=${archivadas}`),
  getNote: (id: string) => request<Note>(`/api/notes/${id}`),
  getBacklinks: (id: string) => request<Backlink[]>(`/api/notes/${id}/backlinks`),
  createNote: (titulo: string, contenido?: NoteContent) =>
    request<Note>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ titulo, contenido }),
    }),
  updateNote: (
    id: string,
    patch: Partial<{ titulo: string; contenido: NoteContent; archivada: boolean }>,
  ) =>
    request<Note>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteNote: (id: string) => request<void>(`/api/notes/${id}`, { method: 'DELETE' }),
};
