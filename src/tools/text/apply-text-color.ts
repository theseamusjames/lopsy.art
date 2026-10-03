import { useUIStore, type TextEditingState } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { toDocumentColor } from '../../app/document-color';
import type { Color, TextLayer } from '../../types';
import {
  applyCommittedTextLayerPatch,
  beginTextLayerHistory,
  endTextLayerHistory,
} from './apply-text-setting';
import { colorOfRange, setColorForRange, unitColors } from './text-color-spans';

/**
 * What the text colour control shows: `color` is null when the target text
 * holds several colours (the mixed "–" state); `pickerColor` is where the
 * picker opens either way.
 */
export interface TextColorDisplay {
  color: Color | null;
  pickerColor: Color;
}

function selectionOf(editing: TextEditingState): [number, number] {
  const anchor = editing.selectionAnchor ?? editing.cursorPos;
  return [Math.min(anchor, editing.cursorPos), Math.max(anchor, editing.cursorPos)];
}

/**
 * The colour the control shows for the current target:
 * - while editing, the selected range (or the whole text with no selection),
 *   over the foreground colour, which is the base colour while editing;
 * - with a committed text layer selected, that whole layer;
 * - otherwise the foreground colour that new text will take.
 */
export function textColorDisplay(
  editing: TextEditingState | null,
  layer: TextLayer | null,
  foreground: Color,
): TextColorDisplay {
  if (editing) {
    const [start, end] = selectionOf(editing);
    const length = editing.text.length;
    const color = colorOfRange(foreground, editing.colorSpans, length, start, end);
    const first = start < end ? start : 0;
    const pickerColor = color ?? unitColors(length, foreground, editing.colorSpans)[first] ?? foreground;
    return { color, pickerColor };
  }
  if (layer) {
    const length = layer.text.length;
    const color = colorOfRange(layer.color, layer.colorSpans, length, 0, length);
    return { color, pickerColor: color ?? layer.color };
  }
  return { color: foreground, pickerColor: foreground };
}

function selectedCommittedTextLayer(): TextLayer | null {
  const doc = useEditorStore.getState().document;
  const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
  return layer?.type === 'text' ? layer : null;
}

/**
 * Apply a colour from the text colour control (#1154):
 * - editing with a range selected: recolour just that range;
 * - editing without a selection: recolour the whole text (the foreground
 *   colour is its base while editing, so it becomes the pick);
 * - a committed text layer selected: recolour the whole layer;
 * - otherwise: set the foreground colour, which new text takes.
 *
 * Committed-layer picks don't push history themselves — bracket a picking
 * session with {@link beginTextColorPick} / {@link endTextColorPick}.
 */
export function applyTextColor(color: Color): void {
  const ui = useUIStore.getState();
  const toolSettings = useToolSettingsStore.getState();
  const editing = ui.textEditing;

  if (editing) {
    const [start, end] = selectionOf(editing);
    if (start < end) {
      const base = toDocumentColor(toolSettings.foregroundColor);
      const spans = setColorForRange(editing.colorSpans, editing.text.length, base, start, end, toDocumentColor(color));
      ui.setTextEditingColorSpans(spans);
    } else {
      toolSettings.setForegroundColor(color);
      ui.setTextEditingColorSpans([]);
    }
    useEditorStore.getState().notifyRender();
    return;
  }

  const layer = selectedCommittedTextLayer();
  if (layer && applyCommittedTextLayerPatch({ color: toDocumentColor(color), colorSpans: [] })) {
    useEditorStore.getState().notifyRender();
    return;
  }
  toolSettings.setForegroundColor(color);
}

/** Start a picking session: one undo step covers every pick until {@link endTextColorPick}. */
export function beginTextColorPick(): void {
  beginTextLayerHistory();
}

/** End a picking session, flushing any coalesced re-render. */
export function endTextColorPick(): void {
  endTextLayerHistory();
}
