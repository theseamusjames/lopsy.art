import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, ClipboardCopy, ClipboardPaste, CopyPlus, Download, Maximize, Paintbrush, SlidersHorizontal, Trash2 } from 'lucide-react';
import { parseItem, type ItemId } from '../../library/items';
import { useAsset, useLopsyRefusal } from '../../app/hooks';
import { useUi } from '../../app/store';
import { askDeleteTargets, newVersion, openEdit, openFocusedInLopsy, reportFocusedLopsyRefusal, runCommand, selectVersion } from '../../app/commands';
import { useMenuKeys } from '@lopsy/ui/a11y/use-menu-keys';
import styles from './TileMenu.module.css';
import { isDevelopable } from '../../library/develop-source';

interface TileMenuProps {
  /** Where the menu opens, in window pixels. */
  x: number;
  y: number;
  orderedIds: readonly ItemId[];
  onClose: () => void;
}

/**
 * The grid's right-click menu: what can be done with the selected photos.
 * It is drawn in the landmark that holds the grid (main), not inside the
 * grid, which may hold only rows of cells.
 */
export function TileMenu({ x, y, orderedIds, onClose }: TileMenuProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [landmark, setLandmark] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setLandmark(anchorRef.current?.closest('main, [role="main"]') ?? document.body);
  }, []);
  const { menuRef, onMenuKeyDown } = useMenuKeys({ isOpen: landmark !== null, onClose });
  const selected = useUi((s) => s.selection.ids.size);
  const copied = useUi((s) => s.copiedEdits);
  const single = selected <= 1;
  const focus = useUi((s) => s.selection.focus);
  const parsed = focus === null ? null : parseItem(focus);
  const focusedVersion = parsed && parsed.versionId !== null ? { assetId: parsed.assetId, versionId: parsed.versionId } : null;
  // A Lopsy document is edited on its flattened render; one saved without a render only opens in Lopsy (below).
  const asset = useAsset(parsed?.assetId ?? null);
  const canEdit = !asset || isDevelopable(asset);
  const refusal = useLopsyRefusal();
  const lopsyRefusal = single ? refusal : null;

  /** A command; `hint`, shown under the label, says why it is off when that is not plain from the menu. */
  const item = (label: string, icon: React.ReactNode, run: () => void, disabled = false, hint: string | null = null, onDisabledPress?: () => void) => (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={styles.item}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) {
          onDisabledPress?.();
          return;
        }
        onClose();
        run();
      }}
    >
      {icon}
      {hint === null ? (
        label
      ) : (
        <span className={styles.text}>
          <span>{label}</span>
          <span className={styles.hint}>{hint}</span>
        </span>
      )}
    </button>
  );

  const menu = (
    <div
      ref={menuRef}
      className={styles.menu}
      role="menu"
      aria-label="Photo actions"
      tabIndex={-1}
      onKeyDown={onMenuKeyDown}
      style={{ '--menu-x': `${x}px`, '--menu-y': `${y}px` } as React.CSSProperties}
    >
      {item('Look at it large', <Maximize size={14} />, () => runCommand('open-single', orderedIds), !single)}
      {canEdit && item('Edit', <SlidersHorizontal size={14} />, openEdit, !single)}
      {item('New version', <CopyPlus size={14} />, newVersion, !single)}
      {focusedVersion &&
        item('Make this the selected version', <CircleCheck size={14} />, () => selectVersion(focusedVersion.assetId, focusedVersion.versionId), !single)}
      {item(
        'Edit in Lopsy',
        <Paintbrush size={14} />,
        openFocusedInLopsy,
        !single || lopsyRefusal !== null,
        lopsyRefusal,
        lopsyRefusal !== null ? reportFocusedLopsyRefusal : undefined,
      )}
      <hr className={styles.rule} />
      {item('Copy edits…', <ClipboardCopy size={14} />, () => runCommand('copy-edits', orderedIds), !single)}
      {item(copied ? `Paste edits from ${copied.sourceName}` : 'Paste edits', <ClipboardPaste size={14} />, () => runCommand('paste-edits', orderedIds), !copied)}
      <hr className={styles.rule} />
      {item('Export…', <Download size={14} />, () => useUi.getState().openDialog('export'))}
      {item('Move to the trash…', <Trash2 size={14} />, askDeleteTargets)}
    </div>
  );

  return (
    <>
      <span ref={anchorRef} hidden />
      {landmark && createPortal(menu, landmark)}
    </>
  );
}
