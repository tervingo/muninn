import { useState } from 'react';
import { loginPasskey, registerPasskey } from '../auth';
import type { AuthStatus } from '../types';

interface Props {
  status: AuthStatus;
  onAuthenticated: () => void;
}

export function LoginPage({ status, onAuthenticated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onAuthenticated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ha ocurrido un error.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centered login">
      <h1>Muninn</h1>
      <p className="subtitle">Tus notas, enlazadas.</p>

      {status.hasCredential ? (
        <>
          <button disabled={busy} onClick={() => run(loginPasskey)}>
            {busy ? 'Autenticando…' : 'Entrar con passkey'}
          </button>
          <p className="hint">Usa Face ID, Touch ID o Windows Hello.</p>

          {status.enrollOpen && (
            <>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => run(() => registerPasskey())}
              >
                {busy ? 'Registrando…' : 'Registrar este dispositivo'}
              </button>
              <p className="hint">
                Hay una ventana de alta abierta. Registra la passkey de este dispositivo
                (Face ID / Touch ID).
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <button disabled={busy} onClick={() => run(() => registerPasskey())}>
            {busy ? 'Registrando…' : 'Registrar passkey'}
          </button>
          <p className="hint">
            Aún no hay ninguna passkey. Registra la tuya para tomar posesión de la app.
          </p>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
