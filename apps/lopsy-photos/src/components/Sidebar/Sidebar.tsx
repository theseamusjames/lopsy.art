import { useMemo, useState, type ReactNode } from 'react';
import { Album as AlbumIcon, Clock, EyeOff, Images, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useLibraryView, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { ASSET_DRAG_TYPE, readDraggedIds } from '../../app/drag';
import { sameCollection, sidebarCounts, type Collection } from '../../library/asset-query';
import { IconButton } from '../IconButton/IconButton';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const view = useLibraryView();
  const session = useSession();
  const collection = useUi((s) => s.collection);
  const setCollection = useUi((s) => s.setCollection);
  const counts = useMemo(() => sidebarCounts(view), [view]);
  const albums = useMemo(
    () => [...view.albums.values()].filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name)),
    [view],
  );
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const item = (target: Collection, icon: ReactNode, label: string, count: number | undefined, extra?: ReactNode) => (
    <button
      type="button"
      className={styles.item}
      aria-current={sameCollection(target, collection) ? 'page' : undefined}
      onClick={() => setCollection(target)}
    >
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{label}</span>
      {extra}
      {count !== undefined && <span className={styles.count}>{count.toLocaleString()}</span>}
    </button>
  );

  const commit = () => {
    const name = draft.trim();
    if (name !== '') {
      if (editing === 'new') {
        const id = session.createAlbum(name);
        setCollection({ kind: 'album', albumId: id });
      } else if (editing !== null) {
        session.renameAlbum(editing, name);
      }
    }
    setEditing(null);
    setDraft('');
  };

  const nameInput = (
    <input
      className={styles.input}
      autoFocus
      value={draft}
      placeholder="Album name"
      aria-label="Album name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setEditing(null);
        }
      }}
    />
  );

  return (
    <nav className={styles.sidebar} aria-label="Library">
      <div className={styles.section}>
        {item({ kind: 'all' }, <Images size={16} />, 'All photos', counts.all)}
        {item({ kind: 'recent' }, <Clock size={16} />, 'Recent imports', counts.recent)}
        {item({ kind: 'set-aside' }, <EyeOff size={16} />, 'Set aside', counts.setAside)}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Albums</h2>
          <IconButton
            size="sm"
            label="New album"
            icon={<Plus size={14} />}
            onClick={() => {
              setDraft('');
              setEditing('new');
            }}
          />
        </div>
        {albums.length === 0 && editing !== 'new' && (
          <p className={styles.empty}>Albums are groups you pick by hand. Drag photos onto one to add them.</p>
        )}
        {albums.map((album) =>
          editing === album.id ? (
            <div key={album.id} className={styles.editRow}>
              {nameInput}
            </div>
          ) : (
            <div
              key={album.id}
              className={styles.albumRow}
              data-drop={dropTarget === album.id}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDropTarget(album.id);
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                for (const id of readDraggedIds(e.dataTransfer)) session.setAlbumMember(album.id, id, true);
              }}
            >
              {item(
                { kind: 'album', albumId: album.id },
                <AlbumIcon size={16} />,
                album.name,
                counts.albums.get(album.id),
              )}
              <span className={styles.rowActions}>
                <IconButton
                  size="sm"
                  label={`Rename ${album.name}`}
                  icon={<Pencil size={12} />}
                  onClick={() => {
                    setDraft(album.name);
                    setEditing(album.id);
                  }}
                />
                <IconButton
                  size="sm"
                  label={`Delete the album ${album.name} (its photos stay in the library)`}
                  icon={<Trash2 size={12} />}
                  onClick={() => {
                    session.deleteAlbum(album.id);
                    if (collection.kind === 'album' && collection.albumId === album.id) setCollection({ kind: 'all' });
                  }}
                />
              </span>
            </div>
          ),
        )}
        {editing === 'new' && <div className={styles.editRow}>{nameInput}</div>}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Keywords</h2>
        </div>
        {counts.keywords.length === 0 && <p className={styles.empty}>Add keywords to photos in the details panel.</p>}
        {counts.keywords.map(([keyword, count]) => (
          <div key={keyword}>{item({ kind: 'keyword', keyword }, <Tag size={14} />, keyword, count)}</div>
        ))}
      </div>
    </nav>
  );
}
