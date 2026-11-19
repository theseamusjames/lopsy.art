import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, RectangleHorizontal, RectangleVertical, RotateCcw, X } from 'lucide-react';
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
import { BAR_CLEARANCE, CROP_EDGES, cropAfterEdgeKey, cropWithField, edgePosition, edgeValueText, isBarOnTop, type CropEdge, type CropField, type PixelSize } from '../crop-keys';
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

/**
 * The crop overlay: a rectangle with a thirds grid over the whole framed
 * image, moved by dragging inside it and resized by its handles, with
 * aspect presets and the crop in pixels in a bar below (above, when it
 * would hide the crop's bottom edge). Each edge is also a slider for the
 * keyboard. Enter or Done commits, Esc cancels.
 */
export function CropTool({ imageBox, imageSize, rect, onChange, onDone, onCancel }: CropToolProps) {
  const imageAspect = imageSize.height > 0 ? imageSize.width / imageSize.height : 1;
  const [aspect, setAspect] = useState<AspectId>('free');
  const [isPortrait, setIsPortrait] = useState(imageAspect < 1);
  const [activeHandle, setActiveHandle] = useState<CropHandle | null>(null);
  const [field, setField] = useState<{ readonly id: CropField; readonly text: string } | null>(null);
  const [focusedEdge, setFocusedEdge] = useState<CropEdge | null>(null);
  const [heights, setHeights] = useState({ stage: 0, bar: 0 });
  const drag = useRef<Drag | null>(null);
  const firstEdge = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const ratio = aspectRatio(aspect, imageAspect, isPortrait);

  useEffect(() => {
    firstEdge.current?.focus();
  }, []);

  // The bar's place depends on how tall it and the stage are, measured before the first paint and on resizes.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || !bar) return;
    const measure = () => {
      const stage = root.clientHeight;
      const height = bar.offsetHeight;
      setHeights((h) => (h.stage === stage && h.bar === height ? h : { stage, bar: height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

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
    heights.stage > 0 &&
    isBarOnTop(
      { top: imageBox.top + rect.y * imageBox.height, bottom: imageBox.top + (rect.y + rect.height) * imageBox.height },
      heights.stage,
      heights.bar + BAR_CLEARANCE,
      isBottomInUse,
    );

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
      <div ref={barRef} className={styles.bar} role="group" aria-label="Crop options" data-place={isBarAtTop ? 'top' : 'bottom'}>
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
  );
}
