import { useMemo } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Columns2, ClipboardCopy, ClipboardPaste, CopyPlus, Info, Layers, Maximize, Paintbrush, ScanEye, Search, Trash2 } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { THUMB_SIZE, useUi } from '../../app/store';
import { newVersion, openCompare, openCull, openFocusedInLopsy, runCommand } from '../../app/commands';
import { PresetMenu } from '../PresetMenu/PresetMenu';
import { itemAssets } from '../../library/items';
import { plural } from '../../import/import-summary';
import { MoreMenu } from '../MoreMenu/MoreMenu';
import { formatChord, SHORTCUTS, type CommandId } from '../../shortcuts/registry';
import { isMac } from '../../app/hooks';
import { SORT_DESCENDING, SORT_LABELS, sortDirectionLabel, type SortKey } from '../../library/asset-query';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { useCollectionTitle } from './collection-title';
import styles from './GridToolbar.module.css';

interface GridToolbarProps {
  orderedIds: readonly AssetId[];
}

export function GridToolbar({ orderedIds }: GridToolbarProps) {
  const title = useCollectionTitle();
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

  // Photos, not tiles: an open stack's version tiles are versions of photos already counted.
  const photoCount = useMemo(() => itemAssets(orderedIds).length, [orderedIds]);

  return (
    <div className={styles.toolbar}>
      <div className={styles.heading}>
        <h1 className={styles.title} tabIndex={-1}>
          {title}
        </h1>
        {/* A status: the count is announced when a filter, a search or the selection changes it. */}
        <span className={styles.count} role="status">
          {plural(photoCount, 'photo')}
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
          <select value={sort.key} onChange={(e) => {
              const key = e.target.value as SortKey;
              setSort({ key, descending: SORT_DESCENDING[key] });
            }} aria-label="Order by">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <IconButton
          size="sm"
          label={sortDirectionLabel(sort)}
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

        <span className={styles.divider} />
        <span className={styles.views} role="group" aria-label="Look at">
          <IconButton label={`Look at one photo (${keyOf('open-single')})`} icon={<Maximize size={16} />} onClick={() => runCommand('open-single', orderedIds)} />
          <Button
            size="sm"
            variant="ghost"
            title={selected >= 2 ? `Compare the selected photos (${keyOf('open-compare')})` : 'Compare: select two to four photos first'}
            disabled={selected < 2}
            onClick={() => openCompare(orderedIds)}
          >
            <Columns2 size={14} />
            Compare
          </Button>
          <Button size="sm" variant="ghost" title={`Sort through full screen (${keyOf('open-cull')})`} onClick={() => openCull(orderedIds)}>
            <ScanEye size={14} />
            Cull
          </Button>
        </span>
        <span className={styles.divider} />
        <span className={styles.views} role="group" aria-label="Edits">
          <Button
            size="sm"
            variant="ghost"
            title={`Copy edits from this photo (${keyOf('copy-edits')})`}
            disabled={!single}
            onClick={() => runCommand('copy-edits', orderedIds)}
          >
            <ClipboardCopy size={14} />
            Copy edits
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={copied ? `Paste edits from ${copied.sourceName} (${keyOf('paste-edits')})` : 'Paste edits: copy them from a photo first'}
            disabled={!copied || (selected === 0 && !single)}
            onClick={() => runCommand('paste-edits', orderedIds)}
          >
            <ClipboardPaste size={14} />
            Paste
          </Button>
          <PresetMenu disabled={selected === 0 && !single} />
        </span>
        <span className={styles.divider} />
        <span className={styles.views}>
          <MoreMenu
            items={[
              {
                label: 'New version',
                hint: single ? 'Another edit of this photo, the original untouched' : 'Select one photo first',
                icon: <CopyPlus size={14} />,
                disabled: !single,
                run: newVersion,
              },
              {
                label: 'Edit in Lopsy',
                hint: single ? 'With layers, painting and text' : 'Select one photo first',
                icon: <Paintbrush size={14} />,
                disabled: !single,
                run: openFocusedInLopsy,
              },
              {
                label: 'Group bursts',
                hint: 'Shots taken in quick succession show as one',
                icon: <Layers size={14} />,
                checked: groupBursts,
                run: () => setGroupBursts(!groupBursts),
              },
            ]}
          />
          <IconButton
            label={`Details (${keyOf('toggle-info')})`}
            icon={<Info size={16} />}
            pressed={infoOpen}
            onClick={toggleInfo}
          />
        </span>
      </div>
    </div>
  );
}

/** A command's first key, as the shortcut help writes it. */
function keyOf(id: CommandId): string {
  const chord = SHORTCUTS.find((s) => s.id === id)?.chords[0];
  return chord ? formatChord(chord, isMac) : '';
}
