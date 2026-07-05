import { useState } from 'react';
import { api } from '../api';
import {
  markdownToDoc,
  stripFrontmatter,
  normalizeTag,
  disposeMarkdownEditor,
} from '../import/markdown';
import type { NoteContent } from '../types';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Phase = 'pick' | 'working' | 'done' | 'error';
const CHUNK = 100;

export function ImportDialog({ onClose, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [step, setStep] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [imported, setImported] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const all = Array.from(fileList);
    const mdFiles = all.filter((f) => f.name.toLowerCase().endsWith('.md'));
    const skippedCount = all.length - mdFiles.length;
    setSkipped(skippedCount);

    if (mdFiles.length === 0) {
      setError('No se han encontrado archivos .md en la carpeta.');
      setPhase('error');
      return;
    }

    setPhase('working');
    setStep('Convirtiendo notas…');
    setProgress({ done: 0, total: mdFiles.length });

    try {
      const notas: Array<{ titulo: string; contenido: NoteContent; tags: string[] }> = [];
      for (let i = 0; i < mdFiles.length; i++) {
        const f = mdFiles[i]!;
        const parts = (f.webkitRelativePath || f.name).split('/');
        const filename = parts[parts.length - 1]!;
        const titulo = filename.replace(/\.md$/i, '').trim() || 'Sin título';
        // Todas las carpetas de la ruta (incluida la carpeta raíz seleccionada) → una
        // etiqueta por nivel, más "obsidian" para todas las notas importadas.
        const folderTags = parts.slice(0, -1).map(normalizeTag).filter(Boolean);
        const tags = [...new Set(['obsidian', ...folderTags])];
        const text = stripFrontmatter(await f.text());
        notas.push({ titulo, contenido: markdownToDoc(text), tags });
        setProgress({ done: i + 1, total: mdFiles.length });
      }

      setStep('Guardando en el servidor…');
      let total = 0;
      for (let i = 0; i < notas.length; i += CHUNK) {
        const res = await api.importNotes(notas.slice(i, i + CHUNK));
        total += res.imported;
        setImported(total);
      }

      disposeMarkdownEditor();
      setPhase('done');
      onImported();
    } catch (e) {
      disposeMarkdownEditor();
      setError(e instanceof Error ? e.message : 'Error durante la importación.');
      setPhase('error');
    }
  };

  return (
    <div className="modal-overlay" onClick={phase === 'working' ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Importar de Obsidian</h2>
          {phase !== 'working' && (
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          )}
        </div>

        {phase === 'pick' && (
          <>
            <p className="hint">
              Selecciona la carpeta de tu vault. Cada nota <code>.md</code> se importa con el
              título del archivo y una etiqueta por cada carpeta de su ruta. El frontmatter se
              elimina; los <code>[[wikilinks]]</code> se conservan como texto (siguen generando
              backlinks).
            </p>
            <label className="primary import-pick">
              Seleccionar carpeta del vault
              <input
                type="file"
                multiple
                style={{ display: 'none' }}
                ref={(el) => {
                  if (el) {
                    el.setAttribute('webkitdirectory', '');
                    el.setAttribute('directory', '');
                  }
                }}
                onChange={(e) => void handleFiles(e.target.files)}
              />
            </label>
          </>
        )}

        {phase === 'working' && (
          <>
            <p className="hint">{step}</p>
            {progress.total > 0 && (
              <p className="import-progress">
                {progress.done} / {progress.total} notas
              </p>
            )}
            <p className="muted">No cierres esta ventana.</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <p>
              ✅ Importadas <strong>{imported}</strong> notas
              {skipped > 0 && <> · {skipped} archivos no-.md omitidos</>}.
            </p>
            <button className="primary" onClick={onClose}>
              Hecho
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="error">{error}</p>
            <button onClick={onClose}>Cerrar</button>
          </>
        )}
      </div>
    </div>
  );
}
