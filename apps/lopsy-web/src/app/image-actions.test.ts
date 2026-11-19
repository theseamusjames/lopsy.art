// @vitest-environment jsdom
import '../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

vi.mock('../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('./editor-store');
const { flipRefusal, GROUP_TEXT_FLIP_REFUSAL, TEXT_FLIP_REFUSAL } = await import('./image-actions');

type Layer = ReturnType<typeof useEditorStore.getState>['document']['layers'][number];

function layers(): readonly Layer[] {
  return useEditorStore.getState().document.layers;
}

function layerNamed(name: string): Layer {
  const layer = layers().find((l) => l.name === name);
  if (!layer) throw new Error(`no layer ${name}`);
  return layer;
}

function patch(id: string, change: Record<string, unknown>): void {
  const doc = useEditorStore.getState().document;
  useEditorStore.setState({ document: { ...doc, layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...change } as Layer) : l)) } });
}

function rootGroup(): Layer {
  const doc = useEditorStore.getState().document;
  const root = doc.layers.find((l) => l.id === doc.rootGroupId);
  if (!root) throw new Error('no root group');
  return root;
}

beforeEach(() => {
  useEditorStore.getState().createDocument(20, 10, false);
});

describe('flipRefusal', () => {
  it('lets raster layers and text-free groups flip', () => {
    expect(flipRefusal(layerNamed('Layer 1'), layers())).toBeNull();
    expect(flipRefusal(rootGroup(), layers())).toBeNull();
  });

  it('lets upright text flip, and refuses text on a path', () => {
    const id = layerNamed('Layer 1').id;
    patch(id, { type: 'text' });
    expect(flipRefusal(layerNamed('Layer 1'), layers())).toBeNull();
    patch(id, { pathId: 'p1' });
    expect(flipRefusal(layerNamed('Layer 1'), layers())).toBe(TEXT_FLIP_REFUSAL);
  });

  it('refuses a group holding text, which the menu toasts', () => {
    patch(layerNamed('Layer 1').id, { type: 'text' });
    expect(flipRefusal(rootGroup(), layers())).toBe(GROUP_TEXT_FLIP_REFUSAL);
    expect(GROUP_TEXT_FLIP_REFUSAL).toEqual({ reason: 'Rasterize the text layers in this group before flipping it.', notice: 'info' });
    expect(TEXT_FLIP_REFUSAL).toEqual({ reason: 'Rasterize this text layer to flip it.', notice: 'info' });
  });
});
