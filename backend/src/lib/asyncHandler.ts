import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Envuelve un handler async para que los rechazos de promesa se deriven al
 * middleware de errores de Express en lugar de convertirse en un
 * `unhandledRejection` que tumbe el proceso (Express 4 no lo hace solo).
 */
export function ah(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
