import { useState, type KeyboardEvent } from 'react';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
}

function normalize(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

/** Editor de etiquetas de una nota: chips con ✕ y un input para añadir (Enter / coma). */
export function TagEditor({ tags, onChange }: Props) {
  const [input, setInput] = useState('');

  const add = () => {
    const t = normalize(input);
    setInput('');
    if (t && !tags.includes(t)) onChange([...tags, t]);
  };

  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
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
      <input
        className="tag-input"
        value={input}
        placeholder="+ etiqueta"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </div>
  );
}
