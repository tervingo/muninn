import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import authRoutes from './auth/routes.js';
import notesRoutes from './routes/notes.js';

const app = express();

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'muninn-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/notes', notesRoutes);

// Manejador de errores genérico
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(config.port, () => {
  console.log(`Muninn backend escuchando en http://localhost:${config.port}`);
  console.log(`CORS permitido para: ${config.frontendUrl}`);
});
