import type { Request, Response, NextFunction } from 'express';
import { isAuthenticated } from './tokens.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  next();
}
