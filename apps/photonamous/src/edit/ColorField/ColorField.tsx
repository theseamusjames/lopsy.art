import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Maximize2 } from 'lucide-react';
import { HANDLES_ARROW_KEYS_ATTR } from '@lopsy/ui/a11y/arrow-keys';
import { FINE_STEP, colorToPoint, expandedBox, fieldCss, fieldNumber, pointToColor, stepColor, type FieldBox, type FieldColor } from './color-field';
import styles from './ColorField.module.css';

const KEY_STEP = 1;
const COARSE_KEY_STEP = 10;

export interface ColorFieldProps {
  /** What the colour is of ("Shadows color"): the field's name. */
  readonly label: string;
  /** Degrees, 0..360, to a tenth. */
  readonly hue: number;
  /** 0..100, to a tenth. */
  readonly saturation: number;
  readonly isDisabled?: boolean;
  /** Every change while the marker moves. */
  readonly onChange: (hue: number, saturation: number) => void;
  /** Once a change is let go (pointer up, key up); never when nothing changed. */
  readonly onCommit: (hue: number, saturation: number) => void;
}

/**
 * A hue and saturation picker: a square as wide as its column, hue left
 * to right and saturation fading to white at the bottom, with a marker on
 * the colour. Pressed or dragged it sets both at once, to a tenth: finer
 * than the sliders' whole steps, so each pixel is a colour of its own. The
 * arrow keys move the marker a step (ten with Shift, a tenth with Alt),
 * and the Hue and Saturation sliders beside it take a typed number. The
 * button in its bottom left corner enlarges it over the photo, where there
 * are more pixels, so more colours, to pick from; any
 * click, turn of the wheel or scroll puts it back, and so does Escape.
 * Over the field the pointer is a ring filled with the colour under it,
 * the one a press there would pick.
 */
export function ColorField({ label, hue, saturation, isDisabled = false, onChange, onCommit }: ColorFieldProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<(FieldBox & { readonly from: number }) | null>(null);
  const isExpanded = box !== null;
  const isDragging = useRef(false);
  /** The last change not yet committed. */
  const pending = useRef<FieldColor | null>(null);
  /** The colour under a mouse or pen over the field, which the pointer shows; null while it is elsewhere. */
  const [hover, setHover] = useState<FieldColor | null>(null);

  const change = (next: FieldColor) => {
    if (!pending.current && next.hue === hue && next.saturation === saturation) return;
    pending.current = next;
    onChange(next.hue, next.saturation);
  };
  const commitPending = () => {
    const last = pending.current;
    if (!last) return;
    pending.current = null;
    onCommit(last.hue, last.saturation);
  };
  const collapse = () => setBox(null);

  useEffect(() => {
    if (!isExpanded) return;
    const onDown = (e: Event) => {
      if (e.target instanceof Node && fieldRef.current?.contains(e.target)) return;
      setBox(null);
    };
    const shrink = () => setBox(null);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', shrink, { capture: true, passive: true });
    window.addEventListener('scroll', shrink, true);
    window.addEventListener('resize', shrink);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', shrink, true);
      window.removeEventListener('scroll', shrink, true);
      window.removeEventListener('resize', shrink);
    };
  }, [isExpanded]);

  const expand = () => {
    const slot = slotRef.current?.getBoundingClientRect();
    if (!slot) return;
    const next = expandedBox({ top: slot.top, right: slot.right }, { width: window.innerWidth, height: window.innerHeight });
    setBox({ ...next, from: next.size > 0 ? slot.width / next.size : 1 });
    fieldRef.current?.focus();
  };

  const colorAt = (e: PointerEvent<HTMLDivElement>): FieldColor => {
    const rect = e.currentTarget.getBoundingClientRect();
    return pointToColor(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
  };
  const apply = (e: PointerEvent<HTMLDivElement>) => change(colorAt(e));

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (isDisabled || e.button !== 0) return;
    isDragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    apply(e);
  };
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    // A finger has no pointer to show; it covers the spot anyway.
    if (e.pointerType !== 'touch') setHover(colorAt(e));
    if (isDragging.current) apply(e);
  };
  const endDrag = (isClick: boolean) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    commitPending();
    // Any click puts the enlarged field back, the one that picked the colour included.
    if (isClick) collapse();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    if (e.key === 'Escape' && isExpanded) {
      // The field's own Escape: the view must not take it as Back.
      e.preventDefault();
      collapse();
      return;
    }
    const next = stepColor({ hue, saturation }, e.key, e.altKey ? FINE_STEP : e.shiftKey ? COARSE_KEY_STEP : KEY_STEP);
    if (!next) return;
    e.preventDefault();
    change(next);
  };

  const point = colorToPoint({ hue, saturation });
  const vars = {
    '--puck-x': point.x,
    '--puck-y': point.y,
    '--puck-color': fieldCss({ hue, saturation }),
    ...(hover ? { '--hover-x': colorToPoint(hover).x, '--hover-y': colorToPoint(hover).y, '--hover-color': fieldCss(hover) } : {}),
    ...(box ? { '--field-left': `${box.left}px`, '--field-top': `${box.top}px`, '--field-size': `${box.size}px`, '--field-from': box.from } : {}),
  } as CSSProperties;

  return (
    <div ref={slotRef} className={styles.slot} style={vars}>
      <div
        ref={fieldRef}
        role="slider"
        tabIndex={isDisabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={saturation}
        aria-valuetext={`Hue ${fieldNumber(hue)}°, saturation ${fieldNumber(saturation)} %`}
        aria-disabled={isDisabled || undefined}
        {...{ [HANDLES_ARROW_KEYS_ATTR]: '' }}
        className={styles.field}
        data-expanded={isExpanded || undefined}
        data-testid="color-field"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={handleKeyDown}
        onKeyUp={commitPending}
        onBlur={() => {
          commitPending();
          collapse();
        }}
      >
        <span className={styles.puck} data-testid="color-marker" />
        {hover && !isDisabled && <span className={styles.pointer} data-testid="color-pointer" />}
      </div>
      <button
        type="button"
        className={styles.expand}
        aria-label={`Enlarge ${label}`}
        aria-expanded={isExpanded}
        title="Enlarge, for finer control"
        disabled={isDisabled}
        onClick={expand}
      >
        <Maximize2 size={14} aria-hidden />
      </button>
    </div>
  );
}
