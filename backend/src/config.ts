import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  webauthn: {
    rpID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    rpName: process.env.WEBAUTHN_RP_NAME ?? 'Muninn',
    origin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:5173',
  },
  sessionSecret: required('SESSION_SECRET'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  isProd: process.env.NODE_ENV === 'production',
  r2: {
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    bucket: required('R2_BUCKET_NAME'),
    endpoint: process.env.R2_ENDPOINT ?? `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  },
};
