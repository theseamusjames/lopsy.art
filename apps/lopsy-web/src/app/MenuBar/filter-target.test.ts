// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Layer } from '../../types';

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
const { useUIStore } = await import('../ui-store');
const { useNotificationsStore } = await import('../notifications-store');
const { createGroupLayer, createTextLayer } = await import('../../layers/layer-model');
const { filterTargetRefusal, resolveFilterTarget, peekFilterTarget } = await import('./filter-target');

const GROUP_REASON = "Groups can't be painted on. Select a layer inside the group.";
const TEXT_REASON = 'Text layers must be rasterized before they can be painted on.';

function toasts(): Array<[string, string]> {
  return useNotificationsStore.getState().notifications.map((n) => [n.level, n.message]);
}

function activate(layer: Layer): void {
  const doc = useEditorStore.getState().document;
  useEditorStore.setState({ document: { ...doc, layers: [...doc.layers, layer], activeLayerId: layer.id } });
}

function setActiveLayerId(activeLayerId: string | null): void {
  useEditorStore.setState({ document: { ...useEditorStore.getState().document, activeLayerId } });
}

describe('filterTargetRefusal', () => {
  beforeEach(() => {
    useEditorStore.getState().createDocument(10, 10, false);
    useUIStore.setState({ maskMode: 'off' });
    useNotificationsStore.setState({ notifications: [] });
  });

  it('null for a raster layer, which resolves as a layer target without a toast', () => {
    const layerId = useEditorStore.getState().document.activeLayerId;
    expect(filterTargetRefusal()).toBeNull();
    expect(resolveFilterTarget()).toEqual({ layerId, isMask: false });
    expect(toasts()).toEqual([]);
  });

  it('pins the group refusal; resolve toasts it once, peek stays silent', () => {
    activate(createGroupLayer({ name: 'Group' }));
    expect(filterTargetRefusal()).toEqual({ reason: GROUP_REASON, notice: 'info' });
    expect(toasts()).toEqual([]);
    expect(peekFilterTarget()).toBeNull();
    expect(toasts()).toEqual([]);
    expect(resolveFilterTarget()).toBeNull();
    expect(toasts()).toEqual([['info', GROUP_REASON]]);
  });

  it('pins the text refusal; resolve toasts it once', () => {
    activate(createTextLayer({ name: 'Hello', text: 'Hello' }));
    expect(filterTargetRefusal()).toEqual({ reason: TEXT_REASON, notice: 'info' });
    expect(toasts()).toEqual([]);
    expect(resolveFilterTarget()).toBeNull();
    expect(toasts()).toEqual([['info', TEXT_REASON]]);
  });

  it('a silent refusal when there is no active layer', () => {
    setActiveLayerId(null);
    expect(filterTargetRefusal()).toEqual({ reason: 'There is no active layer.', notice: null });
    expect(resolveFilterTarget()).toBeNull();
    expect(toasts()).toEqual([]);
  });

  it('a silent refusal when the active layer id names no layer', () => {
    setActiveLayerId('missing');
    expect(filterTargetRefusal()?.notice).toBeNull();
    expect(resolveFilterTarget()).toBeNull();
    expect(toasts()).toEqual([]);
  });

  it('null when filtering a mask, even on a group', () => {
    const group = createGroupLayer({ name: 'Group' });
    activate(group);
    useEditorStore.getState().addLayerMask(group.id);
    useUIStore.setState({ maskMode: 'layerMask' });
    useNotificationsStore.setState({ notifications: [] });
    expect(filterTargetRefusal()).toBeNull();
    expect(resolveFilterTarget()).toEqual({ layerId: group.id, isMask: true });
    expect(toasts()).toEqual([]);
  });
});
