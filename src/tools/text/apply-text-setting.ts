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
import { coalesceToAnimationFrame } from '../../utils/raf-coalesce';
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
  vertical: 'vertical',
} as const satisfies Partial<Record<keyof TextSettings, keyof TextLayer>>;

interface Anchored {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
}

/**
 * Anchor cached at the start of a slider drag (#758). While set, subsequent
 * `applyTextSetting` calls place the new texture at this anchor directly
 * instead of paying to re-rasterize the *old* layer just to recover its
 * offset. The anchor is a property of the layout origin and cannot change
 * mid-drag, so caching it is safe.
 */
let dragAnchor: { layerId: string; anchorX: number; anchorY: number } | null = null;

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
 *
 * When a drag begins, cache the layer's current anchor so the drag's
 * `applyTextSetting` stream can skip the "measure the old layer to find its
 * offset" rasterization on every pointer-move (#758).
 */
export function beginTextLayerHistory(): void {
  dragAnchor = null;
  const layer = selectedCommittedTextLayer();
  if (!layer) return;
  useEditorStore.getState().pushHistory('Text');

  const engine = getEngine();
  if (!engine || layer.pathId) return;

  // The current layer's texture is placed at `anchor + oldRenderOffset`, so
  // recovering the anchor requires knowing `oldRenderOffset`. This one
  // rasterization is the price we pay once at drag start; subsequent
  // `applyTextSetting` calls during the drag reuse the cached anchor.
  const result = rerenderCommittedTextLayerAnchored(engine, layer, layer);
  if (result) {
    dragAnchor = { layerId: layer.id, anchorX: result.anchorX, anchorY: result.anchorY };
  }
}

/**
 * End a slider drag (or any grouped edit sequence): flush the coalesced
 * re-render so the final value is applied even if rAF hasn't fired since
 * the last event, then drop the cached anchor.
 */
export function endTextLayerHistory(): void {
  rerenderCoalesced.flush();
  dragAnchor = null;
}

/**
 * Re-render a committed text layer's GPU texture after a property change,
 * keeping the text anchored (the new texture is placed so the type origin
 * stays put). Returns the anchor so callers can re-place the layer later
 * (e.g. once an async web-font download completes).
 */
function rerenderLayer(oldLayer: TextLayer, newLayer: TextLayer): Anchored | null {
  const editor = useEditorStore.getState();
  if (newLayer.pathId) {
    invalidatePathTextCache(newLayer.id);
    return null;
  }
  const engine = getEngine();
  if (!engine) return null;

  // Fast path during a drag: the anchor was recovered once at drag start,
  // so we can place the new texture without another old-layer rasterization.
  if (dragAnchor && dragAnchor.layerId === newLayer.id) {
    const pos = placeTextLayerAtAnchor(engine, newLayer, dragAnchor.anchorX, dragAnchor.anchorY);
    if (pos) {
      editor.updateTextLayerProperties(newLayer.id, { x: pos.x, y: pos.y });
      return { x: pos.x, y: pos.y, anchorX: dragAnchor.anchorX, anchorY: dragAnchor.anchorY };
    }
    return null;
  }

  const result = rerenderCommittedTextLayerAnchored(engine, oldLayer, newLayer);
  if (result) editor.updateTextLayerProperties(newLayer.id, { x: result.x, y: result.y });
  return result;
}

/**
 * Coalesce re-renders during high-frequency slider drags. Every
 * `applyTextSetting` call updates the store synchronously (so downstream
 * subscribers see the latest value immediately) but the GPU-side re-render
 * happens at most once per animation frame with the latest layer state.
 */
const rerenderCoalesced = coalesceToAnimationFrame((layerId: string) => {
  const editor = useEditorStore.getState();
  const layer = editor.document.layers.find((l): l is TextLayer => l.id === layerId && l.type === 'text');
  if (!layer) return;
  // We no longer have the true "old" layer here — during a coalesced drag
  // the cached anchor is what makes this work; the anchor-cache branch of
  // rerenderLayer doesn't consult `oldLayer`, so passing the current layer
  // twice is correct. Outside a drag, `rerenderCoalesced.flush()` is not
  // called, and callers that need synchronous, anchored re-render (like
  // font family/weight changes) still take the direct path.
  rerenderLayer(layer, layer);
});

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
 *
 * During a slider drag (between `beginTextLayerHistory` and
 * `endTextLayerHistory`) the GPU re-render is coalesced to one per animation
 * frame; the store still updates synchronously so React reflects the value
 * without lag.
 */
export function applyTextSetting<K extends keyof TextSettings>(key: K, value: TextSettings[K]): void {
  useToolSettingsStore.getState().setTextSetting(key, value);

  const layerKey = (SETTING_TO_LAYER as Record<string, keyof TextLayer | undefined>)[key];
  if (!layerKey) return;
  const layer = selectedCommittedTextLayer();
  if (!layer) return;

  const clamped = useToolSettingsStore.getState().settings.text[key];
  useEditorStore.getState().updateTextLayerProperties(layer.id, { [layerKey]: clamped });

  if (dragAnchor && dragAnchor.layerId === layer.id) {
    // In-drag path: coalesce the GPU render to the next animation frame so a
    // 250 Hz pen tablet stops rasterizing multiple times per displayed frame.
    rerenderCoalesced(layer.id);
    return;
  }

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
