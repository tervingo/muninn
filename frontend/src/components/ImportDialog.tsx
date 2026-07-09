import { useState } from 'react';
import { api } from '../api';
import { uploadImage } from '../attachments';
import {
  markdownToDoc,
  stripFrontmatter,
  normalizeTag,
  disposeMarkdownEditor,
  resolveImageEmbeds,
  collectPendingImageEmbeds,
  resolveImageEmbedRefs,
} from '../import/markdown';
import type { NoteContent } from '../types';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Phase = 'pick' | 'working' | 'done' | 'error';
const CHUNK = 100;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

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

    // Mapa de imágenes del vault por nombre de archivo (en minúsculas). Si hay nombres
    // duplicados en carpetas distintas, gana el último — asunción razonable para un vault
    // personal, donde los adjuntos suelen tener nombres únicos.
    const imageFiles = new Map<string, File>();
    for (const f of all) {
      if (IMAGE_EXT_RE.test(f.name)) imageFiles.set(f.name.toLowerCase(), f);
    }
    const imageNames = new Set(imageFiles.keys());

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
      const pendingByIndex: string[][] = [];
      const usedImageNames = new Set<string>();

      for (let i = 0; i < mdFiles.length; i++) {
        const f = mdFiles[i]!;
        const parts = (f.webkitRelativePath || f.name).split('/');
        const filename = parts[parts.length - 1]!;
        const titulo = filename.replace(/\.md$/i, '').trim() || 'Sin título';
        // Todas las carpetas de la ruta (incluida la carpeta raíz seleccionada) → una
        // etiqueta por nivel, más "obsidian" para todas las notas importadas.
        const folderTags = parts.slice(0, -1).map(normalizeTag).filter(Boolean);
        const tags = [...new Set(['obsidian', ...folderTags])];
        let text = stripFrontmatter(await f.text());
        text = resolveImageEmbeds(text, imageNames);
        const contenido = markdownToDoc(text);
        const pending = collectPendingImageEmbeds(contenido);
        pending.forEach((n) => usedImageNames.add(n));
        notas.push({ titulo, contenido, tags });
        pendingByIndex.push(pending);
        setProgress({ done: i + 1, total: mdFiles.length });
      }

      setStep('Guardando en el servidor…');
      const ids: string[] = [];
      let total = 0;
      for (let i = 0; i < notas.length; i += CHUNK) {
        const res = await api.importNotes(notas.slice(i, i + CHUNK));
        ids.push(...res.ids);
        total += res.imported;
        setImported(total);
      }

      // Las imágenes se suben en una segunda pasada: la nota debe existir primero
      // (el adjunto queda ligado a su id real), y sólo entonces se reescribe su contenido
      // con las URLs definitivas.
      const notesWithImages = pendingByIndex
        .map((names, idx) => ({ idx, names }))
        .filter((x) => x.names.length > 0);

      if (notesWithImages.length > 0) {
        setStep('Subiendo imágenes…');
        setProgress({ done: 0, total: notesWithImages.length });
        let doneImgNotes = 0;
        for (const { idx, names } of notesWithImages) {
          const notaId = ids[idx]!;
          const urlByName = new Map<string, string>();
          for (const name of names) {
            const file = imageFiles.get(name.toLowerCase());
            if (!file) continue;
            try {
              urlByName.set(name, await uploadImage(notaId, file));
            } catch {
              // Se deja la referencia sin resolver: la imagen no se mostrará, pero la
              // nota y el resto de su contenido se conservan.
            }
          }
          if (urlByName.size > 0) {
            const contenido = resolveImageEmbedRefs(notas[idx]!.contenido, urlByName);
            await api.updateNote(notaId, { contenido });
          }
          doneImgNotes++;
          setProgress({ done: doneImgNotes, total: notesWithImages.length });
        }
      }

      setSkipped(Math.max(all.length - mdFiles.length - usedImageNames.size, 0));
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
              backlinks). Las imágenes embebidas (<code>![[img.png]]</code> o markdown estándar)
              se suben a R2 y se enlazan automáticamente.
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
                {progress.done} / {progress.total}
              </p>
            )}
            <p className="muted">No cierres esta ventana.</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <p>
              ✅ Importadas <strong>{imported}</strong> notas
              {skipped > 0 && <> · {skipped} archivos omitidos</>}.
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
