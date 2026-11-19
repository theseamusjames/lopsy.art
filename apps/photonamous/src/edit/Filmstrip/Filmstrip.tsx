import { useEffect, useRef } from 'react';
import styles from './Filmstrip.module.css';

export interface FilmstripItem {
  /** The asset ID. */
  readonly id: string;
  readonly label: string;
  /** An image URL for the thumbnail; null shows the name. */
  readonly thumbnail: string | null;
}

export interface FilmstripProps {
  readonly items: readonly FilmstripItem[];
  readonly currentId: string;
  readonly onOpen: (id: string) => void;
}

/** The photos of the current view along the bottom of the Edit view (spec 5.4). */
export function Filmstrip({ items, currentId, onOpen }: FilmstripProps) {
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [currentId]);

  return (
    <nav className={styles.filmstrip} aria-label="Filmstrip">
      <ul className={styles.list}>
        {items.map((item) => {
          const isCurrent = item.id === currentId;
          return (
            <li key={item.id}>
              <button
                ref={isCurrent ? currentRef : undefined}
                type="button"
                className={styles.item}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => onOpen(item.id)}
              >
                {item.thumbnail ? (
                  <img className={styles.thumb} src={item.thumbnail} alt="" draggable={false} />
                ) : (
                  <span className={styles.name}>{item.label}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
