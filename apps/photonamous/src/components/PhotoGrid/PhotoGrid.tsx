import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useUi } from '../../app/store';
import { anchorScroll, gridGeometry, renderedRows, scrollToReveal, visibleRange, type GridGeometry } from '../../library/grid-window';
import { gridKeyAction, rowsPerPage } from '../../library/grid-keys';
import { focusAt, selectOne, selectRange, toggleOne } from '../../library/selection';
import { PhotoTile } from '../PhotoTile/PhotoTile';
import { TileMenu } from '../TileMenu/TileMenu';
import styles from './PhotoGrid.module.css';

const GAP = 6;
const PADDING = 12;

interface PhotoGridProps {
  orderedIds: readonly AssetId[];
}

function tileFor(root: HTMLElement | null, id: string | null): HTMLElement | null {
  if (!root || id === null) return null;
  return root.querySelector<HTMLElement>(`[role="gridcell"][data-item-id="${CSS.escape(id)}"]`);
}

/** Focus went nowhere: what had it was removed, or a layer that held it closed. */
function isLost(active: Element | null): boolean {
  return active === null || active === document.body;
}

function isTile(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && el.getAttribute('role') === 'gridcell';
}

/**
 * The virtualized grid: only the rows in view are in the DOM, plus the row
 * of the focused photo. One tab stop (the focused tile); the arrows are the
 * shortcut registry's, the other grid keys are handled here.
 */
export function PhotoGrid({ orderedIds }: PhotoGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const thumbSize = useUi((s) => s.thumbSize);
  const selection = useUi((s) => s.selection);
  const setSelection = useUi((s) => s.setSelection);
  const setGridColumns = useUi((s) => s.setGridColumns);
  const setMode = useUi((s) => s.setMode);
  // The layers that take focus from the grid while they are open: a viewer, a dialog, the Edit view.
  const layer = useUi((s) => `${s.mode}:${s.dialog !== null && s.dialog !== 'help' && s.dialog !== 'sync'}:${s.editing !== null}`);

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

  const focusIndex = useMemo(
    () => (selection.focus === null ? -1 : orderedIds.indexOf(selection.focus)),
    [orderedIds, selection.focus],
  );

  // Bring the focused photo into view when the keyboard moves it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || focusIndex < 0) return;
    const target = scrollToReveal(geometry, focusIndex, el.scrollTop - PADDING, el.clientHeight - PADDING * 2);
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

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Closing the menu puts focus back on the photo it was opened on, unless the user went elsewhere.
  const closeMenu = useCallback(() => {
    const active = document.activeElement;
    const inMenu = menuRef.current !== null && active !== null && menuRef.current.contains(active);
    setMenu(null);
    if (inMenu || isLost(active)) tileFor(scrollRef.current, useUi.getState().selection.focus)?.focus({ preventScroll: true });
  }, []);

  /** Opens the photo actions on a tile; a photo outside the selection is acted on alone, as with a right-click. */
  const openMenu = useCallback(
    (tile: HTMLElement, at: { x: number; y: number } | null) => {
      const id = tile.dataset.itemId;
      if (!id) return;
      const current = useUi.getState().selection;
      if (!current.ids.has(id)) setSelection(selectOne(id));
      else setSelection({ ...current, focus: id });
      const r = tile.getBoundingClientRect();
      setMenu(at ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    },
    [setSelection],
  );

  // The menu focuses its first item; when that one is disabled, the first that is not.
  useEffect(() => {
    const host = menuRef.current;
    if (!menu || !host || host.contains(document.activeElement)) return;
    host.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [menu]);

  const onOpen = useCallback(
    (id: AssetId) => {
      setSelection(selectOne(id));
      setMode('single');
    },
    [setSelection, setMode],
  );

  const range = visibleRange(geometry, orderedIds.length, scrollTop - PADDING, size.height, 3);
  const inView = visibleRange(geometry, orderedIds.length, scrollTop - PADDING, size.height, 0);
  const tabStop = orderedIds[focusIndex >= 0 ? focusIndex : Math.min(inView.startIndex, orderedIds.length - 1)] ?? null;
  const rows = renderedRows(geometry, range, focusIndex).map((row) => ({
    row,
    ids: orderedIds.slice(row * geometry.columns, (row + 1) * geometry.columns) as AssetId[],
  }));

  // Whether keyboard focus belongs in the grid: it went to a tile, and the user has not gone elsewhere since.
  const focusWithin = useRef(false);
  useEffect(() => {
    const onFocusIn = (e: globalThis.FocusEvent) => {
      const el = scrollRef.current;
      focusWithin.current = el !== null && e.target instanceof Node && el.contains(e.target);
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = scrollRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) focusWithin.current = false;
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  /**
   * Keeps keyboard focus on the focused photo's tile: it follows the arrows,
   * survives the tile being re-rendered or removed (deleted, set aside,
   * filtered out, moved by a new column count), and comes back when a
   * viewer, dialog or the Edit view that held it closes.
   */
  const focusSeen = useRef(selection.focus);
  const layerSeen = useRef<string | null>(null);
  const focusHome = () => {
    const el = scrollRef.current;
    const home = tileFor(el, selection.focus) ?? tileFor(el, tabStop);
    if (home && home !== document.activeElement) home.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const moved = focusSeen.current !== selection.focus;
    focusSeen.current = selection.focus;
    const active = document.activeElement;
    const onTile = isTile(active) && scrollRef.current?.contains(active) === true;
    // Escape clears the selection, not the place in the grid: the tile with focus stays the focused photo.
    const kept = onTile && selection.focus === null ? active.dataset.itemId : undefined;
    if (kept) {
      setSelection({ ...selection, focus: kept });
      return;
    }
    if (onTile || (isLost(active) && (focusWithin.current || (moved && selection.focus !== null)))) focusHome();
  });
  useEffect(() => {
    const mounting = layerSeen.current === null;
    const reopened = !mounting && layerSeen.current !== layer && layer === 'grid:false:false';
    layerSeen.current = layer;
    const active = document.activeElement;
    const onTile = isTile(active) && scrollRef.current?.contains(active) === true;
    const returning = (mounting && selection.focus !== null) || reopened;
    if (onTile || (isLost(active) && (focusWithin.current || returning))) focusHome();
  });

  // A tile reached with Tab while no photo is focused becomes the focused one, so the keys act on it.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (!isTile(e.target)) return;
    const id = e.target.dataset.itemId;
    const current = useUi.getState().selection;
    if (id && (current.focus === null || !orderedIds.includes(current.focus))) setSelection({ ...current, focus: id });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || !isTile(e.target)) return;
    const current = useUi.getState().selection;
    const index = current.focus === null ? -1 : orderedIds.indexOf(current.focus);
    const pageRows = rowsPerPage(size.height - PADDING * 2, geometry.rowHeight);
    const action = gridKeyAction(e, { index, count: orderedIds.length, columns: geometry.columns, pageRows });
    if (action === null) return;
    e.preventDefault();
    if (action.kind === 'focus') setSelection(focusAt(current, orderedIds, action.index, action.how));
    else if (action.kind === 'toggle' && current.focus !== null) setSelection(toggleOne(current, current.focus));
    else if (action.kind === 'menu') {
      const tile = tileFor(scrollRef.current, current.focus);
      if (tile) openMenu(tile, null);
    }
  };

  return (
    <>
      <div
        ref={scrollRef}
        className={styles.scroller}
        onScroll={onScroll}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelection({ ...selection, ids: new Set() });
        }}
        onContextMenu={(e) => {
          const tile = e.target instanceof Element ? e.target.closest<HTMLElement>('[role="gridcell"][data-item-id]') : null;
          if (!tile) return;
          e.preventDefault();
          // A menu opened from the keyboard has no pointer position on the tile.
          const r = tile.getBoundingClientRect();
          const onTile = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          openMenu(tile, onTile ? { x: e.clientX, y: e.clientY } : null);
        }}
        role="grid"
        aria-label="Photos"
        aria-rowcount={geometry.rowCount}
        aria-colcount={geometry.columns}
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
          {rows.map(({ row, ids }) => (
            <div
              key={row}
              className={styles.row}
              role="row"
              aria-rowindex={row + 1}
              style={{ '--row-top': `${PADDING + row * geometry.rowHeight}px` } as React.CSSProperties}
            >
              {ids.map((id, column) => (
                <PhotoTile
                  key={id}
                  assetId={id}
                  column={column + 1}
                  selected={selection.ids.has(id)}
                  focused={selection.focus === id}
                  tabbable={tabStop === id}
                  onPick={onPick}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {menu && (
        <div ref={menuRef} className={styles.menuHost}>
          <TileMenu x={menu.x} y={menu.y} orderedIds={orderedIds} onClose={closeMenu} />
        </div>
      )}
    </>
  );
}
