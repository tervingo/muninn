import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  EMPTY_DOC,
  type Backlink,
  type Note,
  type NoteSummary,
  type RelatedNote,
  type TagCount,
  type WsStatus,
} from '../types';
import { Editor } from '../editor/Editor';
import { DevicesDialog } from '../components/DevicesDialog';
import { TagEditor } from '../components/TagEditor';
import { ImportDialog } from '../components/ImportDialog';
import { MapView } from '../components/MapView';

interface Props {
  onLogout: () => void;
}

export function NotesPage({ onLogout }: Props) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RelatedNote[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkTagging, setBulkTagging] = useState(false);

  // El contenido lo persiste el servidor desde Yjs; aquí solo guardamos el título (REST).
  const pendingTitle = useRef<string | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tras editar, refrescamos backlinks/lista (el servidor recalcula enlaces al persistir).
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNotes = useCallback(async () => {
    setNotes(await api.listNotes(showArchived, activeTags));
  }, [showArchived, activeTags]);

  const loadTags = useCallback(async () => {
    setAllTags(await api.listTags());
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const loadBacklinks = useCallback(async (id: string) => {
    setBacklinks(await api.getBacklinks(id));
  }, []);

  const loadRelated = useCallback(async (id: string) => {
    setRelated(await api.getRelated(id));
  }, []);

  // --- Búsqueda semántica (debounced). Sustituye la lista de notas mientras hay texto. ---

  const runSearch = useCallback(async (q: string) => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(await api.semanticSearch(q));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const onSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setSearchResults(null);
      return;
    }
    searchTimer.current = setTimeout(() => void runSearch(value), 500);
  };

  // Añade/quita una etiqueta a un conjunto de notas (resultados de búsqueda o de un filtro
  // por etiqueta) de una sola vez.
  const bulkTagIds = useCallback(
    async (ids: string[], action: 'add' | 'remove') => {
      const tag = bulkTagInput.trim();
      if (!tag || ids.length === 0) return;
      setBulkTagging(true);
      try {
        await api.bulkTag(ids, tag, action);
        setBulkTagInput('');
        await loadTags();
        await loadNotes();
        if (selectedId && ids.includes(selectedId)) {
          setCurrent(await api.getNote(selectedId));
        }
      } finally {
        setBulkTagging(false);
      }
    },
    [bulkTagInput, selectedId, loadTags, loadNotes],
  );

  // --- Guardado del título (REST, debounced). El contenido lo persiste el servidor. ---

  const flushTitle = useCallback(async () => {
    if (titleTimer.current) {
      clearTimeout(titleTimer.current);
      titleTimer.current = null;
    }
    if (!selectedId || pendingTitle.current === null) return;
    const titulo = pendingTitle.current;
    pendingTitle.current = null;
    try {
      await api.updateNote(selectedId, { titulo });
      await loadNotes();
    } catch {
      /* reintenta en el próximo cambio */
    }
  }, [selectedId, loadNotes]);

  const scheduleTitleSave = useCallback(() => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => void flushTitle(), 800);
  }, [flushTitle]);

  // Refresco de backlinks/relacionadas/lista tras editar (el servidor recalcula enlaces
  // y embedding al persistir; el embedding tarda un poco más por la llamada a Voyage).
  const scheduleRefresh = useCallback(() => {
    if (!selectedId) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void loadBacklinks(selectedId);
      void loadRelated(selectedId);
      void loadNotes();
    }, 3500);
  }, [selectedId, loadBacklinks, loadRelated, loadNotes]);

  // Limpieza de timers al desmontar.
  useEffect(
    () => () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  // --- Selección de nota ---

  const selectNote = useCallback(
    async (id: string) => {
      await flushTitle(); // guarda el título pendiente de la nota anterior
      const note = await api.getNote(id);
      setSelectedId(id);
      setCurrent(note);
      setTitle(note.titulo);
      setSidebarOpen(false);
      await loadBacklinks(id);
      await loadRelated(id);
    },
    [flushTitle, loadBacklinks, loadRelated],
  );

  const newNote = useCallback(async () => {
    await flushTitle();
    const note = await api.createNote('Nota sin título', EMPTY_DOC);
    await loadNotes();
    await selectNote(note.id);
  }, [flushTitle, loadNotes, selectNote]);

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
    scheduleTitleSave();
  };

  const onContentChange = () => {
    scheduleRefresh();
  };

  const toggleArchive = async () => {
    if (!current) return;
    await flushTitle();
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
    await flushTitle();
    await api.logout();
    onLogout();
  };

  const onTagsChange = async (tags: string[]) => {
    if (!current) return;
    setCurrent({ ...current, tags });
    try {
      await api.updateNote(current.id, { tags });
      await loadTags();
      await loadNotes();
    } catch {
      /* reintenta en el próximo cambio */
    }
  };

  const toggleTagFilter = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const bulkDeleteShown = async () => {
    if (activeTags.length === 0 || notes.length === 0) return;
    const filtro = activeTags.map((t) => `#${t}`).join(', ');
    if (
      !confirm(
        `¿Eliminar definitivamente ${notes.length} nota(s) con ${filtro}? Esta acción no se puede deshacer.`,
      )
    )
      return;
    const ids = notes.map((n) => n.id);
    await api.bulkDelete(ids);
    if (selectedId && ids.includes(selectedId)) {
      setSelectedId(null);
      setCurrent(null);
    }
    await loadNotes();
    await loadTags();
  };

  const titles = notes.map((n) => n.titulo);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setSidebarOpen((s) => !s)} aria-label="Menú">
          ☰
        </button>
        <span className="brand">Muninn</span>
        <img className="brand-logo" src="/favicon-48.png" alt="" aria-hidden="true" />
        <span className="save-indicator">
          {current
            ? wsStatus === 'connected'
              ? 'Sincronizado ✓'
              : wsStatus === 'connecting'
                ? 'Conectando…'
                : 'Sin conexión'
            : ''}
        </span>
        <button className="icon-btn" onClick={() => setMapOpen(true)}>Mapa</button>
        <button className="icon-btn" onClick={() => setDevicesOpen(true)}>Dispositivos</button>
        <button className="icon-btn" onClick={logout}>Salir</button>
      </header>

      {devicesOpen && <DevicesDialog onClose={() => setDevicesOpen(false)} />}
      {mapOpen && (
        <MapView onClose={() => setMapOpen(false)} onSelectNote={(id) => void selectNote(id)} />
      )}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={() => {
            void loadNotes();
            void loadTags();
          }}
        />
      )}

      <div className="body">
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="sidebar-actions">
            <button onClick={newNote}>+ Nueva nota</button>
            <button onClick={() => setImportOpen(true)}>Importar de Obsidian</button>
            <label className="archived-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Ver archivadas
            </label>
          </div>

          <div className="search-box">
            <input
              type="search"
              placeholder="Buscar por significado…"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch(searchQuery);
              }}
            />
          </div>

          {searchQuery.trim() ? (
            <>
              <ul className="note-list">
                {searching && <li className="empty">Buscando…</li>}
                {!searching && searchResults?.length === 0 && (
                  <li className="empty">Sin resultados para «{searchQuery.trim()}».</li>
                )}
                {!searching &&
                  searchResults?.map((r) => (
                    <li key={r.id}>
                      <button
                        className={`note-item${r.id === selectedId ? ' active' : ''}`}
                        onClick={() => selectNote(r.id)}
                      >
                        <span className="note-title">{r.titulo || 'Sin título'}</span>
                      </button>
                    </li>
                  ))}
              </ul>
              {!searching && searchResults && searchResults.length > 0 && (
                <div className="bulk-tag-box">
                  <input
                    type="text"
                    placeholder="etiqueta"
                    value={bulkTagInput}
                    onChange={(e) => setBulkTagInput(e.target.value)}
                    disabled={bulkTagging}
                  />
                  <button
                    disabled={!bulkTagInput.trim() || bulkTagging}
                    onClick={() => bulkTagIds(searchResults.map((r) => r.id), 'add')}
                  >
                    + Añadir a {searchResults.length}
                  </button>
                  <button
                    disabled={!bulkTagInput.trim() || bulkTagging}
                    onClick={() => bulkTagIds(searchResults.map((r) => r.id), 'remove')}
                  >
                    − Quitar de {searchResults.length}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {allTags.length > 0 && (
                <div className="tag-filter">
                  <div className="tag-filter-head">
                    <span>Etiquetas</span>
                    {activeTags.length > 0 && (
                      <button className="link" onClick={() => setActiveTags([])}>
                        limpiar
                      </button>
                    )}
                  </div>
                  <div className="tag-filter-list">
                    {allTags.map((t) => (
                      <button
                        key={t.tag}
                        className={`tag-chip filter${activeTags.includes(t.tag) ? ' active' : ''}`}
                        onClick={() => toggleTagFilter(t.tag)}
                      >
                        #{t.tag} <span className="tag-count">{t.count}</span>
                      </button>
                    ))}
                  </div>
                  {activeTags.length > 0 && notes.length > 0 && (
                    <>
                      <button className="danger bulk-del" onClick={bulkDeleteShown}>
                        Eliminar {notes.length} resultado{notes.length === 1 ? '' : 's'}
                      </button>
                      <div className="bulk-tag-box">
                        <input
                          type="text"
                          placeholder="etiqueta"
                          value={bulkTagInput}
                          onChange={(e) => setBulkTagInput(e.target.value)}
                          disabled={bulkTagging}
                        />
                        <button
                          disabled={!bulkTagInput.trim() || bulkTagging}
                          onClick={() => bulkTagIds(notes.map((n) => n.id), 'add')}
                        >
                          + Añadir a {notes.length}
                        </button>
                        <button
                          disabled={!bulkTagInput.trim() || bulkTagging}
                          onClick={() => bulkTagIds(notes.map((n) => n.id), 'remove')}
                        >
                          − Quitar de {notes.length}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
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
            </>
          )}
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

              <TagEditor tags={current.tags} onChange={onTagsChange} />

              <Editor
                key={current.id}
                noteId={current.id}
                content={current.contenido}
                titles={titles}
                onChange={onContentChange}
                onNavigateWikilink={navigateWikilink}
                onStatus={setWsStatus}
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

              <section className="related-notes">
                <h3>Relacionadas</h3>
                {related.length === 0 ? (
                  <p className="muted">
                    Sin notas relacionadas todavía (puede tardar unos segundos tras guardar).
                  </p>
                ) : (
                  <ul>
                    {related.map((r) => (
                      <li key={r.id}>
                        <button className="link" onClick={() => selectNote(r.id)}>
                          {r.titulo}
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
