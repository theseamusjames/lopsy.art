import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Check, GripVertical, RectangleHorizontal, RectangleVertical, RotateCcw, X } from 'lucide-react';
import {
  ASPECT_PRESETS,
  FULL_RECT,
  aspectRatio,
  cropPixels,
  dragCrop,
  fitAspect,
  type AspectId,
  type CropHandle,
  type Rect,
} from '../../engine/crop';
import { BAR_CLEARANCE, BAR_EDGE_GAP, CROP_EDGES, cropAfterEdgeKey, cropWithField, edgePosition, edgeValueText, isBarOnTop, type CropEdge, type CropField, type PixelSize } from '../crop-keys';
import { barOffset, isBarDrag, isBarHigh, loadBarPlace, otherEnd, placeAfterKey, placeAt, saveBarPlace, type BarPlace, type Size } from '../crop-bar';
import styles from './CropTool.module.css';

export interface CropToolProps {
  /** Where the whole framed image is on the stage, in CSS pixels. */
  readonly imageBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** The framed image's full size in pixels. */
  readonly imageSize: PixelSize;
  /** The crop being edited, normalized to the framed image. */
  readonly rect: Rect;
  readonly onChange: (rect: Rect) => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  /** The room, in CSS pixels, the options want clear under the photo: kept for the whole crop, 0 when they start where the user put them. */
  readonly onBarRoom?: (bottom: number) => void;
}

const CORNERS: readonly Exclude<CropHandle, 'move' | CropEdge>[] = ['nw', 'ne', 'se', 'sw'];

const EDGE_NAMES: Readonly<Record<CropEdge, string>> = { n: 'Top edge', e: 'Right edge', s: 'Bottom edge', w: 'Left edge' };

const FIELDS: readonly { readonly id: CropField; readonly label: string }[] = [
  { id: 'x', label: 'Left' },
  { id: 'y', label: 'Top' },
  { id: 'width', label: 'Width' },
  { id: 'height', label: 'Height' },
];

interface Drag {
  readonly pointerId: number;
  readonly handle: CropHandle;
  readonly startX: number;
  readonly startY: number;
  readonly start: Rect;
}

/** The stage's size and the options bar's, and where the bar is on the stage, in CSS pixels. */
interface BarLayout {
  readonly stage: Size;
  readonly bar: Size;
  readonly left: number;
  readonly top: number;
}

interface GripDrag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly from: BarLayout;
  /** Null while the pointer is in the dead zone, where letting go is a click; then where the drag has put the bar. */
  place: BarPlace | null;
}

function measureBar(root: HTMLElement, bar: HTMLElement): BarLayout {
  const rootBox = root.getBoundingClientRect();
  const barBox = bar.getBoundingClientRect();
  return {
    stage: { width: root.clientWidth, height: root.clientHeight },
    bar: { width: bar.offsetWidth, height: bar.offsetHeight },
    left: barBox.left - rootBox.left,
    top: barBox.top - rootBox.top,
  };
}

const isSameSize = (a: Size, b: Size): boolean => a.width === b.width && a.height === b.height;

/**
 * The crop overlay: a rectangle with a thirds grid over the whole framed
 * image, moved by dragging inside it and resized by its handles, with
 * aspect presets and the crop in pixels in a bar below (above, when it
 * would hide the crop's bottom edge) until its grip moves it anywhere on
 * the stage (crop-bar.ts). Each edge is also a slider for the keyboard.
 * Enter or Done commits, Esc cancels.
 */
export function CropTool({ imageBox, imageSize, rect, onChange, onDone, onCancel, onBarRoom }: CropToolProps) {
  const imageAspect = imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
  const [aspect, setAspect] = useState<AspectId>('free');
  const [isPortrait, setIsPortrait] = useState(imageAspect < 1);
  const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);
  const [field, setField] = useState<{ readonly id: CropField; readonly text: string } | null>(null);
  const [focusedEdge, setFocusedEdge] = useState<CropEdge | null>(null);
  const [sizes, setSizes] = useState<{ readonly stage: Size; readonly bar: Size }>({ stage: { width: 0, height: 0 }, bar: { width: 0, height: 0 } });
  // Null until the user moves the bar: it then stays where they put it, on this device.
  const [barPlace, setBarPlace] = useState<BarPlace | null>(loadBarPlace);
  // A crop that opens with the bar in its own place keeps room for it under the photo until it closes, moved or not,
  // so the photo neither sits under the bar nor jumps when the grip moves it.
  const [isKeepingRoom] = useState(() => barPlace === null);
  const drag = useRef<Drag | null>(null);
  const gripDrag = useRef<GripDrag | null>(null);
  const isAfterGripDrag = useRef(false);
  const firstEdge = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const gripHintId = useId();
  const ratio = aspectRatio(aspect, imageAspect, isPortrait);

  useEffect(() => {
    firstEdge.current?.focus();
  }, []);

  // The bar's place depends on how big it and the stage are, measured before the first paint and on resizes.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || !bar) return;
    const measure = () => {
      const { stage, bar: barSize } = measureBar(root, bar);
      setSizes((s) => (isSameSize(s.stage, stage) && isSameSize(s.bar, barSize) ? s : { stage, bar: barSize }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const room = isKeepingRoom && sizes.bar.height > 0 ? sizes.bar.height + BAR_EDGE_GAP : 0;
  const onBarRoomRef = useRef(onBarRoom);
  onBarRoomRef.current = onBarRoom;
  useEffect(() => {
    onBarRoomRef.current?.(room);
  }, [room]);
  useEffect(() => () => onBarRoomRef.current?.(0), []);

  const keys = useRef({ onDone, onCancel });
  keys.current = { onDone, onCancel };
  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.tagName === 'SELECT') return;
      if (e.key === 'Enter') {
        // A button does its own thing with Enter; a field has already taken what was typed. A slider takes no Enter.
        if (target?.tagName === 'BUTTON' || (target instanceof HTMLInputElement && target.type !== 'range')) return;
        e.preventDefault();
        keys.current.onDone();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        keys.current.onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const applyAspect = (nextAspect: AspectId, nextPortrait: boolean) => {
    setAspect(nextAspect);
    setIsPortrait(nextPortrait);
    const r = aspectRatio(nextAspect, imageAspect, nextPortrait);
    if (r !== null) onChange(fitAspect(nextAspect === aspect && nextPortrait !== isPortrait ? FULL_RECT : rect, r, imageAspect));
  };

  const handlePointerDown = (handle: CropHandle) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, handle, startX: e.clientX, startY: e.clientY, start: rect };
    setActiveHandle(handle);
  };

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || imageBox.width <= 0 || imageBox.height <= 0) return;
    const dx = (e.clientX - d.startX) / imageBox.width;
    const dy = (e.clientY - d.startY) / imageBox.height;
    onChange(dragCrop(d.start, d.handle, dx, dy, ratio, imageAspect));
  };

  const handlePointerUp = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setActiveHandle(null);
  };

  const handleEdgeKey = (edge: CropEdge) => (e: KeyboardEvent<HTMLDivElement>) => {
    const next = cropAfterEdgeKey(rect, edge, e.key, e.shiftKey, ratio, imageAspect);
    if (!next) return;
    e.preventDefault();
    onChange(next);
  };

  const handleFieldChange = (id: CropField, text: string) => {
    setField({ id, text });
    const value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value)) return;
    onChange(cropWithField(rect, id, value, imageSize, ratio));
  };

  const barLayout = (): BarLayout | null => (rootRef.current && barRef.current ? measureBar(rootRef.current, barRef.current) : null);

  /** The bar's place: the one the user gave it, or the one it took for itself. */
  const placeOfBar = (layout: BarLayout): BarPlace => barPlace ?? placeAt(layout.left, layout.top, layout.stage, layout.bar);

  const moveBar = (place: BarPlace) => {
    setBarPlace(place);
    saveBarPlace(place);
  };

  const handleGripPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const from = barLayout();
    if (!from) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gripDrag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, from, place: null };
    isAfterGripDrag.current = false;
  };

  const handleGripPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = gripDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.place && !isBarDrag(dx, dy)) return;
    d.place = placeAt(d.from.left + dx, d.from.top + dy, d.from.stage, d.from.bar);
    setBarPlace(d.place);
  };

  const handleGripPointerEnd = (e: PointerEvent<HTMLButtonElement>) => {
    const d = gripDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    gripDrag.current = null;
    if (!d.place) return;
    saveBarPlace(d.place);
    // The click that follows a drag's pointerup only ends the drag.
    isAfterGripDrag.current = e.type === 'pointerup';
  };

  const handleGripClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Enter and Space click with no detail: they never end a drag.
    if (isAfterGripDrag.current && e.detail > 0) {
      isAfterGripDrag.current = false;
      return;
    }
    const layout = barLayout();
    if (layout) moveBar(otherEnd(placeOfBar(layout)));
  };

  const handleGripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const layout = barLayout();
    if (!layout) return;
    const next = placeAfterKey(placeOfBar(layout), e.key, e.shiftKey, layout.stage, layout.bar);
    if (!next) return;
    e.preventDefault();
    moveBar(next);
  };

  const box = {
    '--crop-left': `${imageBox.left + rect.x * imageBox.width}px`,
    '--crop-top': `${imageBox.top + rect.y * imageBox.height}px`,
    '--crop-width': `${rect.width * imageBox.width}px`,
    '--crop-height': `${rect.height * imageBox.height}px`,
  } as CSSProperties;

  const pointerHandlers = {
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
  };

  const pixels = cropPixels(rect, imageSize.width, imageSize.height);
  const isBottomInUse = focusedEdge === 's' || activeHandle === 's' || activeHandle === 'se' || activeHandle === 'sw';
  const isBarAtTop =
    sizes.stage.height > 0 &&
    isBarOnTop(
      { top: imageBox.top + rect.y * imageBox.height, bottom: imageBox.top + (rect.y + rect.height) * imageBox.height },
      sizes.stage.height,
      sizes.bar.height + BAR_CLEARANCE,
      isBottomInUse,
    );
  const movedTo = barPlace ? barOffset(barPlace, sizes.stage, sizes.bar) : null;
  // From the stage's centre line, where a moved bar's left: 50% still puts it (CropTool.module.css).
  const barStyle = movedTo
    ? ({ '--bar-shift': `${movedTo.left - sizes.stage.width / 2}px`, '--bar-top': `${movedTo.top}px` } as CSSProperties)
    : undefined;
  const clickSendsBarTo = (barPlace ? isBarHigh(barPlace) : isBarAtTop) ? 'bottom' : 'top';

  return (
    <div ref={rootRef} className={styles.cropTool} role="group" aria-label="Crop" data-testid="crop-tool">
      <div className={styles.rect} style={box} onPointerDown={handlePointerDown('move')} {...pointerHandlers} data-testid="crop-rect">
        <div className={styles.thirds} />
        {CORNERS.map((h) => (
          <span
            key={h}
            className={styles.handle}
            data-handle={h}
            data-active={activeHandle === h || undefined}
            aria-hidden="true"
            onPointerDown={handlePointerDown(h)}
            {...pointerHandlers}
          />
        ))}
        {CROP_EDGES.map((edge) => (
          <div
            key={edge}
            ref={edge === CROP_EDGES[0] ? firstEdge : undefined}
            className={styles.handle}
            data-handle={edge}
            data-active={activeHandle === edge || undefined}
            role="slider"
            tabIndex={0}
            aria-label={EDGE_NAMES[edge]}
            aria-orientation={edge === 'n' || edge === 's' ? 'vertical' : 'horizontal'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(edgePosition(rect, edge) * 100)}
            aria-valuetext={edgeValueText(rect, edge, imageSize)}
            aria-describedby={hintId}
            onPointerDown={handlePointerDown(edge)}
            onKeyDown={handleEdgeKey(edge)}
            onFocus={() => setFocusedEdge(edge)}
            onBlur={() => setFocusedEdge(null)}
            {...pointerHandlers}
          />
        ))}
      </div>
      <p id={hintId} className={styles.srOnly}>
        Arrow keys move the edge, Shift for bigger steps. Enter applies the crop, Escape cancels it.
      </p>
      <p id={gripHintId} className={styles.srOnly}>
        Drag it, or press the arrow keys, to move the crop options anywhere on the photo. Enter, or a click, moves them to the top or the bottom.
      </p>
      <div
        ref={barRef}
        className={styles.bar}
        role="group"
        aria-label="Crop options"
        data-place={barPlace ? 'moved' : isBarAtTop ? 'top' : 'bottom'}
        style={barStyle}
      >
        {/* Two columns: the grip, the full height of the options, and the options themselves, centred in theirs. */}
        <button
          type="button"
          className={styles.grip}
          aria-label="Move crop options"
          aria-describedby={gripHintId}
          title={`Drag to move the crop options, or click to move them to the ${clickSendsBarTo}`}
          onPointerDown={handleGripPointerDown}
          onPointerMove={handleGripPointerMove}
          onPointerUp={handleGripPointerEnd}
          onPointerCancel={handleGripPointerEnd}
          onClick={handleGripClick}
          onKeyDown={handleGripKey}
        >
          <GripVertical size={16} aria-hidden />
        </button>
        <div className={styles.controls}>
          <div className={styles.row}>
            <select
              className={styles.select}
              aria-label="Aspect"
              value={aspect}
              onChange={(e) => applyAspect(e.currentTarget.value as AspectId, isPortrait)}
            >
              {ASPECT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={isPortrait ? 'Make landscape' : 'Make portrait'}
              title={isPortrait ? 'Landscape' : 'Portrait'}
              disabled={aspect === 'free' || aspect === '1:1'}
              onClick={() => applyAspect(aspect, !isPortrait)}
            >
              {isPortrait ? <RectangleVertical size={16} aria-hidden /> : <RectangleHorizontal size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setAspect('free');
                onChange(FULL_RECT);
              }}
            >
              <RotateCcw size={14} aria-hidden />
              <span>Reset</span>
            </button>
            <button type="button" className={styles.button} onClick={onCancel}>
              <X size={14} aria-hidden />
              <span>Cancel</span>
            </button>
            <button type="button" className={styles.primary} onClick={onDone}>
              <Check size={14} aria-hidden />
              <span>Done</span>
            </button>
          </div>
          <fieldset className={styles.fields}>
            <legend className={styles.srOnly}>Crop in pixels</legend>
            {FIELDS.map((f) => (
              <label key={f.id} className={styles.field}>
                <span>{f.label}</span>
                <input
                  className={styles.number}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={f.id === 'x' || f.id === 'width' ? imageSize.width : imageSize.height}
                  step={1}
                  value={field?.id === f.id ? field.text : String(pixels[f.id])}
                  onFocus={() => setField({ id: f.id, text: String(pixels[f.id]) })}
                  onChange={(e) => handleFieldChange(f.id, e.currentTarget.value)}
                  onBlur={() => setField(null)}
                />
              </label>
            ))}
            <span className={styles.unit} aria-hidden="true">
              px
            </span>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
