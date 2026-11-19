import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('./gesture-session', () => ({ clearPersistentTransform: () => calls.push('clearPersistentTransform') }));
vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => ({ setActiveLayer: (id: string) => calls.push(`setActiveLayer(${id})`) }) },
}));
vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => ({ setMaskEditMode: (on: boolean) => calls.push(`setMaskEditMode(${on})`) }) },
}));

const { activateLayerFromPanel, editLayerMaskFromPanel, selectLayerFromPanel } = await import('./layer-activation');

describe('layer activation from the Layers panel', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('commits the pending transform before activating the layer', () => {
    selectLayerFromPanel('a');
    expect(calls).toEqual(['clearPersistentTransform', 'setActiveLayer(a)']);
  });

  it('a row click then leaves mask edit mode', () => {
    activateLayerFromPanel('a');
    expect(calls).toEqual(['clearPersistentTransform', 'setActiveLayer(a)', 'setMaskEditMode(false)']);
  });

  it('a mask thumbnail click then enters mask edit mode', () => {
    editLayerMaskFromPanel('a');
    expect(calls).toEqual(['clearPersistentTransform', 'setActiveLayer(a)', 'setMaskEditMode(true)']);
  });
});
