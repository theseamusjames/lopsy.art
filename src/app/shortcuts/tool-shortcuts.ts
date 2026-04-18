import { useUIStore } from '../ui-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { SHORTCUT_TO_TOOL } from '../../tools/tool-registry';

/**
 * Color swatches aren't tools but share the single-key shortcut namespace,
 * so they live alongside the tool map.
 */
const COLOR_SHORTCUTS: Record<string, () => void> = {
  x: () => useToolSettingsStore.getState().swapColors(),
  d: () => useToolSettingsStore.getState().resetColors(),
};

export function handleToolShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();

  const toolId = SHORTCUT_TO_TOOL.get(key);
  if (toolId) {
    useUIStore.getState().setActiveTool(toolId);
    return true;
  }

  const colorAction = COLOR_SHORTCUTS[key];
  if (colorAction) {
    colorAction();
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
  } else if (tool === 'smudge') {
    ts.setSmudgeSize(ts.smudgeSize + delta);
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
