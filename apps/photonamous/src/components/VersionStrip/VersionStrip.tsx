import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyPlus, Pencil, Star, Trash2 } from 'lucide-react';
import type { Version, VersionId } from '@lopsy/photos-core/library/types';
import { useLibraryView, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { deleteVersionOf, makeShownVersion, newVersion } from '../../app/commands';
import { itemForVersion, parseItem, versionsByAsset, type ItemId } from '../../library/items';
import { selectOne } from '../../library/selection';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './VersionStrip.module.css';

/** Up to this many versions show as chips; more are chosen from a dropdown. */
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
 * A photo's versions: switch between them, choose the shown one, add, rename
 * and delete (never the last). Up to four are chips, which scroll sideways
 * on their own when there is no room; more are a dropdown with the chosen
 * version's actions beside it.
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
  const selectId = useId();
  const current = versionId ?? asset?.primaryVersionId ?? null;
  const isMenu = versions.length > MAX_VERSION_CHIPS;

  // The chosen chip stays in sight when the chips scroll. Only the chips scroll: scrollIntoView would move the page too.
  useEffect(() => {
    const box = chips.current;
    const chip = box?.querySelector<HTMLElement>('[data-current="true"]');
    if (!box || !chip) return;
    const outer = box.getBoundingClientRect();
    const inner = chip.getBoundingClientRect();
    if (inner.left < outer.left) box.scrollLeft -= outer.left - inner.left + SCROLL_MARGIN;
    else if (inner.right > outer.right) box.scrollLeft += inner.right - outer.right + SCROLL_MARGIN;
  }, [current, versions.length, isMenu]);

  useEffect(() => {
    const id = refocus.current;
    if (renaming !== null || id === null) return;
    refocus.current = null;
    const target = isMenu ? root.current?.querySelector('select') : root.current?.querySelector(`[data-version-id="${CSS.escape(id)}"]`);
    if (target instanceof HTMLElement) target.focus();
  }, [renaming, isMenu]);

  if (!asset || current === null) return null;
  const choose = (id: VersionId) => useUi.getState().setSelection(selectOne(itemForVersion(view, asset.id, id)));
  const chosen = versions.find((v) => v.id === current);

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
        refocus.current = v.id;
        e.currentTarget.blur();
      }}
    />
  );

  const actions = (v: Version) => (
    <>
      <IconButton size="sm" label={`Rename ${v.name}`} icon={<Pencil size={11} />} onClick={() => setRenaming(v.id)} />
      {v.id === asset.primaryVersionId ? (
        <span className={styles.shown} title="The photo shows this version in the grid and in albums">
          Shown
        </span>
      ) : (
        <IconButton
          size="sm"
          label={`Show ${v.name} for this photo`}
          icon={<Star size={11} />}
          onClick={() => makeShownVersion(asset.id, v.id)}
        />
      )}
      {versions.length > 1 && (
        <IconButton size="sm" label={`Delete ${v.name}`} icon={<Trash2 size={11} />} onClick={() => deleteVersionOf(asset.id, v.id)} />
      )}
    </>
  );

  const chip = (v: Version) => (
    <span key={v.id} className={styles.version} data-current={v.id === current}>
      <button
        type="button"
        className={styles.name}
        aria-pressed={v.id === current}
        data-version-id={v.id}
        onClick={() => choose(v.id)}
        onDoubleClick={() => setRenaming(v.id)}
      >
        {v.name}
      </button>
      {actions(v)}
    </span>
  );

  const chipList = (
    <div ref={chips} className={styles.chips}>
      {versions.map((v) => (renaming === v.id ? renameField(v) : chip(v)))}
    </div>
  );

  const dropdown =
    chosen && renaming === chosen.id ? (
      renameField(chosen)
    ) : (
      <span className={styles.current}>
        <select id={selectId} className={styles.select} value={current} onChange={(e) => choose(e.target.value)}>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {chosen && actions(chosen)}
      </span>
    );

  return (
    <div ref={root} className={[styles.strip, className].filter(Boolean).join(' ')} role="group" aria-label="Versions">
      {isMenu ? (
        <label className={styles.title} htmlFor={selectId}>
          Versions
        </label>
      ) : (
        <span className={styles.title}>Versions</span>
      )}
      {isMenu ? dropdown : chipList}
      <Button size="sm" variant="ghost" className={styles.add} onClick={newVersion}>
        <CopyPlus size={13} />
        New version
      </Button>
    </div>
  );
}
