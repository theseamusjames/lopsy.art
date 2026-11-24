import { useMemo } from 'react';
import { ClipboardCopy, ClipboardPaste, CopyPlus, Info, Layers, Paintbrush, RotateCcw, Trash2 } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useUi } from '../../app/store';
import { newVersion, openFocusedInLopsy, resetEdits, runCommand } from '../../app/commands';
import { PresetMenu } from '../PresetMenu/PresetMenu';
import { itemAssets } from '../../library/items';
import { plural } from '../../import/import-summary';
import { MoreMenu } from '../MoreMenu/MoreMenu';
import { formatChord, SHORTCUTS, type CommandId } from '../../shortcuts/registry';
import { isMac } from '../../app/hooks';
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
            Delete dropped photos
          </Button>
        )}
      </div>

      <div className={styles.controls}>
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
          <Button
            size="sm"
            variant="ghost"
            title={selected === 0 && !single ? 'Reset to the original: select photos first' : 'Take the selected photos back to the original, every edit off'}
            disabled={selected === 0 && !single}
            onClick={resetEdits}
          >
            <RotateCcw size={14} />
            Reset
          </Button>
        </span>
        <span className={`${styles.views} ${styles.end}`}>
          <IconButton
            label={`Details (${keyOf('toggle-info')})`}
            icon={<Info size={16} />}
            pressed={infoOpen}
            onClick={toggleInfo}
          />
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
