import { useUIStore } from '../ui-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { toolRegistry } from '../../tools/tool-registry';
import { useShortcutStore, buildKeyToActionMap, NON_TOOL_ACTION_IDS } from '../store/shortcut-store';
import { toggleQuickMaskMode } from '../interactions/quick-mask-ops';
import type { ToolId } from '../../types';

/** Actions that aren't tool selections but live in the single-key namespace. */
const NON_TOOL_ACTIONS: Record<string, () => void> = {
  'swap-colors': () => useToolSettingsStore.getState().swapColors(),
  'reset-colors': () => useToolSettingsStore.getState().resetColors(),
  'toggle-quick-mask': () => toggleQuickMaskMode(),
};

const NON_TOOL_ACTION_SET = new Set<string>(NON_TOOL_ACTION_IDS);
const TOOL_ID_SET = new Set<string>(Object.keys(toolRegistry));

export function handleToolShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  const { customShortcuts } = useShortcutStore.getState();
  const keyToAction = buildKeyToActionMap(customShortcuts);

  const actionId = keyToAction.get(key);
  if (!actionId) return false;

  if (TOOL_ID_SET.has(actionId)) {
    useUIStore.getState().setActiveTool(actionId as ToolId);
    return true;
  }

  if (NON_TOOL_ACTION_SET.has(actionId)) {
    const action = NON_TOOL_ACTIONS[actionId];
    if (action) {
      action();
      return true;
    }
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
    ts.setSmudgeSetting('size', ts.settings.smudge.size + delta);
  } else if (tool === 'pencil') {
    ts.setPencilSetting('size', ts.settings.pencil.size + delta);
  } else if (tool === 'eraser') {
    ts.setEraserSize(ts.eraserSize + delta);
  } else if (tool === 'stamp') {
    ts.setStampSize(ts.stampSize + delta);
  } else if (tool === 'healing') {
    ts.setHealingSize(ts.healingSize + delta);
  } else if (tool === 'path') {
    ts.setPathStrokeWidth(ts.pathStrokeWidth + delta);
  } else if (tool === 'shape') {
    ts.setShapeStrokeWidth(ts.shapeStrokeWidth + delta);
  }
  return true;
}

const SELECTION_TOOLS = new Set([
  'marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic', 'wand',
]);

export function handleNudgeShortcut(
  e: KeyboardEvent,
  nudgeMove: (dx: number, dy: number) => void,
  nudgeSelection: (dx: number, dy: number) => void,
): boolean {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
    return false;
  }

  const tool = useUIStore.getState().activeTool;
  const isSelection = SELECTION_TOOLS.has(tool);
  if (tool !== 'move' && !isSelection) return false;

  e.preventDefault();
  const ui = useUIStore.getState();
  const amount = ui.showGrid && ui.snapToGrid ? ui.gridSize : 1;
  let dx = 0;
  let dy = 0;
  if (e.key === 'ArrowUp') dy = -amount;
  else if (e.key === 'ArrowDown') dy = amount;
  else if (e.key === 'ArrowLeft') dx = -amount;
  else if (e.key === 'ArrowRight') dx = amount;

  if (isSelection) {
    nudgeSelection(dx, dy);
  } else {
    nudgeMove(dx, dy);
  }
  return true;
}
