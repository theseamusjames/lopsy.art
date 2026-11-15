import { describe, it, expect } from 'vitest';
import {
  POINTER_IDLE,
  POINTER_SPACE_HELD,
  isPanning,
  showsGrabCursor,
  type PointerMode,
} from './pointer-mode';

const PANNING: PointerMode = {
  kind: 'panning',
  startScreenX: 0,
  startScreenY: 0,
  startPanX: 0,
  startPanY: 0,
};

describe('pointer-mode', () => {
  it('is panning only when mode.kind is "panning"', () => {
    expect(isPanning(POINTER_IDLE)).toBe(false);
    expect(isPanning(POINTER_SPACE_HELD)).toBe(false);
    expect(isPanning(PANNING)).toBe(true);
  });

  it('shows the grab cursor for both spaceHeld and panning, but not idle', () => {
    expect(showsGrabCursor(POINTER_IDLE)).toBe(false);
    expect(showsGrabCursor(POINTER_SPACE_HELD)).toBe(true);
    expect(showsGrabCursor(PANNING)).toBe(true);
  });
});
