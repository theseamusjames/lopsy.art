import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../app/interactions/prefloat', () => ({
  schedulePrefloat: vi.fn(),
  cancelPrefloat: vi.fn(),
  commitPrefloatIfSelectionChanged: vi.fn(),
}));

const readLayerAsImageData = vi.fn<(id: string) => Promise<ImageData | null>>();
vi.mock('../../engine-wasm/gpu-pixel-access', () => ({
  readLayerAsImageData: (id: string) => readLayerAsImageData(id),
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
  });
  readLayerAsImageData.mockImplementation((id: string) => Promise.resolve(id === layer.id ? pixels : null));
  return layer.id;
}

describe('selectLayerAlpha', () => {
  beforeEach(() => {
    vi.mocked(schedulePrefloat).mockClear();
    readLayerAsImageData.mockReset();
    useEditorStore.getState().clearSelection();
  });

  it('selects the layer alpha in document space and prefloats by default', async () => {
    const id = seedLayer();

    await selectLayerAlpha(id);

    const sel = useEditorStore.getState().selection;
    expect(sel.active).toBe(true);
    expect(sel.bounds).toEqual({ x: 11, y: 21, width: 2, height: 1 });
    expect(schedulePrefloat).toHaveBeenCalledTimes(1);
  });

  it('skips the prefloat when asked, keeping the same selection', async () => {
    const id = seedLayer();

    await selectLayerAlpha(id, { prefloat: false });

    const sel = useEditorStore.getState().selection;
    expect(sel.bounds).toEqual({ x: 11, y: 21, width: 2, height: 1 });
    expect(schedulePrefloat).not.toHaveBeenCalled();
  });

  it('has no selection until the layer has been read', async () => {
    const id = seedLayer();

    const pending = selectLayerAlpha(id);
    expect(useEditorStore.getState().selection.active).toBe(false);
    await pending;
    expect(useEditorStore.getState().selection.active).toBe(true);
  });

  it('leaves a selection made while the layer was being read', async () => {
    const id = seedLayer();

    const pending = selectLayerAlpha(id);
    const newer = new Uint8ClampedArray(64 * 64).fill(255);
    useEditorStore.getState().setSelection({ x: 0, y: 0, width: 64, height: 64 }, newer, 64, 64);
    await pending;

    expect(useEditorStore.getState().selection.mask).toBe(newer);
    expect(schedulePrefloat).not.toHaveBeenCalled();
  });

  it('lets the newest of two requests win', async () => {
    const id = seedLayer();
    const shifted = new ImageData(4, 3);
    shifted.data[3] = 255;
    let deliverFirst: (pixels: ImageData) => void = () => {};
    readLayerAsImageData
      .mockReturnValueOnce(new Promise<ImageData>((resolve) => { deliverFirst = resolve; }))
      .mockResolvedValueOnce(shifted);

    const first = selectLayerAlpha(id);
    await selectLayerAlpha(id);
    const pixels = new ImageData(4, 3);
    pixels.data[(2 * 4 + 3) * 4 + 3] = 255;
    deliverFirst(pixels);
    await first;

    expect(useEditorStore.getState().selection.bounds).toEqual({ x: 10, y: 20, width: 1, height: 1 });
  });
});
