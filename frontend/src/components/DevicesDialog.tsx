import { useEffect, useState } from 'react';
import { api } from '../api';
import { registerPasskey } from '../auth';
import type { PasskeyDevice } from '../types';

interface Props {
  onClose: () => void;
}

export function DevicesDialog({ onClose }: Props) {
  const [devices, setDevices] = useState<PasskeyDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setDevices(await api.listDevices());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los dispositivos.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la passkey.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta passkey? No podrás usarla para entrar.')) return;
    setError(null);
    try {
      await api.deleteDevice(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Dispositivos (passkeys)</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <p className="hint">
          Registra una passkey en cada dispositivo desde el que quieras entrar
          (Windows Hello, Face ID en iPhone, Touch ID en iPad…).
        </p>

        <ul className="device-list">
          {devices.map((d) => (
            <li key={d.id}>
              <div>
                <div className="device-transport">{d.transports || 'passkey'}</div>
                <div className="muted">Registrada: {fmt(d.creado_en)}</div>
              </div>
              <button
                className="danger"
                onClick={() => remove(d.id)}
                disabled={devices.length <= 1}
                title={devices.length <= 1 ? 'No puedes borrar la única passkey' : 'Eliminar'}
              >
                Eliminar
              </button>
            </li>
          ))}
          {devices.length === 0 && <li className="muted">Sin dispositivos.</li>}
        </ul>

        {error && <p className="error">{error}</p>}

        <button className="primary" disabled={busy} onClick={add}>
          {busy ? 'Registrando…' : '+ Añadir passkey en este dispositivo'}
        </button>
      </div>
    </div>
  );
}
