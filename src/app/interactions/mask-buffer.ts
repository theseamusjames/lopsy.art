import type { PixelBuffer } from '../../engine/pixel-data';

export interface ActiveMaskEditBuffer {
  layerId: string;
  buf: PixelBuffer;
  maskWidth: number;
  maskHeight: number;
}

// Shared buffer for the in-progress mask drawing. The renderer reads from
// this during mask edit mode so we don't need to sync mask data every frame.
let activeMaskEditBuffer: ActiveMaskEditBuffer | null = null;

export function getActiveMaskEditBuffer(): ActiveMaskEditBuffer | null {
  return activeMaskEditBuffer;
}

export function setActiveMaskEditBuffer(value: ActiveMaskEditBuffer): void {
  activeMaskEditBuffer = value;
}

export function clearActiveMaskEditBuffer(): void {
  activeMaskEditBuffer = null;
}
