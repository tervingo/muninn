import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api } from './api';

/** Registra la primera (y única) passkey del propietario. */
export async function registerPasskey(): Promise<void> {
  const options = await api.registerOptions();
  const attResp = await startRegistration({ optionsJSON: options });
  const result = await api.registerVerify(attResp);
  if (!result.verified) throw new Error('No se pudo verificar el registro.');
}

/** Autentica con la passkey registrada. */
export async function loginPasskey(): Promise<void> {
  const options = await api.loginOptions();
  const authResp = await startAuthentication({ optionsJSON: options });
  const result = await api.loginVerify(authResp);
  if (!result.verified) throw new Error('Autenticación fallida.');
}
