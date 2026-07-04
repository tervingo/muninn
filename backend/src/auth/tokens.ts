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
