import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useUi } from '../../app/store';
import { anchorScroll, gridGeometry, scrollToReveal, visibleRange, type GridGeometry } from '../../library/grid-window';
import { selectOne, selectRange, toggleOne } from '../../library/selection';
import { PhotoTile } from '../PhotoTile/PhotoTile';
import styles from './PhotoGrid.module.css';

const GAP = 6;
const PADDING = 12;

interface PhotoGridProps {
  orderedIds: readonly AssetId[];
}

/** The virtualized grid: only the rows in view are in the DOM. */
export function PhotoGrid({ orderedIds }: PhotoGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const thumbSize = useUi((s) => s.thumbSize);
  const selection = useUi((s) => s.selection);
  const setSelection = useUi((s) => s.setSelection);
  const setGridColumns = useUi((s) => s.setGridColumns);
  const setMode = useUi((s) => s.setMode);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(
    () => gridGeometry({ width: size.width - PADDING * 2, targetSize: thumbSize, gap: GAP, itemCount: orderedIds.length }),
    [size.width, thumbSize, orderedIds.length],
  );

  useEffect(() => setGridColumns(geometry.columns), [geometry.columns, setGridColumns]);

  // Keep the first visible photo in place when the tile size changes.
  const previous = useRef<GridGeometry | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const before = previous.current;
    previous.current = geometry;
    if (!el || !before || before.columns === geometry.columns) return;
    el.scrollTop = anchorScroll(before, geometry, Math.max(0, el.scrollTop - PADDING)) + (el.scrollTop > 0 ? PADDING : 0);
  }, [geometry]);

  // Bring the focused photo into view when the keyboard moves it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || selection.focus === null) return;
    const index = orderedIds.indexOf(selection.focus);
    const target = scrollToReveal(geometry, index, el.scrollTop - PADDING, el.clientHeight - PADDING * 2);
    if (target !== null) el.scrollTop = target + (target > 0 ? PADDING : 0);
    // Only when the focus moves, not on every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.focus]);

  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onPick = useCallback(
    (id: AssetId, e: MouseEvent) => {
      const current = useUi.getState().selection;
      if (e.shiftKey) setSelection(selectRange(current, orderedIds, id, e.metaKey || e.ctrlKey));
      else if (e.metaKey || e.ctrlKey) setSelection(toggleOne(current, id));
      else setSelection(selectOne(id));
    },
    [orderedIds, setSelection],
  );

  const onOpen = useCallback(
    (id: AssetId) => {
      setSelection(selectOne(id));
      setMode('single');
    },
    [setSelection, setMode],
  );

  const range = visibleRange(geometry, orderedIds.length, scrollTop - PADDING, size.height, 3);
  const rows: AssetId[][] = [];
  for (let r = range.firstRow; r <= range.lastRow; r++) {
    rows.push(orderedIds.slice(r * geometry.columns, (r + 1) * geometry.columns) as AssetId[]);
  }

  return (
    <div
      ref={scrollRef}
      className={styles.scroller}
      onScroll={onScroll}
      onClick={(e) => {
        if (e.target === e.currentTarget) setSelection({ ...selection, ids: new Set() });
      }}
      role="grid"
      aria-label="Photos"
      aria-rowcount={geometry.rowCount}
      aria-multiselectable="true"
    >
      <div
        className={styles.spacer}
        style={
          {
            '--grid-height': `${geometry.totalHeight + PADDING * 2}px`,
            '--grid-columns': geometry.columns,
            '--tile-size': `${geometry.tileSize}px`,
            '--grid-gap': `${GAP}px`,
            '--grid-padding': `${PADDING}px`,
          } as React.CSSProperties
        }
      >
        {rows.map((ids, i) => {
          const row = range.firstRow + i;
          return (
            <div
              key={row}
              className={styles.row}
              role="row"
              aria-rowindex={row + 1}
              style={{ '--row-top': `${PADDING + row * geometry.rowHeight}px` } as React.CSSProperties}
            >
              {ids.map((id) => (
                <PhotoTile
                  key={id}
                  assetId={id}
                  selected={selection.ids.has(id)}
                  focused={selection.focus === id}
                  onPick={onPick}
                  onOpen={onOpen}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
