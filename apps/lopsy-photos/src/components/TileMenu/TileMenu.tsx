import { useEffect, useRef } from 'react';
import { ClipboardCopy, ClipboardPaste, CopyPlus, Download, Maximize, Paintbrush, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import { parseItem, type ItemId } from '../../library/items';
import { useUi } from '../../app/store';
import { askDeleteTargets, makeShownVersion, newVersion, openEdit, openFocusedInLopsy, runCommand } from '../../app/commands';
import styles from './TileMenu.module.css';

interface TileMenuProps {
  /** Where the menu opens, in window pixels. */
  x: number;
  y: number;
  orderedIds: readonly ItemId[];
  onClose: () => void;
}

/** The grid's right-click menu: what can be done with the selected photos. */
export function TileMenu({ x, y, orderedIds, onClose }: TileMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const selected = useUi((s) => s.selection.ids.size);
  const copied = useUi((s) => s.copiedEdits);
  const single = selected <= 1;
  const focus = useUi((s) => s.selection.focus);
  const parsed = focus === null ? null : parseItem(focus);
  const focusedVersion = parsed && parsed.versionId !== null ? { assetId: parsed.assetId, versionId: parsed.versionId } : null;

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const item = (label: string, icon: React.ReactNode, run: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      disabled={disabled}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className={styles.menu}
      role="menu"
      aria-label="Photo actions"
      style={{ '--menu-x': `${x}px`, '--menu-y': `${y}px` } as React.CSSProperties}
    >
      {item('Look at it large', <Maximize size={14} />, () => runCommand('open-single', orderedIds), !single)}
      {item('Edit', <SlidersHorizontal size={14} />, openEdit, !single)}
      {item('New version', <CopyPlus size={14} />, newVersion, !single)}
      {focusedVersion &&
        item('Show this version for the photo', <Star size={14} />, () => makeShownVersion(focusedVersion.assetId, focusedVersion.versionId), !single)}
      {item(
        'Edit in Lopsy',
        <Paintbrush size={14} />,
        openFocusedInLopsy,
        !single,
      )}
      <hr className={styles.rule} />
      {item('Copy edits…', <ClipboardCopy size={14} />, () => runCommand('copy-edits', orderedIds), !single)}
      {item(copied ? `Paste edits from ${copied.sourceName}` : 'Paste edits', <ClipboardPaste size={14} />, () => runCommand('paste-edits', orderedIds), !copied)}
      <hr className={styles.rule} />
      {item('Export…', <Download size={14} />, () => useUi.getState().openDialog('export'))}
      {item('Move to the trash…', <Trash2 size={14} />, askDeleteTargets)}
    </div>
  );
}
