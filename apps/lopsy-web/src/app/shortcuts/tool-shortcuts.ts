import { useUIStore } from '../ui-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { toolRegistry } from '../../tools/tool-registry';
import { useShortcutStore, buildKeyToActionMap, NON_TOOL_ACTION_IDS } from '../store/shortcut-store';
import { runKeyCommand } from './key-bindings';
import { scheduleNudge } from './nudge-coalesce';
import { isPartialTextMove, PARTIAL_TEXT_MOVE_HINT } from '../interactions/text-transform-handlers';
import { isMaskEditSelectionMove, MASK_EDIT_MOVE_HINT } from '../interactions/mask-edit-move-guard';
import { announceRefusal, type Refusal } from '../../commands/refusal';
import type { ToolId } from '../../types';

/** Actions that aren't tool selections but live in the single-key namespace. */
const NON_TOOL_ACTIONS: Record<string, () => void> = {
  'swap-colors': () => runKeyCommand('swapColors'),
  'reset-colors': () => runKeyCommand('resetColors'),
  'toggle-quick-mask': () => runKeyCommand('toggleQuickMask'),
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
    runKeyCommand('toolLetter', { tool: actionId as ToolId });
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
    ts.setBrushSetting('size', ts.settings.brush.size + delta);
  } else if (tool === 'smudge') {
    ts.setSmudgeSetting('size', ts.settings.smudge.size + delta);
  } else if (tool === 'pencil') {
    ts.setPencilSetting('size', ts.settings.pencil.size + delta);
  } else if (tool === 'eraser') {
    ts.setEraserSetting('size', ts.settings.eraser.size + delta);
  } else if (tool === 'stamp') {
    ts.setStampSetting('size', ts.settings.stamp.size + delta);
  } else if (tool === 'healing') {
    ts.setHealingSetting('size', ts.settings.healing.size + delta);
  } else if (tool === 'path') {
    ts.setPathSetting('strokeWidth', ts.settings.path.strokeWidth + delta);
  } else if (tool === 'shape') {
    ts.setShapeSetting('strokeWidth', ts.settings.shape.strokeWidth + delta);
  }
  return true;
}

const SELECTION_TOOLS = new Set([
  'marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic', 'wand',
]);

/** Shift+arrow nudge distance, matching Photoshop. */
const SHIFT_NUDGE_PX = 10;

/** What an arrow key moves with this tool: the layer or float (Move), the marquee (a selection tool), or nothing. */
export type NudgeTarget = 'move' | 'selection';

export function nudgeTargetOf(tool: ToolId): NudgeTarget | null {
  if (tool === 'move') return 'move';
  return SELECTION_TOOLS.has(tool) ? 'selection' : null;
}

export const MESH_WARP_NUDGE_REFUSAL = 'Mesh Warp is open: it owns the layer, so an arrow-key nudge does nothing until it is applied or cancelled.';

/**
 * Why an arrow key with this target moves nothing, and whether the UI says
 * so: an open Mesh Warp session owns the layer (silent); with the Move tool,
 * a selection over part of a live text layer or a mask-edit selection move
 * (hinted).
 */
export function nudgeRefusal(target: NudgeTarget): Refusal | null {
  // A nudge would move the pixels out from under the Mesh Warp grid, the
  // same way an off-handle drag did (#1508).
  if (useUIStore.getState().meshWarp) return { reason: MESH_WARP_NUDGE_REFUSAL, notice: null };
  if (target !== 'move') return null;
  // A nudge would float part of a live text layer — the same move a drag
  // refuses. Refuse it before scheduleNudge pushes an empty history entry (#1085).
  if (isPartialTextMove()) return { reason: PARTIAL_TEXT_MOVE_HINT, notice: 'info' };
  if (isMaskEditSelectionMove()) return { reason: MASK_EDIT_MOVE_HINT, notice: 'info' };
  return null;
}

export function handleNudgeShortcut(
  e: KeyboardEvent,
  nudgeMove: (dx: number, dy: number) => void,
  nudgeSelection: (dx: number, dy: number) => void,
): boolean {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
    return false;
  }

  const target = nudgeTargetOf(useUIStore.getState().activeTool);
  if (!target) return false;

  e.preventDefault();
  const refusal = nudgeRefusal(target);
  if (refusal) {
    // Hint once per key-hold, not on every auto-repeat.
    if (!e.repeat) announceRefusal(refusal);
    return true;
  }
  const ui = useUIStore.getState();
  const step = e.shiftKey ? SHIFT_NUDGE_PX : 1;
  const amount = ui.showGrid && ui.snapToGrid ? ui.gridSize : step;
  let dx = 0;
  let dy = 0;
  if (e.key === 'ArrowUp') dy = -amount;
  else if (e.key === 'ArrowDown') dy = amount;
  else if (e.key === 'ArrowLeft') dx = -amount;
  else if (e.key === 'ArrowRight') dx = amount;

  // Coalesce to rAF: a held arrow key auto-repeats faster than the browser
  // can render, and each event previously did a full-document mask rebuild
  // + GPU upload (issue #684). scheduleNudge accumulates dx/dy and applies
  // once per frame, and pushes one history entry per key-hold.
  const apply = target === 'selection' ? nudgeSelection : nudgeMove;
  scheduleNudge(e.key, e.repeat, dx, dy, apply);
  return true;
}
