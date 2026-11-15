import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { createTransformState } from '../../tools/transform/transform';
import { deferNudgeMask, flushNudgeMask, heldNudgeMask } from './live-float';
import type { PendingNudgeMask } from './live-float';
import {
  beginQuickMaskContentMove,
  endQuickMaskContentMove,
  moveQuickMaskContent,
} from './quick-mask-content-move';

/**
 * Nudge the marquee alone (`selection`, a selection tool is active) or the
 * marquee and the quick-mask content under it (`quickMask`, the Move tool
 * in Quick Mask mode). While the arrow key is held only the selection
 * bounds move — the ants follow the bounds — and the translated mask is
 * written once when the hold ends (flushNudgeMask). Rebuilding and
 * re-uploading the document-sized mask every frame made a held key crawl
 * on large canvases (#1480, #1482).
 */
export function nudgeHeldSelection(kind: 'selection' | 'quickMask', dx: number, dy: number): void {
  const sel = useEditorStore.getState().selection;
  if (!sel.active || !sel.mask || !sel.bounds) return;
  const held = heldNudgeMask(kind, sel.mask) ?? startHeldNudge(kind);
  if (!held) return;

  const offsetX = held.offsetX + dx;
  const offsetY = held.offsetY + dy;
  if (kind === 'quickMask') moveQuickMaskContent(offsetX, offsetY);
  deferNudgeMask({ ...held, offsetX, offsetY });

  const bounds = {
    x: held.originalBounds.x + offsetX,
    y: held.originalBounds.y + offsetY,
    width: held.originalBounds.width,
    height: held.originalBounds.height,
  };
  const editor = useEditorStore.getState();
  editor.setSelectionBounds(bounds);
  useUIStore.getState().setTransform(createTransformState(bounds));
  editor.notifyRender();
}

function startHeldNudge(kind: 'selection' | 'quickMask'): PendingNudgeMask | null {
  // Another hold's mask lands first, so this one starts from the marquee on screen.
  flushNudgeMask();
  const sel = useEditorStore.getState().selection;
  if (!sel.active || !sel.mask || !sel.bounds) return null;
  const isMovingContent = kind === 'quickMask' && beginQuickMaskContentMove(sel);
  return {
    kind,
    layerId: null,
    staleMask: sel.mask,
    originalMask: sel.mask,
    originalBounds: { ...sel.bounds },
    offsetX: 0,
    offsetY: 0,
    ...(isMovingContent ? { onEnd: endQuickMaskContentMove } : {}),
  };
}
