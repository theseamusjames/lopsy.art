// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransformState } from '../../tools/transform/transform';

const box = vi.hoisted(() => ({ current: null as TransformState | null }));
vi.mock('./layer-transform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./layer-transform')>();
  return { ...actual, getLayerTransformBox: () => box.current };
});
const rotateActiveLayer = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../MenuBar/menus/image-menu', () => ({ rotateActiveLayer }));

const { useEditorStore } = await import('../editor-store');
const { createRasterLayer, createGroupLayer } = await import('../../layers/layer-model');
const { flipFromMoveOptions, rotateFromMoveOptions, wantsLayerTransform } = await import('./move-transform-buttons');

describe('wantsLayerTransform', () => {
  const a = createRasterLayer({ name: 'a', width: 4, height: 4 });
  const b = createRasterLayer({ name: 'b', width: 4, height: 4 });

  it('frames several layers, or a group, when no marquee is active', () => {
    const group = { ...createGroupLayer({ name: 'g' }), children: [a.id] };
    expect(wantsLayerTransform(false, [a, b], [a.id, b.id])).toBe(true);
    expect(wantsLayerTransform(false, [a, group], [group.id])).toBe(true);
    expect(wantsLayerTransform(false, [a, b], [a.id])).toBe(false);
    expect(wantsLayerTransform(true, [a, b], [a.id, b.id])).toBe(false);
  });

  it('does not frame layers that are all locked', () => {
    expect(wantsLayerTransform(false, [{ ...a, locked: true }, { ...b, locked: true }], [a.id, b.id])).toBe(false);
  });
});

describe('the Move options buttons', () => {
  beforeEach(() => {
    useEditorStore.getState().createDocument(20, 20, false);
    box.current = null;
    rotateActiveLayer.mockClear();
  });

  it('rotate turns the single active layer when there is no shared box or marquee', async () => {
    await rotateFromMoveOptions('cw');
    expect(rotateActiveLayer).toHaveBeenCalledWith('cw');
  });

  it('a flip outside the shared box with nothing selected does nothing', async () => {
    const before = useEditorStore.getState().undoStack.length;
    await flipFromMoveOptions('horizontal', false);
    expect(useEditorStore.getState().undoStack).toHaveLength(before);
  });
});
