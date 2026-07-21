import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDockStore } from './dock-store';
import { setVisiblePanelsSink } from './dock-ui-bridge';
import { collectGroups, createDefaultLayout, findPanelGroupId, panelsInLayout } from './dock-layout';

// The dock store publishes visiblePanels through the bridge (ui-store
// registers the real sink); capture publishes here.
const setState = vi.fn();
setVisiblePanelsSink((panels) => setState({ visiblePanels: panels }));

function reset(): void {
  useDockStore.setState({ layout: createDefaultLayout(), drag: null });
  setState.mockClear();
}

function visible(): string[] {
  return panelsInLayout(useDockStore.getState().layout).sort();
}

beforeEach(reset);

describe('togglePanel', () => {
  it('adds a missing panel at its default location', () => {
    useDockStore.getState().togglePanel('history');
    expect(visible()).toEqual(['color', 'history', 'layers']);
  });

  it('removes a panel whose tab is active', () => {
    useDockStore.getState().togglePanel('color');
    expect(visible()).toEqual(['layers']);
  });

  it('activates an inactive tab instead of removing it', () => {
    const { layout } = useDockStore.getState();
    const layersGroup = findPanelGroupId(layout, 'layers') ?? '';
    useDockStore.getState().dropTab('color', {
      kind: 'group',
      groupId: layersGroup,
      region: 'center',
    });
    useDockStore.getState().activateTab(layersGroup, 'layers');

    useDockStore.getState().togglePanel('color');
    const groups = collectGroups(useDockStore.getState().layout.docks.right);
    expect(groups[0]?.activeTab).toBe('color');
    expect(visible()).toEqual(['color', 'layers']);
  });

  it('mirrors visiblePanels into ui-store on every change', () => {
    useDockStore.getState().togglePanel('history');
    const lastCall = setState.mock.calls[setState.mock.calls.length - 1]?.[0] as {
      visiblePanels: Set<string>;
    };
    expect([...lastCall.visiblePanels].sort()).toEqual(['color', 'history', 'layers']);
  });
});

describe('revealPanel', () => {
  it('opens a closed panel', () => {
    useDockStore.getState().revealPanel('paths');
    expect(visible()).toContain('paths');
  });

  it('activates the tab of an open panel', () => {
    const { layout } = useDockStore.getState();
    const layersGroup = findPanelGroupId(layout, 'layers') ?? '';
    useDockStore.getState().dropTab('color', {
      kind: 'group',
      groupId: layersGroup,
      region: 'center',
    });
    useDockStore.getState().activateTab(layersGroup, 'layers');

    useDockStore.getState().revealPanel('color');
    const groups = collectGroups(useDockStore.getState().layout.docks.right);
    expect(groups[0]?.activeTab).toBe('color');
  });
});

describe('drag/drop actions', () => {
  it('dropTab floats a panel and dropWindow re-docks it', () => {
    const store = useDockStore.getState();
    store.dropTab('color', { kind: 'float', rect: { x: 10, y: 10, width: 300, height: 300 } });
    let state = useDockStore.getState();
    expect(state.layout.floating).toHaveLength(1);

    const windowId = state.layout.floating[0]?.id ?? '';
    useDockStore.getState().dropWindow(windowId, { kind: 'edge', side: 'left' });
    state = useDockStore.getState();
    expect(state.layout.floating).toHaveLength(0);
    expect(collectGroups(state.layout.docks.left).map((g) => g.tabs)).toEqual([['color']]);
  });

  it('resizeDock clamps and stores px sizes', () => {
    useDockStore.getState().resizeDock('right', 500);
    expect(useDockStore.getState().layout.dockSizes.right).toBe(500);
    useDockStore.getState().resizeDock('right', 1);
    expect(useDockStore.getState().layout.dockSizes.right).toBe(160);
  });

  it('resetLayout restores the default arrangement', () => {
    useDockStore.getState().togglePanel('color');
    useDockStore.getState().resetLayout();
    expect(visible()).toEqual(['color', 'layers']);
  });
});
