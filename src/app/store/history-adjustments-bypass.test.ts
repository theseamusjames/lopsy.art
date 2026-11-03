// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';

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

const { useEditorStore } = await import('../editor-store');

function state() {
  return useEditorStore.getState();
}

function rootGroup() {
  const doc = state().document;
  const group = doc.layers.find((l) => l.id === doc.rootGroupId);
  if (!group || group.type !== 'group') throw new Error('no root group');
  return group;
}

// #1461: the "Disable adjustments" bypass has no history entry, so undo/redo
// of an adjustment edit must leave it as the user last set it.
describe('undo keeps the group adjustments bypass (#1461)', () => {
  beforeEach(() => {
    state().createDocument(200, 100, false);
  });

  it('undoing and redoing an Edit <Node> entry keeps the bypass on', () => {
    const groupId = state().document.rootGroupId!;
    state().addAdjustmentNode(groupId, 'hue-saturation');
    const nodeId = rootGroup().adjustments[0]!.id;

    state().pushHistoryMetadata('Edit Hue / Saturation');
    state().updateAdjustmentNode(groupId, nodeId, { saturation: -100 });
    state().pushHistoryMetadata('Edit Hue / Saturation');
    state().updateAdjustmentNode(groupId, nodeId, { lightness: 20 });

    state().setGroupAdjustmentsEnabled(groupId, false);

    state().undo();
    expect(rootGroup().adjustmentsEnabled).toBe(false);

    state().redo();
    expect(rootGroup().adjustmentsEnabled).toBe(false);

    state().setGroupAdjustmentsEnabled(groupId, true);
    state().undo();
    expect(rootGroup().adjustmentsEnabled).toBe(true);
  });

  it('a pixel-entry undo also keeps the bypass', () => {
    const groupId = state().document.rootGroupId!;
    state().addAdjustmentNode(groupId, 'hue-saturation');
    state().pushHistory('Fill');
    state().setGroupAdjustmentsEnabled(groupId, false);
    state().undo();
    expect(rootGroup().adjustmentsEnabled).toBe(false);
  });
});
