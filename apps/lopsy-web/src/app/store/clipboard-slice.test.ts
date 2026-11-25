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
const { useNotificationsStore } = await import('../notifications-store');
const { createGroupLayer, createRasterLayer } = await import('../../layers/layer-model');
const { copySourceRefusal } = await import('./clipboard-slice');

const COPIED_REASON = "Groups can't be copied from. Select a layer inside the group, or use Copy Merged.";
const CUT_REASON = "Groups can't be cut from. Select a layer inside the group, or use Copy Merged.";

function toasts(): Array<[string, string]> {
  return useNotificationsStore.getState().notifications.map((n) => [n.level, n.message]);
}

describe('copySourceRefusal', () => {
  beforeEach(() => {
    useEditorStore.getState().createDocument(10, 10, false);
    useNotificationsStore.setState({ notifications: [] });
  });

  it('pins the copy and cut toasts for a group, without side effects', () => {
    const group = createGroupLayer({ name: 'Group' });
    expect(copySourceRefusal(group, 'copied')).toEqual({ reason: COPIED_REASON, notice: 'info' });
    expect(copySourceRefusal(group, 'cut')).toEqual({ reason: CUT_REASON, notice: 'info' });
    expect(toasts()).toEqual([]);
  });

  it('null for a raster layer and for no layer', () => {
    expect(copySourceRefusal(createRasterLayer({ name: 'L', width: 1, height: 1 }), 'copied')).toBeNull();
    expect(copySourceRefusal(undefined, 'cut')).toBeNull();
  });

  it('copy and cut on a group each toast once and leave the clipboard alone', () => {
    const group = createGroupLayer({ name: 'Group' });
    const doc = useEditorStore.getState().document;
    useEditorStore.setState({
      clipboard: null,
      document: { ...doc, layers: [...doc.layers, group], activeLayerId: group.id },
    });
    useEditorStore.getState().copy();
    expect(toasts()).toEqual([['info', COPIED_REASON]]);
    useEditorStore.getState().cut();
    expect(toasts()).toEqual([['info', COPIED_REASON], ['info', CUT_REASON]]);
    expect(useEditorStore.getState().clipboard).toBeNull();
  });
});
