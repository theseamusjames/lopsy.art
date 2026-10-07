import { findFontEntry, loadLocalFontToEngine } from './local-fonts-store';
import { extractFamilyName, loadFontBinaryToEngine, loadGoogleFont } from '../utils/font-loader';
import type { Layer, TextLayer } from '../types/layers';

export interface DocumentFontFace {
  family: string;
  weight: number;
  isItalic: boolean;
}

/** Distinct family / weight / style faces used by the document's text layers. */
export function collectTextLayerFonts(layers: readonly Layer[]): DocumentFontFace[] {
  const faces = new Map<string, DocumentFontFace>();
  for (const layer of layers) {
    if (layer.type !== 'text') continue;
    const text = layer as TextLayer;
    const family = extractFamilyName(text.fontFamily);
    if (!family) continue;
    const isItalic = text.fontStyle === 'italic';
    const key = `${family}:${text.fontWeight}:${isItalic ? 'i' : 'n'}`;
    if (!faces.has(key)) faces.set(key, { family, weight: text.fontWeight, isItalic });
  }
  return [...faces.values()];
}

function nearestWeight(weights: readonly number[], weight: number): number {
  if (weights.length === 0 || weights.includes(weight)) return weight;
  return weights.reduce((prev, curr) => (Math.abs(curr - weight) < Math.abs(prev - weight) ? curr : prev));
}

/**
 * Load every font a freshly opened document's text layers use into the DOM
 * and the engine. The saved pixels already show the right face, but the next
 * re-render (a size nudge, a re-edit) shapes with whatever the engine has — so
 * without this it falls back to Inter (#962).
 */
export function loadDocumentFonts(
  layers: readonly Layer[],
  onFaceLoaded?: (family: string) => void,
): Promise<void> {
  const loads = collectTextLayerFonts(layers).map((face) =>
    loadFace(face).then((isLoaded) => {
      if (isLoaded) onFaceLoaded?.(face.family);
    }),
  );
  return Promise.all(loads).then(() => undefined);
}

function loadFace(face: DocumentFontFace): Promise<boolean> {
  const entry = findFontEntry(face.family);
  if (!entry) return Promise.resolve(false);
  if (entry.source === 'local') return loadLocalFontToEngine(face.family);
  if (entry.source !== 'google') return Promise.resolve(false);
  loadGoogleFont(face.family, entry.weights, entry.hasItalic).catch(() => {});
  const isItalic = face.isItalic && entry.hasItalic;
  return loadFontBinaryToEngine(face.family, nearestWeight(entry.weights, face.weight), isItalic);
}
