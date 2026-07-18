import { Router, type Request } from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/types';
import { config } from '../config.js';
import { ah } from '../lib/asyncHandler.js';
import { requireAuth } from './middleware.js';
import {
  getAllCredentials,
  getCredentialByCredentialId,
  countCredentials,
  hasCredential,
  saveCredential,
  updateCounter,
  deleteCredentialById,
} from './credentials.js';
import { openEnrollment, closeEnrollment, isEnrollmentOpen } from './enrollment.js';
import {
  setSessionCookie,
  clearSessionCookie,
  setChallengeCookie,
  readChallenge,
  clearChallengeCookie,
  isAuthenticated,
  mintWsTicket,
} from './tokens.js';

const { rpID, rpName, origin } = config.webauthn;
const router = Router();

function splitTransports(t: string | null): AuthenticatorTransportFuture[] | undefined {
  return t ? (t.split(',') as AuthenticatorTransportFuture[]) : undefined;
}

// Estado de sesión + si ya existe passkey (para decidir registro vs login en el cliente)
router.get(
  '/status',
  ah(async (req, res) => {
    res.json({
      authenticated: isAuthenticated(req),
      hasCredential: await hasCredential(),
      enrollOpen: await isEnrollmentOpen(),
    });
  }),
);

// ¿Se permite registrar una passkey ahora?
//  - No hay ninguna credencial todavía (bootstrap del propietario), o
//  - la petición viene de una sesión activa (añadir passkey desde un dispositivo ya dentro), o
//  - hay una ventana de alta abierta (dispositivo nuevo autorizado desde otro dispositivo).
async function registroPermitido(req: Request): Promise<boolean> {
  if (!(await hasCredential())) return true;
  if (isAuthenticated(req)) return true;
  return isEnrollmentOpen();
}

// --- Registro ---
// La PRIMERA passkey hace "bootstrap". Passkeys adicionales: con sesión activa o con
// una ventana de alta abierta (para dispositivos nuevos de otro ecosistema).

router.post(
  '/register/options',
  ah(async (req, res) => {
    if (!(await registroPermitido(req))) {
      res
        .status(403)
        .json({ error: 'El registro está cerrado. Abre una ventana de alta desde un dispositivo con sesión.' });
      return;
    }

    const existentes = await getAllCredentials();
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: 'owner',
      userID: new TextEncoder().encode('muninn-owner'),
      attestationType: 'none',
      // Evita registrar dos veces el mismo autenticador.
      excludeCredentials: existentes.map((c) => ({
        id: c.credential_id,
        transports: splitTransports(c.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    setChallengeCookie(res, options.challenge);
    res.json(options);
  }),
);

router.post(
  '/register/verify',
  ah(async (req, res) => {
    if (!(await registroPermitido(req))) {
      res.status(403).json({ error: 'El registro está cerrado.' });
      return;
    }

    const expectedChallenge = readChallenge(req);
    if (!expectedChallenge) {
      res.status(400).json({ error: 'Challenge expirado o ausente. Reinicia el registro.' });
      return;
    }

    try {
      const verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ error: 'No se pudo verificar el registro.' });
        return;
      }

      const { credential } = verification.registrationInfo;
      await saveCredential({
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
      });

      clearChallengeCookie(res);
      // Consume la ventana de alta si estaba abierta (limita la exposición a un registro).
      await closeEnrollment();
      // Si era el bootstrap o un alta (no había sesión), autentica ya el dispositivo.
      setSessionCookie(res);
      res.json({ verified: true });
    } catch (err) {
      console.error('Error en register/verify:', err);
      res.status(400).json({ error: 'Registro inválido.' });
    }
  }),
);

// --- Login ---

router.post(
  '/login/options',
  ah(async (_req, res) => {
    const credenciales = await getAllCredentials();
    if (credenciales.length === 0) {
      res.status(400).json({ error: 'No hay ninguna passkey registrada todavía.' });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: credenciales.map((c) => ({
        id: c.credential_id,
        transports: splitTransports(c.transports),
      })),
    });

    setChallengeCookie(res, options.challenge);
    res.json(options);
  }),
);

router.post(
  '/login/verify',
  ah(async (req, res) => {
    const credentialId: string | undefined = req.body?.id;
    if (!credentialId) {
      res.status(400).json({ error: 'Respuesta de autenticación inválida.' });
      return;
    }

    const cred = await getCredentialByCredentialId(credentialId);
    if (!cred) {
      res.status(401).json({ error: 'Credencial no reconocida.' });
      return;
    }

    const expectedChallenge = readChallenge(req);
    if (!expectedChallenge) {
      res.status(400).json({ error: 'Challenge expirado o ausente. Reinicia el login.' });
      return;
    }

    try {
      const verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: cred.credential_id,
          publicKey: cred.public_key,
          counter: Number(cred.counter),
          transports: splitTransports(cred.transports),
        },
      });

      if (!verification.verified) {
        res.status(401).json({ error: 'Autenticación fallida.' });
        return;
      }

      await updateCounter(cred.credential_id, verification.authenticationInfo.newCounter);
      clearChallengeCookie(res);
      setSessionCookie(res);
      res.json({ verified: true });
    } catch (err) {
      console.error('Error en login/verify:', err);
      res.status(401).json({ error: 'Autenticación inválida.' });
    }
  }),
);

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Ticket de corta vida para autenticar el WebSocket de Yjs (ver mintWsTicket).
router.get(
  '/ws-ticket',
  requireAuth,
  ah(async (_req, res) => {
    res.json({ ticket: mintWsTicket() });
  }),
);

// --- Alta de dispositivos nuevos ---

// Abre una ventana de alta (10 min) para que un dispositivo nuevo, sin sesión, pueda
// registrar su passkey. Requiere sesión activa (solo el propietario la abre).
router.post(
  '/enroll/open',
  requireAuth,
  ah(async (_req, res) => {
    const abierta_hasta = await openEnrollment(10);
    res.json({ abierta_hasta });
  }),
);

// --- Gestión de dispositivos (passkeys), requiere sesión ---

router.get(
  '/credentials',
  requireAuth,
  ah(async (_req, res) => {
    const creds = await getAllCredentials();
    res.json(
      creds.map((c) => ({
        id: c.id,
        transports: c.transports,
        creado_en: c.creado_en,
      })),
    );
  }),
);

router.delete(
  '/credentials/:id',
  requireAuth,
  ah(async (req, res) => {
    // No permitir borrar la última: dejaría el registro abierto al público de nuevo.
    if ((await countCredentials()) <= 1) {
      res
        .status(400)
        .json({ error: 'No puedes eliminar la única passkey. Registra otra antes de borrar ésta.' });
      return;
    }
    const borrada = await deleteCredentialById(req.params.id);
    if (!borrada) {
      res.status(404).json({ error: 'Passkey no encontrada.' });
      return;
    }
    res.status(204).end();
  }),
);

export default router;
