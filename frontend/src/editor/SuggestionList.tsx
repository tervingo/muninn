import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

export interface SuggestionItem {
  /** Título a insertar como target del wikilink. */
  target: string;
  /** true si la nota aún no existe (se creará al navegar). */
  isNew: boolean;
}

export interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface Props {
  items: SuggestionItem[];
  command: (item: SuggestionItem) => void;
}

export const SuggestionList = forwardRef<SuggestionListRef, Props>((props, ref) => {
  const [selected, setSelected] = useState(0);

  useEffect(() => setSelected(0), [props.items]);

  const select = (index: number) => {
    const item = props.items[index];
    if (item) props.command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + props.items.length - 1) % props.items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % props.items.length);
        return true;
      }
      if (event.key === 'Enter') {
        select(selected);
        return true;
      }
      return false;
    },
  }));

  if (props.items.length === 0) return null;

  return (
    <div className="suggestion-list">
      {props.items.map((item, i) => (
        <button
          key={item.target}
          type="button"
          className={`suggestion-item${i === selected ? ' is-selected' : ''}`}
          onMouseEnter={() => setSelected(i)}
          onClick={() => select(i)}
        >
          {item.isNew ? (
            <>
              <span className="suggestion-new">Crear</span> «{item.target}»
            </>
          ) : (
            item.target
          )}
        </button>
      ))}
    </div>
  );
});

SuggestionList.displayName = 'SuggestionList';
