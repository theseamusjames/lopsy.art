import type { Point } from '../../types';

export function computeLayerMove(
  startPos: Point,
  currentPos: Point,
  layerX: number,
  layerY: number,
): { x: number; y: number } {
  return {
    x: layerX + (currentPos.x - startPos.x),
    y: layerY + (currentPos.y - startPos.y),
  };
}

export function computeNudge(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
  layerX: number,
  layerY: number,
): { x: number; y: number } {
  switch (direction) {
    case 'up':
      return { x: layerX, y: layerY - amount };
    case 'down':
      return { x: layerX, y: layerY + amount };
    case 'left':
      return { x: layerX - amount, y: layerY };
    case 'right':
      return { x: layerX + amount, y: layerY };
  }
}

export function snapToGuide(
  position: number,
  guides: number[],
  snapThreshold: number,
): { snapped: boolean; value: number } {
  for (const guide of guides) {
    if (Math.abs(position - guide) <= snapThreshold) {
      return { snapped: true, value: guide };
    }
  }
  return { snapped: false, value: position };
}
