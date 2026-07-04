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
import {
  getCredential,
  hasCredential,
  saveCredential,
  updateCounter,
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

// --- Registro (bootstrap: sólo se permite si NO existe ya una credencial) ---

router.post(
  '/register/options',
  ah(async (_req, res) => {
    if (await hasCredential()) {
      res
        .status(403)
        .json({ error: 'Ya existe una passkey registrada. El registro está cerrado.' });
      return;
    }

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: 'owner',
      userID: new TextEncoder().encode('muninn-owner'),
      attestationType: 'none',
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
    if (await hasCredential()) {
      res.status(403).json({ error: 'Ya existe una passkey registrada.' });
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
    const cred = await getCredential();
    if (!cred) {
      res.status(400).json({ error: 'No hay ninguna passkey registrada todavía.' });
      return;
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: [
        {
          id: cred.credential_id,
          transports: cred.transports
            ? (cred.transports.split(',') as AuthenticatorTransportFuture[])
            : undefined,
        },
      ],
    });

    setChallengeCookie(res, options.challenge);
    res.json(options);
  }),
);

router.post(
  '/login/verify',
  ah(async (req, res) => {
    const cred = await getCredential();
    if (!cred) {
      res.status(400).json({ error: 'No hay ninguna passkey registrada.' });
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
          transports: cred.transports
            ? (cred.transports.split(',') as AuthenticatorTransportFuture[])
            : undefined,
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

export default router;
