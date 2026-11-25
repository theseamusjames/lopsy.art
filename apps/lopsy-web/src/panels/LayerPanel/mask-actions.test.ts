// @vitest-environment jsdom
import '../../test/canvas-mock';
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

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { addMaskAndEdit, removeMaskAndLeaveEdit } = await import('./mask-actions');

function activeId(): string {
  return useEditorStore.getState().document.activeLayerId!;
}

function activeMask() {
  const doc = useEditorStore.getState().document;
  return doc.layers.find((l) => l.id === doc.activeLayerId)?.mask ?? null;
}

beforeEach(() => {
  useEditorStore.getState().createDocument(20, 10, false);
  useUIStore.getState().setMaskEditMode(false);
});

describe('addMaskAndEdit', () => {
  it('adds a mask and enters mask edit mode', () => {
    addMaskAndEdit(activeId());
    expect(activeMask()).not.toBeNull();
    expect(useUIStore.getState().maskMode).toBe('layerMask');
  });

  it('leaves mask edit mode alone when no mask was added', () => {
    addMaskAndEdit('missing');
    expect(useUIStore.getState().maskMode).toBe('off');
  });
});

describe('removeMaskAndLeaveEdit', () => {
  it('removes the mask and leaves mask edit mode', () => {
    addMaskAndEdit(activeId());
    removeMaskAndLeaveEdit(activeId());
    expect(activeMask()).toBeNull();
    expect(useUIStore.getState().maskMode).toBe('off');
  });
});
