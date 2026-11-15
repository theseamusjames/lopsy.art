import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];

vi.mock('../panels/LayerPanel/layer-selection', () => ({
  selectLayerAlpha: vi.fn((id: string, options?: { prefloat?: boolean }) => {
    calls.push(`select:${id}:${options?.prefloat === false ? 'no-prefloat' : 'prefloat'}`);
  }),
}));

vi.mock('../engine-wasm/engine-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../engine-wasm/engine-sync')>()),
  flushLayerSync: vi.fn(() => { calls.push('flush'); }),
}));

const { pasteInternalClipboard } = await import('./paste-or-open');
const { useEditorStore } = await import('./editor-store');
const { useUIStore } = await import('./ui-store');
const { selectLayerAlpha } = await import('../panels/LayerPanel/layer-selection');

describe('pasteInternalClipboard', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.mocked(selectLayerAlpha).mockClear();
    useUIStore.setState({ activeTool: 'marquee-rect' });
  });

  it('selects the pasted layer and switches to Move', () => {
    useEditorStore.setState({ paste: () => 'pasted-1' });

    pasteInternalClipboard();

    expect(useUIStore.getState().activeTool).toBe('move');
    // The engine must know the new layer before its alpha is read back.
    expect(calls).toEqual(['flush', 'select:pasted-1:no-prefloat']);
  });

  it('does nothing further when the clipboard pasted nothing', () => {
    useEditorStore.setState({ paste: () => null });

    pasteInternalClipboard();

    expect(useUIStore.getState().activeTool).toBe('marquee-rect');
    expect(selectLayerAlpha).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
