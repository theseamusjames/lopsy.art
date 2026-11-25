import { useMemo } from 'react';
import { Paintbrush } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useLibraryView, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { openInLopsy } from '../../app/lopsy-handoff';
import { selectOne } from '../../library/selection';
import { Button } from '../Button/Button';
import styles from './DocumentList.module.css';

interface DocumentListProps {
  assetId: AssetId;
}

/** The Lopsy documents made from a photo (its stack), each one to look at or to open in Lopsy again. */
export function DocumentList({ assetId }: DocumentListProps) {
  const view = useLibraryView();
  const session = useSession();
  const documents = useMemo(
    () => [...view.assets.values()].filter((a) => !a.deleted && a.kind === 'document' && a.source?.assetId === assetId),
    [view.assets, assetId],
  );
  if (documents.length === 0) return null;
  return (
    <div className={styles.list} role="group" aria-label="Made in Lopsy">
      <span className={styles.title}>Made in Lopsy</span>
      {documents.map((doc) => (
        <span key={doc.id} className={styles.doc}>
          <button type="button" className={styles.name} onClick={() => useUi.getState().setSelection(selectOne(doc.id))}>
            {doc.title || doc.fileName}
          </button>
          <Button size="sm" variant="ghost" onClick={() => openInLopsy(session, doc.id)}>
            <Paintbrush size={12} />
            Open in Lopsy
          </Button>
        </span>
      ))}
    </div>
  );
}
