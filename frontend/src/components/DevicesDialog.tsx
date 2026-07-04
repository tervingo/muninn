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
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);

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

  const openEnroll = async () => {
    setError(null);
    setEnrollMsg(null);
    try {
      const { abierta_hasta } = await api.openEnrollment();
      const hasta = new Date(abierta_hasta).toLocaleTimeString();
      setEnrollMsg(
        `Ventana de alta abierta hasta las ${hasta}. En el dispositivo nuevo (iPhone/iPad), ` +
          `abre la app y pulsa «Registrar este dispositivo». Si ya la tenías abierta, refréscala.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la ventana de alta.');
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
        {enrollMsg && <p className="hint enroll-msg">{enrollMsg}</p>}

        <button className="primary" disabled={busy} onClick={add}>
          {busy ? 'Registrando…' : '+ Añadir passkey en este dispositivo'}
        </button>

        <hr className="modal-sep" />
        <p className="hint">
          ¿Añadir un dispositivo de otro tipo (p. ej. iPhone/iPad desde Windows)? Abre una
          ventana de alta y regístralo desde ese dispositivo:
        </p>
        <button className="secondary" onClick={openEnroll}>
          Permitir añadir un dispositivo nuevo (10 min)
        </button>
      </div>
    </div>
  );
}
