import { useEffect, useState } from 'react';
import { api } from './api';
import type { AuthStatus } from './types';
import { LoginPage } from './pages/LoginPage';
import { NotesPage } from './pages/NotesPage';

export function App() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setStatus(await api.authStatus());
    } catch {
      setError('No se puede conectar con el servidor.');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (error) {
    return (
      <div className="centered">
        <p className="error">{error}</p>
        <button onClick={() => { setError(null); void refresh(); }}>Reintentar</button>
      </div>
    );
  }

  if (!status) {
    return <div className="centered"><p>Cargando…</p></div>;
  }

  if (!status.authenticated) {
    return <LoginPage status={status} onAuthenticated={refresh} />;
  }

  return <NotesPage onLogout={refresh} />;
}
