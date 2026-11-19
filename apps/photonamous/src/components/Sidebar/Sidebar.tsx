import { useMemo, useState, type ReactNode } from 'react';
import { Album as AlbumIcon, CalendarDays, Clock, EyeOff, Images, Pencil, Plus, Search, Tag, Trash2, Upload } from 'lucide-react';
import { useLibraryView, useSavedSearches, useSession } from '../../app/hooks';
import { buildDateTree } from '@lopsy/photos-core/search/dates';
import { writeSavedSearches } from '@lopsy/photos-core/search/rules';
import { datePrefixLabel, importBatches, importLabel, importLabels } from '../../library/finding';
import { Disclosure } from '../Disclosure/Disclosure';
import { useUi } from '../../app/store';
import { ASSET_DRAG_TYPE, readDraggedIds } from '../../app/drag';
import { setAlbumItem } from '../../library/items';
import { isHiddenPairHalf, sameCollection, sidebarCounts, type Collection } from '../../library/asset-query';
import { IconButton } from '../IconButton/IconButton';
import styles from './Sidebar.module.css';

/** The date arrow's name says which year or month it opens or closes (Disclosure's optional label). */
function disclosureLabel(what: string, open: boolean): { label: string } {
  return { label: `${open ? 'Close' : 'Open'} ${what}` };
}

export function Sidebar() {
  const view = useLibraryView();
  const session = useSession();
  const collection = useUi((s) => s.collection);
  const setCollection = useUi((s) => s.setCollection);
  const counts = useMemo(() => sidebarCounts(view), [view]);
  const saved = useSavedSearches();
  // The hidden JPEG of a RAW+JPEG pair is not counted, as in All photos.
  const dates = useMemo(
    () => buildDateTree([...view.assets.values()].filter((a) => !a.deleted && !a.setAside && !isHiddenPairHalf(a, view.assets))),
    [view.assets],
  );
  const imports = useMemo(() => importBatches(view), [view]);
  const importNames = useMemo(() => importLabels(imports), [imports]);
  const [openDates, setOpenDates] = useState<ReadonlySet<string>>(new Set());
  const [renamingSearch, setRenamingSearch] = useState<string | null>(null);
  const [showAllImports, setShowAllImports] = useState(false);
  const toggleDate = (key: string) =>
    setOpenDates((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const renameSearch = (id: string, next: string) => {
    const trimmed = next.trim();
    if (trimmed !== '') writeSavedSearches(session, saved.map((x) => (x.id === id ? { ...x, name: trimmed } : x)));
    setRenamingSearch(null);
  };
  const albums = useMemo(
    () => [...view.albums.values()].filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name)),
    [view],
  );
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const item = (target: Collection, icon: ReactNode | null, label: string, count: number | undefined) => (
    <button
      type="button"
      className={styles.item}
      aria-current={sameCollection(target, collection) ? 'page' : undefined}
      onClick={() => setCollection(target)}
    >
      {icon !== null && <span className={styles.icon}>{icon}</span>}
      <span className={styles.label}>{label}</span>
      {count !== undefined && <span className={styles.count}>{count.toLocaleString()}</span>}
    </button>
  );

  /** A year or month: its arrow beside the row (not inside it), so each is a control of its own. */
  const dateRow = (prefix: string, label: string, count: number, toggleName: string) => {
    const open = openDates.has(prefix);
    return (
      <div className={styles.treeRow}>
        <span className={styles.toggle}>
          <Disclosure open={open} onToggle={() => toggleDate(prefix)} {...disclosureLabel(toggleName, open)} />
        </span>
        {item({ kind: 'date', prefix }, null, label, count)}
      </div>
    );
  };

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
          <p className={styles.empty}>
            Albums are groups you pick by hand. Drag photos onto one, or tick it under In albums in the details panel.
          </p>
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
                for (const id of readDraggedIds(e.dataTransfer)) setAlbumItem(session, album.id, id, true);
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
          <h2 className={styles.sectionTitle}>Saved searches</h2>
        </div>
        {saved.length === 0 && <p className={styles.empty}>Narrow the photos with the filters above the grid, then Save search.</p>}
        {saved.map((search) =>
          renamingSearch === search.id ? (
            <div key={search.id} className={styles.editRow}>
              <input
                className={styles.input}
                autoFocus
                defaultValue={search.name}
                aria-label="Saved search name"
                onBlur={(e) => renameSearch(search.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setRenamingSearch(null);
                  }
                }}
              />
            </div>
          ) : (
            <div key={search.id} className={styles.albumRow}>
              {item({ kind: 'saved', searchId: search.id }, <Search size={14} />, search.name, undefined)}
              <span className={styles.rowActions}>
                <IconButton size="sm" label={`Rename ${search.name}`} icon={<Pencil size={12} />} onClick={() => setRenamingSearch(search.id)} />
                <IconButton
                  size="sm"
                  label={`Delete the saved search ${search.name}`}
                  icon={<Trash2 size={12} />}
                  onClick={() => {
                    writeSavedSearches(session, saved.filter((x) => x.id !== search.id));
                    if (collection.kind === 'saved' && collection.searchId === search.id) setCollection({ kind: 'all' });
                  }}
                />
              </span>
            </div>
          ),
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Dates</h2>
        </div>
        {dates.length === 0 && <p className={styles.empty}>No dates yet.</p>}
        {dates.length > 0 && (
          <ul className={styles.tree}>
            {dates.map((year) => (
              <li key={year.year}>
                {dateRow(year.year, year.year, year.count, year.year)}
                {openDates.has(year.year) && (
                  <ul className={styles.tree}>
                    {year.months.map((month) => (
                      <li key={month.month} className={styles.nested}>
                        {dateRow(month.month, datePrefixLabel(month.month).replace(/ \d{4}$/, ''), month.count, datePrefixLabel(month.month))}
                        {openDates.has(month.month) && (
                          <ul className={styles.tree}>
                            {month.days.map((day) => (
                              <li key={day.day} className={styles.nested}>
                                {item({ kind: 'date', prefix: day.day }, <CalendarDays size={14} />, datePrefixLabel(day.day), day.count)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Imports</h2>
        </div>
        {imports.slice(0, showAllImports ? imports.length : 6).map((batch) => (
          <div key={batch.importId}>
            {item(
              { kind: 'import', importId: batch.importId },
              <Upload size={14} />,
              importNames.get(batch.importId) ?? importLabel(batch.importedAt),
              batch.count,
            )}
          </div>
        ))}
        {imports.length > 6 && (
          <button type="button" className={styles.more} aria-expanded={showAllImports} onClick={() => setShowAllImports((v) => !v)}>
            {showAllImports ? 'Show fewer' : `Show all ${imports.length}`}
          </button>
        )}
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
