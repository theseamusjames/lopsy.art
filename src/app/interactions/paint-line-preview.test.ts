import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { updatePaintLinePreview } from './paint-line-preview';

// #666 — direct tests of the preview compute. Full end-to-end (rendering the
// line on the overlay canvas) is covered by e2e/brush-shift-line-preview.spec.ts.

describe('updatePaintLinePreview', () => {
  beforeEach(() => {
    useUIStore.setState({
      activeTool: 'brush',
      cursorOnCanvas: true,
      cursorPosition: { x: 0, y: 0 },
      lastPaintPoint: null,
      paintLinePreview: null,
    });
    useEditorStore.setState({
      document: {
        ...useEditorStore.getState().document,
        activeLayerId: 'layer-a',
        layers: [{ id: 'layer-a', type: 'raster', name: 'A', visible: true, opacity: 1, x: 0, y: 0, width: 100, height: 100 } as never],
      },
    });
  });

  it('is a no-op when shift is not held', () => {
    useUIStore.getState().setLastPaintPoint({ point: { x: 10, y: 10 }, layerId: 'layer-a' });
    updatePaintLinePreview({ x: 90, y: 10 }, false, false, true);
    expect(useUIStore.getState().paintLinePreview).toBeNull();
  });

  it('is a no-op when the active tool is not a paint tool', () => {
    useUIStore.setState({ activeTool: 'move' });
    useUIStore.getState().setLastPaintPoint({ point: { x: 10, y: 10 }, layerId: 'layer-a' });
    updatePaintLinePreview({ x: 90, y: 10 }, true, false, true);
    expect(useUIStore.getState().paintLinePreview).toBeNull();
  });

  it('is a no-op when lastPaintPoint is on a different layer than the active layer', () => {
    useUIStore.getState().setLastPaintPoint({ point: { x: 10, y: 10 }, layerId: 'layer-b' });
    updatePaintLinePreview({ x: 90, y: 10 }, true, false, true);
    expect(useUIStore.getState().paintLinePreview).toBeNull();
  });

  it('is a no-op when cursor is outside the canvas', () => {
    useUIStore.getState().setLastPaintPoint({ point: { x: 10, y: 10 }, layerId: 'layer-a' });
    updatePaintLinePreview({ x: 90, y: 10 }, true, false, false);
    expect(useUIStore.getState().paintLinePreview).toBeNull();
  });

  it('publishes a doc-space line from last paint point to cursor when shift is held', () => {
    useUIStore.getState().setLastPaintPoint({ point: { x: 10, y: 20 }, layerId: 'layer-a' });
    updatePaintLinePreview({ x: 80, y: 60 }, true, false, true);
    const preview = useUIStore.getState().paintLinePreview;
    expect(preview).not.toBeNull();
    expect(preview!.start).toEqual({ x: 10, y: 20 });
    expect(preview!.end).toEqual({ x: 80, y: 60 });
    expect(preview!.snapped).toBe(false);
  });

  it('shifts start into doc space when the layer has a non-zero offset', () => {
    useEditorStore.setState({
      document: {
        ...useEditorStore.getState().document,
        layers: [{ id: 'layer-a', type: 'raster', name: 'A', visible: true, opacity: 1, x: 100, y: 50, width: 100, height: 100 } as never],
      },
    });
    useUIStore.getState().setLastPaintPoint({ point: { x: 10, y: 10 }, layerId: 'layer-a' });
    updatePaintLinePreview({ x: 200, y: 100 }, true, false, true);
    const preview = useUIStore.getState().paintLinePreview;
    expect(preview!.start).toEqual({ x: 110, y: 60 });
  });

  it('snaps the endpoint to the nearest 15° when meta is held', () => {
    useUIStore.getState().setLastPaintPoint({ point: { x: 0, y: 0 }, layerId: 'layer-a' });
    // 1° below horizontal — should snap to 0° (pure horizontal).
    updatePaintLinePreview({ x: 100, y: 2 }, true, true, true);
    const preview = useUIStore.getState().paintLinePreview;
    expect(preview!.snapped).toBe(true);
    // The end x should be close to sqrt(100² + 2²) ~= 100.02 (dist preserved).
    // Y should collapse to ~0 (horizontal snap).
    expect(preview!.end.y).toBeCloseTo(0, 5);
    expect(preview!.end.x).toBeCloseTo(Math.hypot(100, 2), 5);
  });

  it('clears an existing preview when shift is released', () => {
    useUIStore.getState().setLastPaintPoint({ point: { x: 10, y: 10 }, layerId: 'layer-a' });
    updatePaintLinePreview({ x: 90, y: 10 }, true, false, true);
    expect(useUIStore.getState().paintLinePreview).not.toBeNull();
    updatePaintLinePreview({ x: 90, y: 10 }, false, false, true);
    expect(useUIStore.getState().paintLinePreview).toBeNull();
  });
});
