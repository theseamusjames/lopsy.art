import { useUIStore } from '../ui-store';
import { useToolSettingsStore } from '../tool-settings-store';

export function handleToolShortcut(e: KeyboardEvent): boolean {
  const setActiveTool = useUIStore.getState().setActiveTool;
  const swapColors = useUIStore.getState().swapColors;
  const resetColors = useUIStore.getState().resetColors;

  const toolMap: Record<string, () => void> = {
    v: () => setActiveTool('move'),
    b: () => setActiveTool('brush'),
    n: () => setActiveTool('pencil'),
    e: () => setActiveTool('eraser'),
    g: () => setActiveTool('fill'),
    i: () => setActiveTool('eyedropper'),
    t: () => setActiveTool('text'),
    u: () => setActiveTool('shape'),
    m: () => setActiveTool('marquee-rect'),
    l: () => setActiveTool('lasso'),
    w: () => setActiveTool('wand'),
    c: () => setActiveTool('crop'),
    p: () => setActiveTool('path'),
    s: () => setActiveTool('stamp'),
    o: () => setActiveTool('dodge'),
    x: () => swapColors(),
    d: () => resetColors(),
  };

  const handler = toolMap[e.key.toLowerCase()];
  if (handler) {
    handler();
    return true;
  }
  return false;
}

export function handleSizeShortcut(e: KeyboardEvent): boolean {
  if (e.key !== '[' && e.key !== ']') return false;

  const delta = e.key === ']' ? 1 : -1;
  const tool = useUIStore.getState().activeTool;
  const ts = useToolSettingsStore.getState();

  if (tool === 'brush' || tool === 'dodge') {
    ts.setBrushSize(ts.brushSize + delta);
  } else if (tool === 'pencil') {
    ts.setPencilSize(ts.pencilSize + delta);
  } else if (tool === 'eraser') {
    ts.setEraserSize(ts.eraserSize + delta);
  } else if (tool === 'stamp') {
    ts.setStampSize(ts.stampSize + delta);
  } else if (tool === 'path') {
    ts.setPathStrokeWidth(ts.pathStrokeWidth + delta);
  } else if (tool === 'shape') {
    ts.setShapeStrokeWidth(ts.shapeStrokeWidth + delta);
  }
  return true;
}

export function handleNudgeShortcut(
  e: KeyboardEvent,
  nudgeMove: (dx: number, dy: number) => void,
): boolean {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
    return false;
  }

  const tool = useUIStore.getState().activeTool;
  if (tool !== 'move') return false;

  e.preventDefault();
  const ui = useUIStore.getState();
  const amount = ui.showGrid && ui.snapToGrid ? ui.gridSize : 1;
  let dx = 0;
  let dy = 0;
  if (e.key === 'ArrowUp') dy = -amount;
  else if (e.key === 'ArrowDown') dy = amount;
  else if (e.key === 'ArrowLeft') dx = -amount;
  else if (e.key === 'ArrowRight') dx = amount;
  nudgeMove(dx, dy);
  return true;
}
