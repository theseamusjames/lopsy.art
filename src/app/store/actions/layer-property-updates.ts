import type { DocumentState, Layer, LayerEffects } from '../../../types';
import type { EditorState } from '../types';

export function computeSetActiveLayer(
  doc: DocumentState,
  id: string,
): Partial<EditorState> {
  return {
    document: { ...doc, activeLayerId: id },
  };
}

export function computeToggleVisibility(
  doc: DocumentState,
  id: string,
): Partial<EditorState> {
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === id ? ({ ...l, visible: !l.visible } as Layer) : l,
      ),
    },
  };
}

export function computeUpdateOpacity(
  doc: DocumentState,
  id: string,
  opacity: number,
): Partial<EditorState> {
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === id ? ({ ...l, opacity } as Layer) : l,
      ),
    },
  };
}

export function computeUpdatePosition(
  doc: DocumentState,
  renderVersion: number,
  id: string,
  x: number,
  y: number,
): Partial<EditorState> {
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === id ? ({ ...l, x, y } as Layer) : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}

export function computeUpdateEffects(
  doc: DocumentState,
  renderVersion: number,
  id: string,
  effects: LayerEffects,
): Partial<EditorState> {
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) =>
        l.id === id ? ({ ...l, effects } as Layer) : l,
      ),
    },
    renderVersion: renderVersion + 1,
  };
}

export function computeToggleMask(
  doc: DocumentState,
  renderVersion: number,
  id: string,
): Partial<EditorState> | undefined {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer?.mask) return undefined;

  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) => {
        if (l.id !== id || !l.mask) return l;
        return { ...l, mask: { ...l.mask, enabled: !l.mask.enabled } } as Layer;
      }),
    },
    renderVersion: renderVersion + 1,
  };
}

export function computeUpdateMaskData(
  doc: DocumentState,
  renderVersion: number,
  layerId: string,
  maskData: Uint8ClampedArray,
): Partial<EditorState> {
  return {
    document: {
      ...doc,
      layers: doc.layers.map((l) => {
        if (l.id !== layerId || !l.mask) return l;
        return { ...l, mask: { ...l.mask, data: maskData } } as Layer;
      }),
    },
    renderVersion: renderVersion + 1,
  };
}
