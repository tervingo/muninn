import { useState } from 'react';
import { api } from '../api';
import type { ChatResponse } from '../types';

interface Props {
  onClose: () => void;
  onSelectNote: (id: string) => void;
}

interface Turno {
  pregunta: string;
  respuesta: string;
  notas: ChatResponse['notas'];
}

export function ChatView({ onClose, onSelectNote }: Props) {
  const [pregunta, setPregunta] = useState('');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async () => {
    const texto = pregunta.trim();
    if (!texto || enviando) return;
    setPregunta('');
    setEnviando(true);
    setError(null);
    try {
      const res = await api.chat(texto);
      setTurnos((t) => [...t, { pregunta: texto, respuesta: res.respuesta, notas: res.notas }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al preguntar.');
    } finally {
      setEnviando(false);
    }
  };

  const abrirNota = (id: string) => {
    onSelectNote(id);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal chat-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Preguntar a tus notas</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="chat-messages">
          {turnos.length === 0 && !enviando && (
            <p className="hint">
              Pregunta algo sobre tus notas — responde solo con lo que encuentre en ellas.
            </p>
          )}
          {turnos.map((t, i) => (
            <div key={i} className="chat-turn">
              <p className="chat-question">{t.pregunta}</p>
              <p className="chat-answer">{t.respuesta}</p>
              {t.notas.length > 0 && (
                <div className="chat-sources">
                  {t.notas.map((n) => (
                    <button key={n.id} className="link" onClick={() => abrirNota(n.id)}>
                      {n.titulo}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {enviando && <p className="hint">Pensando…</p>}
          {error && <p className="error">{error}</p>}
        </div>

        <div className="chat-input-row">
          <input
            type="text"
            placeholder="Pregunta algo…"
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void enviar();
            }}
            disabled={enviando}
          />
          <button disabled={!pregunta.trim() || enviando} onClick={() => void enviar()}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
