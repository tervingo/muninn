import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

interface Props {
  tags: string[];
  /** Etiquetas ya existentes en otras notas, para sugerir mientras se escribe. */
  existingTags: string[];
  onChange: (tags: string[]) => void;
}

function normalize(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

/**
 * Editor de etiquetas de una nota: chips con ✕, un input para añadir (Enter / coma) y
 * autocompletado de etiquetas ya existentes (filtro por substring) mientras se escribe.
 */
export function TagEditor({ tags, existingTags, onChange }: Props) {
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState(0);

  const query = normalize(input);
  const suggestions = useMemo(() => {
    if (!query) return [];
    return existingTags.filter((t) => t.includes(query) && !tags.includes(t)).slice(0, 8);
  }, [existingTags, query, tags]);

  useEffect(() => setSelected(0), [query]);

  const addTag = (t: string) => {
    setInput('');
    if (t && !tags.includes(t)) onChange([...tags, t]);
  };

  const add = () => addTag(normalize(input));

  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setSelected((s) => (s + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setSelected((s) => (s + suggestions.length - 1) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const highlighted = suggestions[selected];
      if (highlighted) addTag(highlighted);
      else add();
    } else if (e.key === 'Escape' && suggestions.length > 0) {
      e.preventDefault();
      setInput('');
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      remove(tags[tags.length - 1]!);
    }
  };

  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
          <button type="button" className="tag-x" onClick={() => remove(t)} aria-label={`Quitar ${t}`}>
            ✕
          </button>
        </span>
      ))}
      <div className="tag-input-wrap">
        <input
          className="tag-input"
          value={input}
          placeholder="+ etiqueta"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
        {suggestions.length > 0 && (
          <div className="suggestion-list tag-suggestions">
            {suggestions.map((s, i) => (
              <button
                key={s}
                type="button"
                className={`suggestion-item${i === selected ? ' is-selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(s)}
              >
                #{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
