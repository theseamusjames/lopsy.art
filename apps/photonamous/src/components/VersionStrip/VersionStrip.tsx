import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyPlus, Pencil, Trash2 } from 'lucide-react';
import type { Version } from '@lopsy/photos-core/library/types';
import { useLibraryView, useSession } from '../../app/hooks';
import { deleteVersionOf, newVersion, selectVersion } from '../../app/commands';
import { parseItem, versionsByAsset, type ItemId } from '../../library/items';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './VersionStrip.module.css';

/** Up to this many versions, the ones not selected are chips beside the box; more are chosen from a dropdown in it. */
const MAX_VERSION_CHIPS = 4;

/** How far past a chip's edge the chips scroll to bring it into sight, so its focus ring shows too. */
const SCROLL_MARGIN = 4;

interface VersionStripProps {
  /** The tile shown: the photo, or one of its versions. */
  itemId: ItemId;
  /** Sizes the strip in the row it sits in. */
  className?: string;
}

/**
 * A photo's versions. The selected one, which the photo uses in the grid,
 * albums and exports, has a box of its own with its Rename and Delete
 * (never the last version); the others are chips, and picking one makes
 * it the selected version and shows it. With more than four versions the
 * box holds a dropdown of them all instead. New version makes another,
 * which becomes the selected one. A version on screen that is not the
 * selected one (opened from the grid's stack, or left there by the Edit
 * view) has its chip marked with a dot.
 */
export function VersionStrip({ itemId, className }: VersionStripProps) {
  const session = useSession();
  const view = useLibraryView();
  const { assetId, versionId } = parseItem(itemId);
  const asset = view.assets.get(assetId);
  const versions = useMemo(() => versionsByAsset(view).get(assetId) ?? [], [view, assetId]);
  const [isRenaming, setIsRenaming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  /** Set when a rename ends from the keyboard: focus goes back to the dropdown or to Rename. */
  const refocus = useRef(false);
  const cancelled = useRef(false);
  const selectId = useId();
  const hintId = useId();
  const selected = versions.find((v) => v.id === asset?.primaryVersionId) ?? versions[0];
  const shownId = versionId ?? selected?.id ?? null;
  const isMenu = versions.length > MAX_VERSION_CHIPS;

  // The chip of the version on screen stays in sight when the chips scroll. Only the chips scroll: scrollIntoView would move the page too.
  useEffect(() => {
    const box = chips.current;
    const chip = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box || !chip) return;
    const outer = box.getBoundingClientRect();
    const inner = chip.getBoundingClientRect();
    if (inner.left < outer.left) box.scrollLeft -= outer.left - inner.left + SCROLL_MARGIN;
    else if (inner.right > outer.right) box.scrollLeft += inner.right - outer.right + SCROLL_MARGIN;
  }, [shownId, versions.length, isMenu]);

  useEffect(() => {
    if (isRenaming || !refocus.current) return;
    refocus.current = false;
    const target = isMenu ? root.current?.querySelector('select') : root.current?.querySelector('[data-rename]');
    if (target instanceof HTMLElement) target.focus();
  }, [isRenaming, isMenu]);

  if (!asset || !selected) return null;
  const others = versions.filter((v) => v.id !== selected.id);

  const renameField = (v: Version) => (
    <input
      key={v.id}
      className={styles.input}
      autoFocus
      defaultValue={v.name}
      aria-label="Version name"
      onBlur={(e) => {
        const name = e.target.value.trim();
        if (!cancelled.current && name !== '' && name !== v.name) session.renameVersion(v.id, name);
        cancelled.current = false;
        setIsRenaming(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        // Escape leaves the name as it was, and leaves the view open.
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
        }
        refocus.current = true;
        e.currentTarget.blur();
      }}
    />
  );

  const choice = isMenu ? (
    <select id={selectId} className={styles.select} value={selected.id} onChange={(e) => selectVersion(asset.id, e.target.value)}>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  ) : (
    <span className={styles.selectedName} onDoubleClick={() => setIsRenaming(true)}>
      {selected.name}
    </span>
  );

  return (
    <div ref={root} className={[styles.strip, className].filter(Boolean).join(' ')} role="group" aria-label="Versions">
      <span className={styles.selected}>
        {isMenu ? (
          <label className={styles.label} htmlFor={selectId}>
            Selected
          </label>
        ) : (
          <span className={styles.label}>Selected</span>
        )}
        {isRenaming ? renameField(selected) : choice}
        <IconButton size="sm" label={`Rename ${selected.name}`} icon={<Pencil size={11} />} onClick={() => setIsRenaming(true)} data-rename />
        {versions.length > 1 && (
          <IconButton size="sm" label={`Delete ${selected.name}`} icon={<Trash2 size={11} />} onClick={() => deleteVersionOf(asset.id, selected.id)} />
        )}
      </span>
      {!isMenu && others.length > 0 && (
        <div ref={chips} className={styles.chips}>
          {others.map((v) => {
            const isOnScreen = v.id === shownId;
            return (
              <button
                key={v.id}
                type="button"
                className={styles.chip}
                aria-current={isOnScreen ? 'true' : undefined}
                aria-describedby={hintId}
                title={isOnScreen ? 'On screen; select it to make the photo use it' : 'Select it: the photo uses it in the grid, albums and exports'}
                data-version-id={v.id}
                onClick={() => selectVersion(asset.id, v.id)}
              >
                {isOnScreen && <span className={styles.dot} aria-hidden="true" />}
                {v.name}
              </button>
            );
          })}
        </div>
      )}
      <span id={hintId} hidden>
        Selecting a version makes the photo use it in the grid, albums and exports.
      </span>
      <Button size="sm" variant="ghost" className={styles.add} onClick={newVersion}>
        <CopyPlus size={13} />
        New version
      </Button>
    </div>
  );
}
