import jwt from 'jsonwebtoken';
import type { Response, Request } from 'express';
import { config } from '../config.js';

const SESSION_COOKIE = 'muninn_session';
const CHALLENGE_COOKIE = 'muninn_challenge';

const baseCookie = {
  httpOnly: true as const,
  secure: config.cookieSecure,
  sameSite: config.cookieSecure ? ('none' as const) : ('lax' as const),
  path: '/',
};

// --- Cookie de sesión autenticada (larga duración, sobrevive a cold starts) ---

export function setSessionCookie(res: Response): void {
  const token = jwt.sign({ sub: 'owner' }, config.sessionSecret, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, { ...baseCookie, maxAge: 30 * 24 * 60 * 60 * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseCookie);
}

export function isAuthenticated(req: Request): boolean {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return false;
  try {
    jwt.verify(token, config.sessionSecret);
    return true;
  } catch {
    return false;
  }
}

// --- Ticket de corta vida para el WebSocket de Yjs ---
//
// En producción el WS conecta DIRECTO a Render (WS_BASE en el frontend), sin pasar por
// el proxy /api de Netlify que hace que la cookie de sesión sea first-party — así que
// esa cookie nunca llega al `upgrade` del WebSocket (dominio distinto). En su lugar, el
// cliente pide este ticket por REST (sí autenticado, vía la cookie normal) y lo manda
// como query param al abrir el WebSocket.
//
// 12h porque `y-websocket` fija la URL de conexión (con el ticket ya dentro) una vez, al
// crear el provider, y la reutiliza tal cual en cada reintento de reconexión — si el
// ticket caduca a media sesión, las reconexiones fallan en silencio hasta que se reabre
// la nota (lo que pide un ticket nuevo). Con 12h eso solo pasa si una pestaña queda
// abierta y desconectada más de medio día seguido.
const WS_TICKET_TTL = '12h';

export function mintWsTicket(): string {
  return jwt.sign({ purpose: 'ws' }, config.sessionSecret, { expiresIn: WS_TICKET_TTL });
}

export function verifyWsTicket(ticket: string | undefined | null): boolean {
  if (!ticket) return false;
  try {
    const payload = jwt.verify(ticket, config.sessionSecret);
    return typeof payload === 'object' && payload !== null && (payload as { purpose?: string }).purpose === 'ws';
  } catch {
    return false;
  }
}

// --- Cookie de challenge (corta duración, durante la ceremonia WebAuthn) ---

export function setChallengeCookie(res: Response, challenge: string): void {
  const token = jwt.sign({ challenge }, config.sessionSecret, { expiresIn: '5m' });
  res.cookie(CHALLENGE_COOKIE, token, { ...baseCookie, maxAge: 5 * 60 * 1000 });
}

export function readChallenge(req: Request): string | null {
  const token = req.cookies?.[CHALLENGE_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.sessionSecret) as { challenge?: string };
    return payload.challenge ?? null;
  } catch {
    return null;
  }
}

export function clearChallengeCookie(res: Response): void {
  res.clearCookie(CHALLENGE_COOKIE, baseCookie);
}
