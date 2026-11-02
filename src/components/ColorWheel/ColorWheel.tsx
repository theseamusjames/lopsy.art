import { HANDLES_ARROW_KEYS_ATTR } from '../../app/shortcuts/native-control-keys';
import { hsvToRgb } from '../../utils/color';
import { pointerToWheel, stepWheel, wheelToPuck } from './color-wheel';
import styles from './ColorWheel.module.css';

const FINE_KEY_STEP = 1;
const COARSE_KEY_STEP = 10;

interface ColorWheelProps {
  label: string;
  hue: number;
  saturation: number;
  isActive?: boolean;
  onChange: (hue: number, saturation: number) => void;
  /** Fired when a press or focus lands on this wheel, before any change. */
  onActivate?: () => void;
}

export function ColorWheel({ label, hue, saturation, isActive, onChange, onActivate }: ColorWheelProps) {
  const puck = wheelToPuck(hue, saturation);
  const { r, g, b } = hsvToRgb({ h: hue % 360, s: saturation, v: 100 });

  const applyPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const next = pointerToWheel(
      e.clientX - rect.left - rect.width / 2,
      e.clientY - rect.top - rect.height / 2,
      rect.width / 2,
    );
    onChange(next.hue, next.saturation);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyPointer(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyPointer(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = stepWheel({ hue, saturation }, e.key, e.shiftKey ? COARSE_KEY_STEP : FINE_KEY_STEP);
    if (!next) return;
    e.preventDefault();
    onChange(next.hue, next.saturation);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${label} color wheel`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={saturation}
      aria-valuetext={`Hue ${hue} degrees, saturation ${saturation}`}
      {...{ [HANDLES_ARROW_KEYS_ATTR]: '' }}
      className={`${styles.wheel} ${isActive ? styles.wheelActive : ''}`}
      style={{
        '--wheel-puck-x': puck.x,
        '--wheel-puck-y': puck.y,
        '--wheel-puck-color': `rgb(${r} ${g} ${b})`,
      } as React.CSSProperties}
      onPointerDownCapture={onActivate}
      onFocus={onActivate}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDoubleClick={() => onChange(hue, 0)}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.puck} />
    </div>
  );
}
