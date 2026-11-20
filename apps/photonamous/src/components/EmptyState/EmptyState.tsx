import { Images } from 'lucide-react';
import type { Collection } from '../../library/asset-query';
import { ImportButton } from '../ImportButton/ImportButton';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  /** True when the whole library is empty, not just this view. */
  libraryEmpty: boolean;
  collection: Collection;
  searching: boolean;
}

function message(collection: Collection, searching: boolean): string {
  if (searching) return 'No photos match what you typed.';
  switch (collection.kind) {
    case 'all':
      return 'Every photo here is dropped.';
    case 'recent':
      return 'Nothing has been imported yet.';
    case 'set-aside':
      return 'Nothing is dropped. Press X on a photo you don’t want: it leaves All photos but stays findable here.';
    case 'album':
      return 'This album is empty. Drag photos from the grid onto its name in the sidebar to add them.';
    case 'keyword':
      return 'No photos have this keyword any more.';
    case 'date':
      return 'No photos from this date.';
    case 'import':
      return 'Nothing from this import is left in the library.';
    case 'saved':
      return 'No photos match this saved search.';
  }
}

export function EmptyState({ libraryEmpty, collection, searching }: EmptyStateProps) {
  if (libraryEmpty) {
    return (
      <div className={styles.empty}>
        <Images size={40} className={styles.icon} />
        <h2 className={styles.title}>Your library is empty</h2>
        <ImportButton />
        <p className={styles.hint}>Or drop photos, a folder or a whole memory card anywhere on this window.</p>
      </div>
    );
  }
  return (
    <div className={styles.empty}>
      <p className={styles.hint} role="status">
        {message(collection, searching)}
      </p>
    </div>
  );
}
