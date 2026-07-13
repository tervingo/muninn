import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MapPoint } from '../types';

interface Props {
  onClose: () => void;
  onSelectNote: (id: string) => void;
}

// Mismo orden fijo de la paleta categórica validada contra el fondo oscuro de Muninn
// (ver skill de dataviz) — nunca se ciclan colores más allá de los grupos definidos
// por el script de clustering (máx. 8, ver backend/scripts/cluster-notes.ts).
const CLUSTER_COLORS = [
  'var(--cluster-1)',
  'var(--cluster-2)',
  'var(--cluster-3)',
  'var(--cluster-4)',
  'var(--cluster-5)',
  'var(--cluster-6)',
  'var(--cluster-7)',
  'var(--cluster-8)',
];

const MARGIN = 8; // unidades del viewBox 0-100, para que los puntos de borde no queden pegados

export function MapView({ onClose, onSelectNote }: Props) {
  const [points, setPoints] = useState<MapPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMap()
      .then(setPoints)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error cargando el mapa.'));
  }, []);

  const clusters = points ? [...new Set(points.map((p) => p.cluster_id))].sort((a, b) => a - b) : [];

  const xs = points?.map((p) => p.x) ?? [];
  const ys = points?.map((p) => p.y) ?? [];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scaled =
    points?.map((p) => ({
      ...p,
      sx: MARGIN + ((p.x - minX) / rangeX) * (100 - 2 * MARGIN),
      sy: MARGIN + ((p.y - minY) / rangeY) * (100 - 2 * MARGIN),
    })) ?? [];

  const open = (id: string) => {
    onSelectNote(id);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal map-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Mapa semántico</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        {!error && !points && <p className="hint">Cargando…</p>}
        {!error && points && points.length === 0 && (
          <p className="hint">
            Aún no hay mapa generado. Ejecuta <code>npm run cluster-notes</code> en el backend
            (necesita al menos unas pocas notas con embedding).
          </p>
        )}
        {!error && points && points.length > 0 && (
          <>
            <svg className="map-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
              {scaled.map((p) => (
                <circle
                  key={p.id}
                  className="map-point"
                  cx={p.sx}
                  cy={p.sy}
                  r={1.4}
                  fill={CLUSTER_COLORS[p.cluster_id % CLUSTER_COLORS.length]}
                  onClick={() => open(p.id)}
                >
                  <title>{p.titulo || 'Sin título'}</title>
                </circle>
              ))}
            </svg>
            <div className="map-legend">
              {clusters.map((c) => (
                <span key={c} className="map-legend-item">
                  <span
                    className="map-legend-swatch"
                    style={{ background: CLUSTER_COLORS[c % CLUSTER_COLORS.length] }}
                  />
                  Grupo {c + 1}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
