import { clamp } from '../../utils/math';

export interface WheelValue {
  readonly hue: number;
  readonly saturation: number;
}

/** Below this the wheel reads as neutral, so the centre is easy to land on. */
const CENTER_SNAP_SATURATION = 3;

/**
 * A pointer offset from the wheel's centre, y down as in screen space. Hue 0
 * sits at 3 o'clock and increases counter-clockwise, the usual HSV wheel, and
 * anything past the rim reads as full saturation so a drag can overshoot.
 */
export function pointerToWheel(dx: number, dy: number, radius: number): WheelValue {
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const saturation = Math.min(100, Math.round((Math.hypot(dx, dy) / radius) * 100));
  return {
    hue: Math.round((angle + 360) % 360) % 360,
    saturation: saturation < CENTER_SNAP_SATURATION ? 0 : saturation,
  };
}

/** The puck's offset from the wheel's centre as a fraction of the radius, y down. */
export function wheelToPuck(hue: number, saturation: number): { x: number; y: number } {
  const angle = (hue * Math.PI) / 180;
  const distance = saturation / 100;
  return { x: Math.cos(angle) * distance, y: -Math.sin(angle) * distance };
}

/** Left/Right walk the hue around the rim, Up/Down move toward and away from it. */
export function stepWheel(value: WheelValue, key: string, step: number): WheelValue | null {
  switch (key) {
    case 'ArrowLeft':
      return { ...value, hue: (value.hue - step + 360) % 360 };
    case 'ArrowRight':
      return { ...value, hue: (value.hue + step) % 360 };
    case 'ArrowUp':
      return { ...value, saturation: clamp(value.saturation + step, 0, 100) };
    case 'ArrowDown':
      return { ...value, saturation: clamp(value.saturation - step, 0, 100) };
    default:
      return null;
  }
}
