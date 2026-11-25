import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useLibraryView } from '../../app/hooks';
import { useUi } from '../../app/store';
import { backOut, setLabel, setRating } from '../../app/commands';
import { orderedSelection } from '../../library/selection';
import { parseItem } from '../../library/items';
import { Button } from '../Button/Button';
import { LabelPicker } from '../LabelPicker/LabelPicker';
import { Preview, type ZoomPoint } from '../Preview/Preview';
import { Stars } from '../Stars/Stars';
import { useViewFocus } from '../SingleView/use-view-focus';
import { ViewBar } from '../ViewBar/ViewBar';
import { isControlKey } from '../LibraryScreen/control-keys';
import styles from './CompareView.module.css';


interface CompareViewProps {
  orderedIds: readonly AssetId[];
}

/**
 * Photos side by side: two up, or up to four. Clicking one makes it the
 * one the keys act on. With more than two on show each has a tick; two
 * ticked are what Two up, in the bar underneath, then shows.
 */
export function CompareView({ orderedIds }: CompareViewProps) {
  const view = useLibraryView();
  const selection = useUi((s) => s.selection);
  const setSelection = useUi((s) => s.setSelection);
  const size = useUi((s) => s.compareSize);
  const ids = orderedSelection(selection, orderedIds).slice(0, size);
  /** The photos ticked, for narrowing four to two. Only ones still on show count. */
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const picked = ids.filter((id) => ticked.has(id));
  const tick = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setTicked(next);
  };
  const extra = selection.ids.size - ids.length;
  // One zoom for all panes, so the same spot is compared in each.
  const [zoom, setZoom] = useState<ZoomPoint | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useViewFocus(root);

  /** The photo the keys mark: the one clicked, the one keyboard focus is in, or Left and Right from the outlined one. */
  const mark = (id: string) => {
    const current = useUi.getState().selection;
    if (current.focus !== id) setSelection({ ...current, focus: id });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || isControlKey(e, e.target)) return;
    const at = selection.focus === null ? -1 : ids.indexOf(selection.focus);
    const next = ids[Math.max(0, Math.min(ids.length - 1, at + (e.key === 'ArrowLeft' ? -1 : 1)))];
    if (next === undefined) return;
    e.preventDefault();
    mark(next);
    root.current?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(next)}"]`)?.focus();
  };

  return (
    <>
    <div ref={root} className={styles.view} role="region" aria-labelledby={headingId} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className={styles.top}>
        <Button variant="ghost" size="sm" className={styles.back} onClick={backOut}>
          <ArrowLeft size={14} />
          Back
        </Button>
        <h1 id={headingId} className={styles.visuallyHidden}>
          Compare {ids.length} photos
        </h1>
        {extra > 0 && (
          <span className={styles.hint}>
            {extra} more selected photo{extra === 1 ? ' is' : 's are'} not shown.
          </span>
        )}
      </div>
      <div className={styles.panes} data-count={ids.length}>
        {ids.map((id) => {
          const { assetId, versionId } = parseItem(id);
          const asset = view.assets.get(assetId);
          if (!asset) return null;
          const version = view.versions.get(versionId ?? asset.primaryVersionId);
          const label = `${asset.fileName}${version && versionId !== null ? `, ${version.name}` : ''}`;
          return (
            <div
              key={id}
              className={styles.pane}
              role="group"
              aria-label={label}
              aria-current={selection.focus === id ? 'true' : undefined}
              tabIndex={-1}
              data-pane={id}
              data-focused={selection.focus === id}
              onClick={() => mark(id)}
              onFocus={() => mark(id)}
            >
              <div className={styles.image}>
                <Preview itemId={id} zoom={zoom} onZoom={setZoom} />
              </div>
              <div className={styles.caption}>
                <span className={styles.name}>
                  {asset.fileName}
                  {version && versionId !== null && ` · ${version.name}`}
                </span>
                <Stars rating={asset.rating} size={14} onChange={(r) => setRating(r, orderedIds, [assetId])} />
                <LabelPicker value={asset.label} onChange={(l) => setLabel(l, orderedIds, [assetId])} />
                {ids.length > 2 && (
                  <label className={styles.pick} title="Pick this one: Two up then shows the two picked">
                    <input type="checkbox" checked={ticked.has(id)} aria-label={`Pick ${label}`} onChange={(e) => tick(id, e.target.checked)} />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    {/* Under the photos, outside their region: the bar is the same one the gallery has. */}
    <ViewBar orderedIds={orderedIds} picked={picked} />
    </>
  );
}
