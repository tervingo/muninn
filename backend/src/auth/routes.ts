import { Router } from 'express';
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
import {
  setSessionCookie,
  clearSessionCookie,
  setChallengeCookie,
  readChallenge,
  clearChallengeCookie,
  isAuthenticated,
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
    });
  }),
);

// --- Registro ---
// La PRIMERA passkey hace "bootstrap" (registro abierto). Registrar passkeys
// ADICIONALES (otros dispositivos) requiere tener ya una sesión activa.

router.post(
  '/register/options',
  ah(async (req, res) => {
    const yaHayCredencial = await hasCredential();
    if (yaHayCredencial && !isAuthenticated(req)) {
      res
        .status(403)
        .json({ error: 'El registro está cerrado. Inicia sesión para añadir un dispositivo.' });
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
    const yaHayCredencial = await hasCredential();
    if (yaHayCredencial && !isAuthenticated(req)) {
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
      // Si era el bootstrap (no había sesión), autentica ya. Si añadía dispositivo, mantiene sesión.
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
