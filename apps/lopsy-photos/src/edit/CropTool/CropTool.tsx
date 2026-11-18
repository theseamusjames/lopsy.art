import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Check, RectangleHorizontal, RectangleVertical, RotateCcw, X } from 'lucide-react';
import {
  ASPECT_PRESETS,
  FULL_RECT,
  aspectRatio,
  dragCrop,
  fitAspect,
  type AspectId,
  type CropHandle,
  type Rect,
} from '../../engine/crop';
import styles from './CropTool.module.css';

export interface CropToolProps {
  /** Where the whole framed image is on the stage, in CSS pixels. */
  readonly imageBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** Framed image width over height, in pixels. */
  readonly imageAspect: number;
  /** The crop being edited, normalized to the framed image. */
  readonly rect: Rect;
  readonly onChange: (rect: Rect) => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
}

const HANDLES: readonly Exclude<CropHandle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

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
 * aspect presets in a bar below. Enter or Done commits, Esc cancels.
 */
export function CropTool({ imageBox, imageAspect, rect, onChange, onDone, onCancel }: CropToolProps) {
  const [aspect, setAspect] = useState<AspectId>('free');
  const [isPortrait, setIsPortrait] = useState(imageAspect < 1);
  const drag = useRef<Drag | null>(null);
  const ratio = aspectRatio(aspect, imageAspect, isPortrait);

  const keys = useRef({ onDone, onCancel });
  keys.current = { onDone, onCancel };
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'SELECT' || target?.tagName === 'INPUT') return;
      if (e.key === 'Enter') {
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
  };

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || imageBox.width <= 0 || imageBox.height <= 0) return;
    const dx = (e.clientX - d.startX) / imageBox.width;
    const dy = (e.clientY - d.startY) / imageBox.height;
    onChange(dragCrop(d.start, d.handle, dx, dy, ratio, imageAspect));
  };

  const handlePointerUp = (e: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
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

  return (
    <div className={styles.cropTool} data-testid="crop-tool">
      <div className={styles.rect} style={box} onPointerDown={handlePointerDown('move')} {...pointerHandlers} data-testid="crop-rect">
        <div className={styles.thirds} />
        {HANDLES.map((h) => (
          <span
            key={h}
            className={styles.handle}
            data-handle={h}
            aria-label={`Crop handle ${h}`}
            onPointerDown={handlePointerDown(h)}
            {...pointerHandlers}
          />
        ))}
      </div>
      <div className={styles.bar} role="toolbar" aria-label="Crop">
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
    </div>
  );
}
