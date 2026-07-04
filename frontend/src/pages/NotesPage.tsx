import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { EMPTY_DOC, type Backlink, type Note, type NoteContent, type NoteSummary } from '../types';
import { Editor } from '../editor/Editor';
import { DevicesDialog } from '../components/DevicesDialog';

interface Props {
  onLogout: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved';

export function NotesPage({ onLogout }: Props) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);

  // Cambios pendientes de guardar (contenido lo mantiene el editor por callback).
  const pendingContent = useRef<NoteContent | null>(null);
  const pendingTitle = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNotes = useCallback(async () => {
    setNotes(await api.listNotes(showArchived));
  }, [showArchived]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const loadBacklinks = useCallback(async (id: string) => {
    setBacklinks(await api.getBacklinks(id));
  }, []);

  // --- Guardado (debounced) ---

  const flushSave = useCallback(async () => {
    if (!selectedId) return;
    const patch: Partial<{ titulo: string; contenido: NoteContent }> = {};
    if (pendingTitle.current !== null) patch.titulo = pendingTitle.current;
    if (pendingContent.current !== null) patch.contenido = pendingContent.current;
    pendingTitle.current = null;
    pendingContent.current = null;
    if (Object.keys(patch).length === 0) return;

    setSaveState('saving');
    try {
      await api.updateNote(selectedId, patch);
      setSaveState('saved');
      await loadNotes();
      await loadBacklinks(selectedId);
    } catch {
      setSaveState('idle');
    }
  }, [selectedId, loadNotes, loadBacklinks]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushSave(), 800);
  }, [flushSave]);

  // Flush al desmontar.
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // --- Selección de nota ---

  const selectNote = useCallback(
    async (id: string) => {
      // Guarda lo pendiente de la nota anterior antes de cambiar.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await flushSave();

      const note = await api.getNote(id);
      setSelectedId(id);
      setCurrent(note);
      setTitle(note.titulo);
      setSaveState('idle');
      setSidebarOpen(false);
      await loadBacklinks(id);
    },
    [flushSave, loadBacklinks],
  );

  const newNote = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flushSave();
    const note = await api.createNote('Nota sin título', EMPTY_DOC);
    await loadNotes();
    await selectNote(note.id);
  }, [flushSave, loadNotes, selectNote]);

  // --- Navegación por wikilink ---

  const navigateWikilink = useCallback(
    async (target: string) => {
      const found = notes.find((n) => n.titulo.toLowerCase() === target.toLowerCase());
      if (found) {
        await selectNote(found.id);
      } else {
        const note = await api.createNote(target, EMPTY_DOC);
        await loadNotes();
        await selectNote(note.id);
      }
    },
    [notes, selectNote, loadNotes],
  );

  // --- Acciones sobre la nota actual ---

  const onTitleChange = (value: string) => {
    setTitle(value);
    pendingTitle.current = value;
    scheduleSave();
  };

  const onContentChange = (doc: NoteContent) => {
    pendingContent.current = doc;
    scheduleSave();
  };

  const toggleArchive = async () => {
    if (!current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await flushSave();
    await api.updateNote(current.id, { archivada: !current.archivada });
    setCurrent({ ...current, archivada: !current.archivada });
    await loadNotes();
  };

  const remove = async () => {
    if (!current) return;
    if (!confirm(`¿Eliminar definitivamente «${current.titulo}»?`)) return;
    await api.deleteNote(current.id);
    setSelectedId(null);
    setCurrent(null);
    await loadNotes();
  };

  const logout = async () => {
    await flushSave();
    await api.logout();
    onLogout();
  };

  const titles = notes.map((n) => n.titulo);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setSidebarOpen((s) => !s)} aria-label="Menú">
          ☰
        </button>
        <span className="brand">Muninn</span>
        <span className="save-indicator">
          {saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? 'Guardado ✓' : ''}
        </span>
        <button className="icon-btn" onClick={() => setDevicesOpen(true)}>Dispositivos</button>
        <button className="icon-btn" onClick={logout}>Salir</button>
      </header>

      {devicesOpen && <DevicesDialog onClose={() => setDevicesOpen(false)} />}

      <div className="body">
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-actions">
            <button onClick={newNote}>+ Nueva nota</button>
            <label className="archived-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Ver archivadas
            </label>
          </div>
          <ul className="note-list">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  className={`note-item${n.id === selectedId ? ' active' : ''}`}
                  onClick={() => selectNote(n.id)}
                >
                  <span className="note-title">{n.titulo || 'Sin título'}</span>
                  {n.archivada && <span className="badge">archivada</span>}
                </button>
              </li>
            ))}
            {notes.length === 0 && <li className="empty">No hay notas todavía.</li>}
          </ul>
        </aside>

        <main className="content">
          {current ? (
            <>
              <div className="note-header">
                <input
                  className="title-input"
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Título de la nota"
                />
                <div className="note-actions">
                  <button onClick={toggleArchive}>
                    {current.archivada ? 'Desarchivar' : 'Archivar'}
                  </button>
                  <button className="danger" onClick={remove}>Eliminar</button>
                </div>
              </div>

              <Editor
                key={current.id}
                noteId={current.id}
                content={current.contenido}
                titles={titles}
                onChange={onContentChange}
                onNavigateWikilink={navigateWikilink}
              />

              <section className="backlinks">
                <h3>Backlinks</h3>
                {backlinks.length === 0 ? (
                  <p className="muted">Ninguna nota enlaza aquí todavía.</p>
                ) : (
                  <ul>
                    {backlinks.map((b) => (
                      <li key={b.id}>
                        <button className="link" onClick={() => selectNote(b.id)}>
                          {b.titulo}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <div className="placeholder">
              <p>Selecciona una nota o crea una nueva.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
