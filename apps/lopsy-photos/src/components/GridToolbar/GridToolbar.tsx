import { useMemo } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns2, ClipboardCopy, ClipboardPaste, CopyPlus, Info, Layers, Maximize, Paintbrush, ScanEye, Search, Trash2 } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useLibraryView, useSavedSearches } from '../../app/hooks';
import { datePrefixLabel } from '../../library/finding';
import { THUMB_SIZE, useUi } from '../../app/store';
import { currentVersions, newVersion, openCompare, openCull, runCommand } from '../../app/commands';
import { openInLopsy } from '../../app/lopsy-handoff';
import { SORT_LABELS, type SortKey } from '../../library/asset-query';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './GridToolbar.module.css';

interface GridToolbarProps {
  orderedIds: readonly AssetId[];
}

export function GridToolbar({ orderedIds }: GridToolbarProps) {
  const view = useLibraryView();
  const saved = useSavedSearches();
  const groupBursts = useUi((s) => s.groupBursts);
  const setGroupBursts = useUi((s) => s.setGroupBursts);
  const collection = useUi((s) => s.collection);
  const sort = useUi((s) => s.sort);
  const setSort = useUi((s) => s.setSort);
  const text = useUi((s) => s.text);
  const setText = useUi((s) => s.setText);
  const thumbSize = useUi((s) => s.thumbSize);
  const setThumbSize = useUi((s) => s.setThumbSize);
  const selected = useUi((s) => s.selection.ids.size);
  const focus = useUi((s) => s.selection.focus);
  const single = selected === 1 || (selected === 0 && focus !== null);
  const copied = useUi((s) => s.copiedEdits);
  const infoOpen = useUi((s) => s.infoOpen);
  const toggleInfo = useUi((s) => s.toggleInfo);
  const askDelete = useUi((s) => s.askDelete);

  const title = useMemo(() => {
    switch (collection.kind) {
      case 'all':
        return 'All photos';
      case 'recent':
        return 'Recent imports';
      case 'set-aside':
        return 'Set aside';
      case 'album':
        return view.albums.get(collection.albumId)?.name ?? 'Album';
      case 'keyword':
        return collection.keyword;
      case 'date':
        return datePrefixLabel(collection.prefix);
      case 'import':
        return 'Imported together';
      case 'saved':
        return saved.find((x) => x.id === collection.searchId)?.name ?? 'Saved search';
    }
  }, [collection, view, saved]);

  return (
    <div className={styles.toolbar}>
      <div className={styles.heading}>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.count}>
          {orderedIds.length.toLocaleString()} photo{orderedIds.length === 1 ? '' : 's'}
          {selected > 0 && ` · ${selected.toLocaleString()} selected`}
        </span>
        {collection.kind === 'set-aside' && orderedIds.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => askDelete(orderedIds)}>
            <Trash2 size={13} />
            Delete set-aside photos
          </Button>
        )}
      </div>

      <div className={styles.controls}>
        <label className={styles.search}>
          <Search size={14} />
          <input
            type="search"
            placeholder="Find by name, title, keyword"
            aria-label="Find photos"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                if (text !== '') setText('');
                else e.currentTarget.blur();
              }
            }}
          />
        </label>

        <label className={styles.sort}>
          <span className={styles.controlLabel}>Order</span>
          <select value={sort.key} onChange={(e) => setSort({ ...sort, key: e.target.value as SortKey })} aria-label="Order by">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <IconButton
          size="sm"
          label={sort.descending ? 'Newest or highest first (click to reverse)' : 'Oldest or lowest first (click to reverse)'}
          icon={sort.descending ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
          onClick={() => setSort({ ...sort, descending: !sort.descending })}
        />

        <label className={styles.size}>
          <span className={styles.controlLabel}>Size</span>
          <input
            type="range"
            min={THUMB_SIZE.min}
            max={THUMB_SIZE.max}
            value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
            aria-label="Thumbnail size"
          />
        </label>

        <span className={styles.views}>
        <span className={styles.divider} />
        <IconButton label="Look at one photo (Space)" icon={<Maximize size={16} />} onClick={() => runCommand('open-single', orderedIds)} />
        <IconButton
          label={selected >= 2 ? 'Compare the selected photos (C)' : 'Compare: select two to four photos first'}
          icon={<Columns2 size={16} />}
          disabled={selected < 2}
          onClick={() => openCompare(orderedIds)}
        />
        <IconButton
          label={single ? 'New version: another edit of this photo, the original untouched' : 'New version: select one photo first'}
          icon={<CopyPlus size={16} />}
          disabled={!single}
          onClick={newVersion}
        />
        <IconButton
          label="Copy edits (⇧⌘C)"
          icon={<ClipboardCopy size={16} />}
          disabled={!single}
          onClick={() => runCommand('copy-edits', orderedIds)}
        />
        <IconButton
          label={copied ? `Paste edits from ${copied.sourceName} (⇧⌘V)` : 'Paste edits: copy them from a photo first'}
          icon={<ClipboardPaste size={16} />}
          disabled={!copied || (selected === 0 && !single)}
          onClick={() => runCommand('paste-edits', orderedIds)}
        />
        <IconButton
          label={groupBursts ? 'Show every photo of a burst' : 'Group bursts: shots taken in quick succession show as one'}
          icon={<Layers size={16} />}
          active={groupBursts}
          onClick={() => setGroupBursts(!groupBursts)}
        />
        <IconButton label="Sort through full screen (F)" icon={<ScanEye size={16} />} onClick={() => openCull(orderedIds)} />
        <IconButton
          label={single ? 'Edit in Lopsy, with layers, painting and text' : 'Edit in Lopsy: select one photo first'}
          icon={<Paintbrush size={16} />}
          disabled={!single}
          onClick={() => {
            const session = useUi.getState().connection?.session;
            const target = currentVersions()[0];
            if (session && target !== undefined) openInLopsy(session, target.assetId, target.versionId);
          }}
        />
        <IconButton label="Details (I)" icon={<Info size={16} />} active={infoOpen} onClick={toggleInfo} />
        </span>
      </div>
    </div>
  );
}
