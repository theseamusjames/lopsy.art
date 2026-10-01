import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../app/interactions/prefloat', () => ({
  schedulePrefloat: vi.fn(),
}));

const { selectLayerAlpha } = await import('./layer-selection');
const { schedulePrefloat } = await import('../../app/interactions/prefloat');
const { useEditorStore } = await import('../../app/editor-store');
const { createRasterLayer } = await import('../../layers/layer-model');

/** A 4×3 layer at (10, 20) whose middle two pixels of row 1 are opaque. */
function seedLayer(): string {
  const layer = { ...createRasterLayer({ name: 'Pasted Layer', width: 4, height: 3 }), x: 10, y: 20 };
  const pixels = new ImageData(4, 3);
  pixels.data[(1 * 4 + 1) * 4 + 3] = 255;
  pixels.data[(1 * 4 + 2) * 4 + 3] = 255;
  const state = useEditorStore.getState();
  useEditorStore.setState({
    document: {
      ...state.document,
      width: 64,
      height: 64,
      layers: [...state.document.layers, layer],
      layerOrder: [...state.document.layerOrder, layer.id],
      activeLayerId: layer.id,
    },
    resolvePixelData: (id: string) => (id === layer.id ? pixels : undefined),
  });
  return layer.id;
}

describe('selectLayerAlpha', () => {
  beforeEach(() => {
    vi.mocked(schedulePrefloat).mockClear();
  });

  it('selects the layer alpha in document space and prefloats by default', () => {
    const id = seedLayer();

    selectLayerAlpha(id);

    const sel = useEditorStore.getState().selection;
    expect(sel.active).toBe(true);
    expect(sel.bounds).toEqual({ x: 11, y: 21, width: 2, height: 1 });
    expect(schedulePrefloat).toHaveBeenCalledTimes(1);
  });

  it('skips the prefloat when asked, keeping the same selection', () => {
    const id = seedLayer();

    selectLayerAlpha(id, { prefloat: false });

    const sel = useEditorStore.getState().selection;
    expect(sel.bounds).toEqual({ x: 11, y: 21, width: 2, height: 1 });
    expect(schedulePrefloat).not.toHaveBeenCalled();
  });
});
