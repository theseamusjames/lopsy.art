import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BadgeCheck, CopyPlus, Pencil, Trash2 } from 'lucide-react';
import type { Version, VersionId } from '@lopsy/photos-core/library/types';
import { useLibraryView, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { deleteVersionOf, newVersion, selectVersion } from '../../app/commands';
import { itemForVersion, parseItem, versionsByAsset, type ItemId } from '../../library/items';
import { selectOne } from '../../library/selection';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './VersionStrip.module.css';

/** Up to this many versions, the ones not selected are chips beside the box; more are chosen from a dropdown. */
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
 * albums and exports, has a box of its own marked Selected, with its
 * Rename and Delete (never the last version). The others are chips: the
 * chip shows that version (Edit then edits it), its check makes it the
 * selected version, putting the one it replaces back among the chips, and
 * its bin deletes it. A dot marks the chip of the version on screen. With
 * more than four versions, a dropdown of the others takes the chips'
 * place, with the same check and bin for the one it shows. New version
 * makes another, which becomes the selected one.
 */
export function VersionStrip({ itemId, className }: VersionStripProps) {
  const session = useSession();
  const view = useLibraryView();
  const { assetId, versionId } = parseItem(itemId);
  const asset = view.assets.get(assetId);
  const versions = useMemo(() => versionsByAsset(view).get(assetId) ?? [], [view, assetId]);
  const [renaming, setRenaming] = useState<VersionId | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  /** Set when a rename ends from the keyboard: focus goes back to that version. */
  const refocus = useRef<VersionId | null>(null);
  const cancelled = useRef(false);
  const otherId = useId();
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
    const id = refocus.current;
    if (renaming !== null || id === null) return;
    refocus.current = null;
    const target = root.current?.querySelector(`[data-version-id="${CSS.escape(id)}"]`) ?? root.current?.querySelector('select');
    if (target instanceof HTMLElement) target.focus();
  }, [renaming]);

  if (!asset || !selected) return null;
  const others = versions.filter((v) => v.id !== selected.id);
  const onScreen = others.find((v) => v.id === shownId) ?? null;
  // Shows the version, without selecting it: the Single view's photo, and what Edit opens.
  const show = (id: VersionId) => useUi.getState().setSelection(selectOne(itemForVersion(view, asset.id, id)));

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
        setRenaming(null);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        // Escape leaves the name as it was, and leaves the view open.
        if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
        }
        // Focus goes back to the version's button before this key is done: without this, Enter would press that button too.
        if (e.key === 'Enter') e.preventDefault();
        refocus.current = v.id;
        e.currentTarget.blur();
      }}
    />
  );

  /** The check and the bin of a version that is not the selected one. */
  const otherActions = (v: Version) => (
    <>
      <IconButton
        size="sm"
        label={`Make ${v.name} the selected version`}
        title="Make it the selected version: the photo uses it in the grid, albums and exports"
        icon={<BadgeCheck size={13} />}
        onClick={() => selectVersion(asset.id, v.id)}
      />
      <IconButton size="sm" label={`Delete ${v.name}`} icon={<Trash2 size={11} />} onClick={() => deleteVersionOf(asset.id, v.id)} />
    </>
  );

  const chip = (v: Version) => {
    const isOnScreen = v.id === shownId;
    return (
      <span key={v.id} className={styles.version}>
        <button
          type="button"
          className={styles.name}
          aria-current={isOnScreen ? 'true' : undefined}
          aria-describedby={hintId}
          data-version-id={v.id}
          onClick={() => show(v.id)}
          onDoubleClick={() => setRenaming(v.id)}
        >
          {isOnScreen && <span className={styles.dot} aria-hidden="true" />}
          {v.name}
        </button>
        {otherActions(v)}
      </span>
    );
  };

  const otherVersions = isMenu ? (
    <span className={styles.other}>
      <label className={styles.srOnly} htmlFor={otherId}>
        Other versions
      </label>
      <select id={otherId} className={styles.select} value={onScreen?.id ?? ''} onChange={(e) => e.target.value && show(e.target.value)}>
        {!onScreen && <option value="">Other versions…</option>}
        {others.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      {onScreen && otherActions(onScreen)}
    </span>
  ) : (
    others.length > 0 && (
      <div ref={chips} className={styles.chips}>
        {others.map((v) => (renaming === v.id ? renameField(v) : chip(v)))}
      </div>
    )
  );

  return (
    <div ref={root} className={[styles.strip, className].filter(Boolean).join(' ')} role="group" aria-label="Versions">
      <span className={styles.selected}>
        <span className={styles.label}>Selected</span>
        {renaming === selected.id ? (
          renameField(selected)
        ) : (
          <button
            type="button"
            className={styles.name}
            aria-current={shownId === selected.id ? 'true' : undefined}
            data-version-id={selected.id}
            onClick={() => show(selected.id)}
            onDoubleClick={() => setRenaming(selected.id)}
          >
            {selected.name}
          </button>
        )}
        <IconButton size="sm" label={`Rename ${selected.name}`} icon={<Pencil size={11} />} onClick={() => setRenaming(selected.id)} />
        {versions.length > 1 && (
          <IconButton size="sm" label={`Delete ${selected.name}`} icon={<Trash2 size={11} />} onClick={() => deleteVersionOf(asset.id, selected.id)} />
        )}
      </span>
      {otherVersions}
      <span id={hintId} hidden>
        Shows this version. Its check makes it the one the photo uses in the grid, albums and exports.
      </span>
      <Button size="sm" variant="ghost" className={styles.add} onClick={newVersion}>
        <CopyPlus size={13} />
        New version
      </Button>
    </div>
  );
}
