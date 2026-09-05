import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import {
  rerenderCommittedTextLayerAnchored,
  placeTextLayerAtAnchor,
  invalidateEditingTextCache,
  invalidatePathTextCache,
  resetTextLayerLayout,
} from '../../engine-wasm/engine-sync';
import { findFontEntry, loadLocalFontToEngine } from '../../app/local-fonts-store';
import { extractFamilyName, loadGoogleFont, loadFontBinaryToEngine } from '../../utils/font-loader';
import type { TextSettings } from './text-settings';
import type { TextLayer } from '../../types';

/** TextSettings keys that map onto a TextLayer property, and how. */
const SETTING_TO_LAYER = {
  fontSize: 'fontSize',
  fontFamily: 'fontFamily',
  fontWeight: 'fontWeight',
  fontStyle: 'fontStyle',
  align: 'textAlign',
  underline: 'underline',
  strikethrough: 'strikethrough',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  paragraphSpacing: 'paragraphSpacing',
} as const satisfies Partial<Record<keyof TextSettings, keyof TextLayer>>;

interface Anchored {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
}

/** The committed text layer that panel/options edits should target, or null. */
function selectedCommittedTextLayer(): TextLayer | null {
  // While editing, the live sync owns the preview — don't touch a committed layer.
  if (useUIStore.getState().textEditing) return null;
  const editor = useEditorStore.getState();
  const id = editor.document.activeLayerId;
  const layer = editor.document.layers.find((l): l is TextLayer => l.id === id && l.type === 'text');
  return layer ?? null;
}

/**
 * Push one history entry before mutating the selected committed text layer.
 * Call from a control's drag-start / before a discrete change so the pre-change
 * texture is snapshotted (a no-op while editing — commit handles history there).
 */
export function beginTextLayerHistory(): void {
  if (selectedCommittedTextLayer()) {
    useEditorStore.getState().pushHistory('Text');
  }
}

/**
 * Re-render a committed text layer's GPU texture after a property change, keeping
 * the text anchored (the new texture is placed so the type origin stays put).
 * Returns the anchor so callers can re-place the layer later (e.g. once an
 * async web-font download completes).
 */
function rerenderLayer(oldLayer: TextLayer, newLayer: TextLayer): Anchored | null {
  const editor = useEditorStore.getState();
  if (newLayer.pathId) {
    invalidatePathTextCache(newLayer.id);
    return null;
  }
  const engine = getEngine();
  if (!engine) return null;
  const result = rerenderCommittedTextLayerAnchored(engine, oldLayer, newLayer);
  if (result) editor.updateTextLayerProperties(newLayer.id, { x: result.x, y: result.y });
  return result;
}

/**
 * Refresh text after a web-font binary finishes downloading: re-render the
 * live-editing preview and/or the committed target layer that was changed, so
 * the glyphs switch from the Inter fallback to the real font (staying anchored).
 */
function refreshTextAfterFontLoad(target: { id: string; anchorX: number; anchorY: number } | null): void {
  const engine = getEngine();
  if (!engine) return;
  const editor = useEditorStore.getState();
  const editing = useUIStore.getState().textEditing;

  if (editing) {
    // The engine dedups layout by props hash; the props are unchanged (only the
    // font's availability changed), so drop the cached layout to force a re-shape
    // with the now-loaded font on the next syncTextLayers.
    resetTextLayerLayout(engine, editing.layerId);
    invalidateEditingTextCache(engine);
    editor.notifyRender();
    return;
  }

  if (target) {
    const layer = editor.document.layers.find(
      (l): l is TextLayer => l.id === target.id && l.type === 'text',
    );
    if (layer && !layer.pathId) {
      // Force a re-shape (see above), then re-render anchored with the real font.
      resetTextLayerLayout(engine, layer.id);
      const pos = placeTextLayerAtAnchor(engine, layer, target.anchorX, target.anchorY);
      if (pos) editor.updateTextLayerProperties(layer.id, { x: pos.x, y: pos.y });
      editor.notifyRender();
    }
  }
}

/**
 * Set a text tool setting and, when a committed text layer is selected (and not
 * editing), apply the change to that layer immediately (Character-panel style).
 * Does NOT push history — call {@link beginTextLayerHistory} first.
 */
export function applyTextSetting<K extends keyof TextSettings>(key: K, value: TextSettings[K]): void {
  useToolSettingsStore.getState().setTextSetting(key, value);

  const layerKey = (SETTING_TO_LAYER as Record<string, keyof TextLayer | undefined>)[key];
  if (!layerKey) return;
  const layer = selectedCommittedTextLayer();
  if (!layer) return;

  const clamped = useToolSettingsStore.getState().settings.text[key];
  useEditorStore.getState().updateTextLayerProperties(layer.id, { [layerKey]: clamped });
  rerenderLayer(layer, { ...layer, [layerKey]: clamped } as TextLayer);
}

/** Snap `weight` to the nearest weight the font offers, and load its binary. */
function ensureWeightLoaded(family: string, weight: number): { weight: number; loading: Promise<boolean> } {
  const name = extractFamilyName(family);
  const entry = findFontEntry(name);
  if (!entry) return { weight, loading: Promise.resolve(false) };

  const resolved = entry.weights.includes(weight)
    ? weight
    : entry.weights.reduce((prev, curr) => (Math.abs(curr - weight) < Math.abs(prev - weight) ? curr : prev));

  if (entry.source === 'google') {
    loadGoogleFont(name, entry.weights);
    return { weight: resolved, loading: loadFontBinaryToEngine(name, resolved) };
  }
  if (entry.source === 'local') return { weight: resolved, loading: loadLocalFontToEngine(name) };
  return { weight: resolved, loading: Promise.resolve(false) };
}

/**
 * Apply a font family: record it as recent, load the CSS/engine font, snap the
 * weight to an available one, apply to a selected committed layer, and re-render
 * once the (possibly freshly downloaded) binary is available so the text doesn't
 * linger on the Inter fallback.
 */
export function applyTextFontFamily(family: string): void {
  const ts = useToolSettingsStore.getState();
  ts.setTextSetting('fontFamily', family);
  const name = extractFamilyName(family);
  ts.addRecentFont(name);

  const { weight, loading } = ensureWeightLoaded(family, ts.settings.text.fontWeight);
  ts.setTextSetting('fontWeight', weight);

  const layer = selectedCommittedTextLayer();
  let anchor: Anchored | null = null;
  if (layer) {
    useEditorStore.getState().pushHistory('Text');
    useEditorStore.getState().updateTextLayerProperties(layer.id, { fontFamily: family, fontWeight: weight });
    anchor = rerenderLayer(layer, { ...layer, fontFamily: family, fontWeight: weight } as TextLayer);
  }

  const targetId = layer?.id;
  void loading.then((loaded) => {
    if (!loaded) return;
    refreshTextAfterFontLoad(
      targetId && anchor ? { id: targetId, anchorX: anchor.anchorX, anchorY: anchor.anchorY } : null,
    );
  });
}

/**
 * Apply a font weight, loading the weight's binary and re-rendering once it's
 * available (same anchored async-refresh as {@link applyTextFontFamily}).
 * Pushes its own history entry for committed layers.
 */
export function applyTextWeight(weight: number): void {
  const ts = useToolSettingsStore.getState();
  const family = ts.settings.text.fontFamily;
  const { weight: resolved, loading } = ensureWeightLoaded(family, weight);
  ts.setTextSetting('fontWeight', resolved);

  const layer = selectedCommittedTextLayer();
  let anchor: Anchored | null = null;
  if (layer) {
    useEditorStore.getState().pushHistory('Text');
    useEditorStore.getState().updateTextLayerProperties(layer.id, { fontWeight: resolved });
    anchor = rerenderLayer(layer, { ...layer, fontWeight: resolved } as TextLayer);
  }

  const targetId = layer?.id;
  void loading.then((loaded) => {
    if (!loaded) return;
    refreshTextAfterFontLoad(
      targetId && anchor ? { id: targetId, anchorX: anchor.anchorX, anchorY: anchor.anchorY } : null,
    );
  });
}
