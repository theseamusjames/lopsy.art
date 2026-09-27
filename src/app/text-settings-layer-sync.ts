import { useEditorStore } from './editor-store';
import { useUIStore } from './ui-store';
import { useToolSettingsStore } from './tool-settings-store';
import { textSettingsPatchFromLayer } from '../tools/text/text-settings-from-layer';
import type { TextSettings } from '../tools/text/text-settings';
import type { Layer, TextLayer } from '../types';

/** Copy a text layer's properties into the Text tool settings, if they differ. */
export function loadTextSettingsFromLayer(layer: TextLayer): void {
  const ts = useToolSettingsStore.getState();
  const patch = textSettingsPatchFromLayer(layer, ts.settings.text);
  for (const [key, value] of Object.entries(patch) as [keyof TextSettings, TextSettings[keyof TextSettings]][]) {
    ts.setTextSetting(key, value);
  }
}

function activeCommittedTextLayer(
  layers: readonly Layer[],
  activeLayerId: string | null,
): TextLayer | null {
  if (!activeLayerId) return null;
  const layer = layers.find((l) => l.id === activeLayerId);
  if (!layer || layer.type !== 'text') return null;
  const textLayer = layer as TextLayer;
  // A freshly-created text layer becomes the active layer a tick before
  // `startTextEditing` flips `textEditing` on (see handleTextUp: addTextLayer
  // then beginEditSession). Syncing the tool settings from that transient,
  // not-yet-typed layer would overwrite decorations the user just toggled
  // (underline/strikethrough) with the blank layer's defaults. An empty text
  // layer carries nothing worth reflecting in the panel, so skip it.
  if (textLayer.text.length === 0) return null;
  return textLayer;
}

/**
 * Keep the Text tool settings (which the Text panel and options bar display
 * and edit) describing the selected committed text layer. Selecting a text
 * layer from the Layers panel, or an undo that changes it, otherwise leaves
 * stale tool values on screen — and typing the stale value is a no-op
 * because the control never fires a change (#943). Returns an unsubscribe.
 */
export function installTextSettingsLayerSync(): () => void {
  let prevLayers: readonly Layer[] | null = null;
  let prevActiveId: string | null = null;
  return useEditorStore.subscribe((state) => {
    const { layers, activeLayerId } = state.document;
    if (layers === prevLayers && activeLayerId === prevActiveId) return;
    prevLayers = layers;
    prevActiveId = activeLayerId;
    if (useUIStore.getState().textEditing) return;
    const layer = activeCommittedTextLayer(layers, activeLayerId);
    if (layer) loadTextSettingsFromLayer(layer);
  });
}
