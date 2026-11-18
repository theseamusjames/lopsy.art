import { useMemo, useState } from 'react';
import { CopyPlus, Pencil, Trash2 } from 'lucide-react';
import { useLibraryView, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { newVersion } from '../../app/commands';
import { parseItem, versionItemId, versionsByAsset, type ItemId } from '../../library/items';
import { selectOne } from '../../library/selection';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './VersionStrip.module.css';

interface VersionStripProps {
  /** The tile shown: the photo, or one of its versions. */
  itemId: ItemId;
}

/** A photo's versions: switch between them, add, rename and delete (never the shown one or the last). */
export function VersionStrip({ itemId }: VersionStripProps) {
  const session = useSession();
  const view = useLibraryView();
  const { assetId, versionId } = parseItem(itemId);
  const asset = view.assets.get(assetId);
  const versions = useMemo(() => versionsByAsset(view).get(assetId) ?? [], [view, assetId]);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!asset) return null;
  const current = versionId ?? asset.primaryVersionId;
  const itemFor = (id: string) => (id === asset.primaryVersionId ? asset.id : versionItemId(asset.id, id));

  return (
    <div className={styles.strip} role="group" aria-label="Versions">
      <span className={styles.title}>Versions</span>
      {versions.map((v) =>
        renaming === v.id ? (
          <input
            key={v.id}
            className={styles.input}
            autoFocus
            defaultValue={v.name}
            aria-label="Version name"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name !== '' && name !== v.name) session.renameVersion(v.id, name);
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setRenaming(null);
              }
            }}
          />
        ) : (
          <span key={v.id} className={styles.version} data-current={v.id === current}>
            <button
              type="button"
              className={styles.name}
              aria-pressed={v.id === current}
              onClick={() => useUi.getState().setSelection(selectOne(itemFor(v.id)))}
              onDoubleClick={() => setRenaming(v.id)}
            >
              {v.name}
            </button>
            <IconButton size="sm" label={`Rename ${v.name}`} icon={<Pencil size={11} />} onClick={() => setRenaming(v.id)} />
            {v.id !== asset.primaryVersionId && versions.length > 1 && (
              <IconButton
                size="sm"
                label={`Delete ${v.name}`}
                icon={<Trash2 size={11} />}
                onClick={() => {
                  session.deleteVersion(v.id);
                  if (v.id === current) useUi.getState().setSelection(selectOne(asset.id));
                }}
              />
            )}
          </span>
        ),
      )}
      <Button size="sm" variant="ghost" onClick={newVersion}>
        <CopyPlus size={13} />
        New version
      </Button>
    </div>
  );
}
