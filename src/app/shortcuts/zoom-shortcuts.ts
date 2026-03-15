import type { RefObject } from 'react';

export function handleZoomShortcut(
  e: KeyboardEvent,
  zoom: number,
  setZoom: (z: number) => void,
  setPan: (x: number, y: number) => void,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  docWidth: number,
  docHeight: number,
): boolean {
  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    setZoom(Math.min(64, zoom * 1.5));
    return true;
  }
  if (e.key === '-') {
    e.preventDefault();
    setZoom(Math.max(0.01, zoom / 1.5));
    return true;
  }
  if (e.key === '0') {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (canvas) {
      const scaleX = canvas.width / docWidth;
      const scaleY = canvas.height / docHeight;
      setZoom(Math.min(scaleX, scaleY) * 0.9);
      setPan(0, 0);
    }
    return true;
  }
  if (e.key === '1') {
    e.preventDefault();
    setZoom(1);
    setPan(0, 0);
    return true;
  }
  return false;
}
