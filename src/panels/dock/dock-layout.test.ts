import { describe, expect, it } from 'vitest';
import type { DockLayout, SplitNode, TabGroupNode } from './dock-layout';
import {
  addPanelToDefaultLocation,
  applySplitDrag,
  bringFloatingToFront,
  clampFloatingToHost,
  collectGroups,
  createDefaultLayout,
  createTabGroup,
  dockFloatingWindow,
  emptyLayout,
  findGroup,
  findPanelGroupId,
  insertNode,
  MAX_TABS_PER_GROUP,
  movePanel,
  moveFloatingWindow,
  normalizeNode,
  panelsInLayout,
  removePanel,
  resizeFloatingWindow,
  setActiveTab,
  setDockSize,
  setSplitSizes,
} from './dock-layout';

const ORDER = ['navigator', 'info', 'color', 'channels', 'history', 'paths', 'layers'];

function rightGroups(layout: DockLayout): TabGroupNode[] {
  return collectGroups(layout.docks.right);
}

function layoutWithRight(node: DockLayout['docks']['right']): DockLayout {
  const layout = emptyLayout();
  return { ...layout, docks: { ...layout.docks, right: node } };
}

describe('createDefaultLayout', () => {
  it('stacks color above layers on the right', () => {
    const layout = createDefaultLayout();
    const groups = rightGroups(layout);
    expect(groups.map((g) => g.tabs)).toEqual([['color'], ['layers']]);
    expect(layout.docks.left).toBeNull();
    expect(layout.floating).toEqual([]);
  });
});

describe('panelsInLayout / finders', () => {
  it('collects panels across docks and floating windows', () => {
    let layout = createDefaultLayout();
    layout = insertNode(layout, createTabGroup(['history']), {
      kind: 'float',
      rect: { x: 10, y: 10, width: 300, height: 300 },
    });
    expect(panelsInLayout(layout).sort()).toEqual(['color', 'history', 'layers']);

    const colorGroup = rightGroups(layout).find((g) => g.tabs.includes('color'));
    expect(findPanelGroupId(layout, 'color')).toBe(colorGroup?.id);
    const floatingId = findPanelGroupId(layout, 'history');
    expect(layout.floating[0]?.id).toBe(floatingId);
    expect(findGroup(layout, floatingId ?? '')?.place).toBe('floating');
    expect(findGroup(layout, 'nope')).toBeNull();
  });
});

describe('removePanel', () => {
  it('removes a tab and keeps the group when other tabs remain', () => {
    const group = createTabGroup(['color', 'info'], 'info');
    const layout = layoutWithRight(group);
    const next = removePanel(layout, 'info');
    const groups = rightGroups(next);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tabs).toEqual(['color']);
    expect(groups[0]?.activeTab).toBe('color');
  });

  it('dissolves an empty group and collapses the parent split', () => {
    const layout = createDefaultLayout();
    const next = removePanel(layout, 'color');
    expect(next.docks.right?.kind).toBe('tabs');
    expect(panelsInLayout(next)).toEqual(['layers']);
  });

  it('drops an emptied floating window', () => {
    let layout = emptyLayout();
    layout = insertNode(layout, createTabGroup(['paths']), {
      kind: 'float',
      rect: { x: 0, y: 0, width: 300, height: 300 },
    });
    const next = removePanel(layout, 'paths');
    expect(next.floating).toEqual([]);
  });

  it('returns the same object when the panel is absent', () => {
    const layout = createDefaultLayout();
    expect(removePanel(layout, 'nope')).toBe(layout);
  });
});

describe('insertNode', () => {
  it('creates a dock from scratch on edge drop', () => {
    const layout = insertNode(emptyLayout(), createTabGroup(['info']), {
      kind: 'edge',
      side: 'left',
    });
    expect(collectGroups(layout.docks.left).map((g) => g.tabs)).toEqual([['info']]);
  });

  it('appends to an existing dock stack on edge drop', () => {
    const layout = insertNode(createDefaultLayout(), createTabGroup(['info']), {
      kind: 'edge',
      side: 'right',
    });
    const root = layout.docks.right as SplitNode;
    expect(root.children).toHaveLength(3);
    expect(rightGroups(layout).map((g) => g.tabs)).toEqual([['color'], ['layers'], ['info']]);
    expect(root.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('wraps a lone group in a stack split on edge drop', () => {
    const layout = insertNode(layoutWithRight(createTabGroup(['color'])), createTabGroup(['info']), {
      kind: 'edge',
      side: 'right',
    });
    const root = layout.docks.right as SplitNode;
    expect(root.direction).toBe('column');
    expect(root.children).toHaveLength(2);
  });

  it('merges tabs on center drop and keeps the dragged tab active', () => {
    const layout = createDefaultLayout();
    const colorGroupId = findPanelGroupId(layout, 'color') ?? '';
    const next = insertNode(layout, createTabGroup(['history']), {
      kind: 'group',
      groupId: colorGroupId,
      region: 'center',
    });
    const group = rightGroups(next).find((g) => g.id === colorGroupId);
    expect(group?.tabs).toEqual(['color', 'history']);
    expect(group?.activeTab).toBe('history');
  });

  it('refuses a center merge past the tab cap', () => {
    const full = createTabGroup(['color', 'info', 'history']);
    const layout = layoutWithRight(full);
    const next = insertNode(layout, createTabGroup(['paths']), {
      kind: 'group',
      groupId: full.id,
      region: 'center',
    });
    expect(next).toBe(layout);
    expect(rightGroups(next)[0]?.tabs).toHaveLength(MAX_TABS_PER_GROUP);
  });

  it('splits a group on a side drop with the new panel on the drop side', () => {
    const target = createTabGroup(['color']);
    const layout = layoutWithRight(target);
    const next = insertNode(layout, createTabGroup(['info']), {
      kind: 'group',
      groupId: target.id,
      region: 'left',
    });
    const root = next.docks.right as SplitNode;
    expect(root.direction).toBe('row');
    expect(collectGroups(root).map((g) => g.tabs)).toEqual([['info'], ['color']]);
  });

  it('flattens same-direction nested splits after a side drop', () => {
    const layout = createDefaultLayout();
    const layersGroupId = findPanelGroupId(layout, 'layers') ?? '';
    const next = insertNode(layout, createTabGroup(['history']), {
      kind: 'group',
      groupId: layersGroupId,
      region: 'top',
    });
    const root = next.docks.right as SplitNode;
    expect(root.direction).toBe('column');
    expect(root.children.every((c) => c.kind === 'tabs')).toBe(true);
    expect(collectGroups(root).map((g) => g.tabs)).toEqual([['color'], ['history'], ['layers']]);
  });

  it('creates a floating window with min-size clamping', () => {
    const layout = insertNode(emptyLayout(), createTabGroup(['info']), {
      kind: 'float',
      rect: { x: 5, y: 6, width: 10, height: 10 },
    });
    const window = layout.floating[0];
    expect(window?.x).toBe(5);
    expect(window?.width).toBeGreaterThanOrEqual(200);
    expect(window?.height).toBeGreaterThanOrEqual(140);
  });
});

describe('movePanel', () => {
  it('moves a docked panel into a floating window', () => {
    const layout = createDefaultLayout();
    const next = movePanel(layout, 'color', {
      kind: 'float',
      rect: { x: 40, y: 40, width: 320, height: 400 },
    });
    expect(next.floating).toHaveLength(1);
    expect(next.floating[0]?.tabs).toEqual(['color']);
    expect(next.docks.right?.kind).toBe('tabs');
  });

  it('merges a panel into another group as a tab', () => {
    const layout = createDefaultLayout();
    const layersGroupId = findPanelGroupId(layout, 'layers') ?? '';
    const next = movePanel(layout, 'color', {
      kind: 'group',
      groupId: layersGroupId,
      region: 'center',
    });
    expect(rightGroups(next)).toHaveLength(1);
    expect(rightGroups(next)[0]?.tabs).toEqual(['layers', 'color']);
    expect(rightGroups(next)[0]?.activeTab).toBe('color');
  });

  it('activates instead of moving when dropped on its own group center', () => {
    const group = createTabGroup(['color', 'info'], 'info');
    const layout = layoutWithRight(group);
    const next = movePanel(layout, 'color', {
      kind: 'group',
      groupId: group.id,
      region: 'center',
    });
    expect(rightGroups(next)[0]?.tabs).toEqual(['color', 'info']);
    expect(rightGroups(next)[0]?.activeTab).toBe('color');
  });

  it('ignores splitting a group by its only tab', () => {
    const group = createTabGroup(['color']);
    const layout = layoutWithRight(group);
    const next = movePanel(layout, 'color', {
      kind: 'group',
      groupId: group.id,
      region: 'left',
    });
    expect(next).toBe(layout);
  });

  it('splits its own multi-tab group, extracting the dragged tab', () => {
    const group = createTabGroup(['color', 'info']);
    const layout = layoutWithRight(group);
    const next = movePanel(layout, 'info', {
      kind: 'group',
      groupId: group.id,
      region: 'bottom',
    });
    const root = next.docks.right as SplitNode;
    expect(root.direction).toBe('column');
    expect(collectGroups(root).map((g) => g.tabs)).toEqual([['color'], ['info']]);
  });

  it('refuses a merge into a full group', () => {
    const full = createTabGroup(['color', 'info', 'history']);
    let layout = layoutWithRight(full);
    layout = insertNode(layout, createTabGroup(['paths']), { kind: 'edge', side: 'left' });
    const next = movePanel(layout, 'paths', {
      kind: 'group',
      groupId: full.id,
      region: 'center',
    });
    expect(next).toBe(layout);
  });

  it('moves a panel out of a floating window, dropping the emptied window', () => {
    let layout = createDefaultLayout();
    layout = movePanel(layout, 'color', {
      kind: 'float',
      rect: { x: 0, y: 0, width: 300, height: 300 },
    });
    const next = movePanel(layout, 'color', { kind: 'edge', side: 'left' });
    expect(next.floating).toEqual([]);
    expect(collectGroups(next.docks.left).map((g) => g.tabs)).toEqual([['color']]);
  });

  it('is a no-op for a panel that is not in the layout', () => {
    const layout = createDefaultLayout();
    expect(movePanel(layout, 'nope', { kind: 'edge', side: 'left' })).toBe(layout);
  });
});

describe('dockFloatingWindow', () => {
  function floatingLayout(tabs: string[]): DockLayout {
    let layout = createDefaultLayout();
    for (const tab of tabs) {
      layout = removePanel(layout, tab);
    }
    return insertNode(layout, createTabGroup(tabs), {
      kind: 'float',
      rect: { x: 20, y: 20, width: 300, height: 300 },
    });
  }

  it('docks all tabs of a window to an edge', () => {
    const layout = floatingLayout(['color']);
    const windowId = layout.floating[0]?.id ?? '';
    const next = dockFloatingWindow(layout, windowId, { kind: 'edge', side: 'left' });
    expect(next.floating).toEqual([]);
    expect(collectGroups(next.docks.left).map((g) => g.tabs)).toEqual([['color']]);
  });

  it('merges a window into a group when combined tabs fit', () => {
    const layout = floatingLayout(['color']);
    const windowId = layout.floating[0]?.id ?? '';
    const layersGroupId = findPanelGroupId(layout, 'layers') ?? '';
    const next = dockFloatingWindow(layout, windowId, {
      kind: 'group',
      groupId: layersGroupId,
      region: 'center',
    });
    expect(next.floating).toEqual([]);
    expect(rightGroups(next)[0]?.tabs).toEqual(['layers', 'color']);
  });

  it('refuses a merge that would exceed the cap', () => {
    let layout = floatingLayout(['color']);
    const windowId = layout.floating[0]?.id ?? '';
    const layersGroupId = findPanelGroupId(layout, 'layers') ?? '';
    layout = insertNode(layout, createTabGroup(['info', 'history']), {
      kind: 'group',
      groupId: layersGroupId,
      region: 'center',
    });
    const next = dockFloatingWindow(layout, windowId, {
      kind: 'group',
      groupId: layersGroupId,
      region: 'center',
    });
    expect(next).toBe(layout);
  });
});

describe('floating window geometry', () => {
  const base = (): DockLayout =>
    insertNode(emptyLayout(), createTabGroup(['info']), {
      kind: 'float',
      rect: { x: 10, y: 20, width: 300, height: 250 },
    });

  it('moves and resizes with clamping', () => {
    let layout = base();
    const id = layout.floating[0]?.id ?? '';
    layout = moveFloatingWindow(layout, id, 99, 88);
    expect(layout.floating[0]).toMatchObject({ x: 99, y: 88 });
    layout = resizeFloatingWindow(layout, id, { x: 99, y: 88, width: 5, height: 5 });
    expect(layout.floating[0]?.width).toBe(200);
    expect(layout.floating[0]?.height).toBe(140);
  });

  it('brings a window to the front (end of array)', () => {
    let layout = base();
    layout = insertNode(layout, createTabGroup(['paths']), {
      kind: 'float',
      rect: { x: 50, y: 50, width: 300, height: 250 },
    });
    const firstId = layout.floating[0]?.id ?? '';
    const next = bringFloatingToFront(layout, firstId);
    expect(next.floating[1]?.id).toBe(firstId);
    expect(bringFloatingToFront(next, firstId)).toBe(next);
  });

  it('clamps windows back into the host', () => {
    let layout = base();
    const id = layout.floating[0]?.id ?? '';
    layout = moveFloatingWindow(layout, id, 5000, 5000);
    const next = clampFloatingToHost(layout, 1200, 800);
    expect(next.floating[0]?.x).toBeLessThanOrEqual(1200 - 48);
    expect(next.floating[0]?.y).toBeLessThanOrEqual(800 - 48);
  });
});

describe('setActiveTab', () => {
  it('activates a tab in a docked group', () => {
    const group = createTabGroup(['color', 'info']);
    const layout = layoutWithRight(group);
    const next = setActiveTab(layout, group.id, 'info');
    expect(rightGroups(next)[0]?.activeTab).toBe('info');
    expect(setActiveTab(next, group.id, 'info')).toBe(next);
  });

  it('activates a tab in a floating window', () => {
    const layout = insertNode(emptyLayout(), createTabGroup(['color', 'info']), {
      kind: 'float',
      rect: { x: 0, y: 0, width: 300, height: 300 },
    });
    const id = layout.floating[0]?.id ?? '';
    const next = setActiveTab(layout, id, 'info');
    expect(next.floating[0]?.activeTab).toBe('info');
  });
});

describe('resizing', () => {
  it('clamps dock sizes', () => {
    const layout = emptyLayout();
    expect(setDockSize(layout, 'right', 10).dockSizes.right).toBe(160);
    expect(setDockSize(layout, 'right', 9999).dockSizes.right).toBe(800);
    expect(setDockSize(layout, 'right', 400).dockSizes.right).toBe(400);
  });

  it('applySplitDrag shifts a divider within min-pane bounds', () => {
    const expectClose = (actual: number[], expected: number[]) => {
      expect(actual).toHaveLength(expected.length);
      actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? Number.NaN, 10));
    };
    expectClose(applySplitDrag([0.5, 0.5], 0, 0.2, 0.1), [0.7, 0.3]);
    expectClose(applySplitDrag([0.5, 0.5], 0, 0.6, 0.1), [0.9, 0.1]);
    expectClose(applySplitDrag([0.5, 0.5], 0, -0.6, 0.1), [0.1, 0.9]);
  });

  it('applySplitDrag never worsens an already-too-small pane', () => {
    const result = applySplitDrag([0.05, 0.95], 0, -0.2, 0.1);
    expect(result[0]).toBeCloseTo(0.05);
  });

  it('setSplitSizes replaces sizes on the matching split only', () => {
    const layout = createDefaultLayout();
    const root = layout.docks.right as SplitNode;
    const next = setSplitSizes(layout, root.id, [0.2, 0.8]);
    expect((next.docks.right as SplitNode).sizes).toEqual([0.2, 0.8]);
    expect(setSplitSizes(layout, 'missing', [0.2, 0.8])).toBe(layout);
    expect(setSplitSizes(layout, root.id, [0.2, 0.3, 0.5])).toBe(layout);
  });
});

describe('addPanelToDefaultLocation', () => {
  it('creates the right dock when empty', () => {
    const next = addPanelToDefaultLocation(emptyLayout(), 'history', ORDER);
    expect(collectGroups(next.docks.right).map((g) => g.tabs)).toEqual([['history']]);
  });

  it('inserts by canonical order into the right stack', () => {
    const next = addPanelToDefaultLocation(createDefaultLayout(), 'history', ORDER);
    expect(rightGroups(next).map((g) => g.tabs)).toEqual([['color'], ['history'], ['layers']]);
  });

  it('places navigator before color', () => {
    const next = addPanelToDefaultLocation(createDefaultLayout(), 'navigator', ORDER);
    expect(rightGroups(next).map((g) => g.tabs)).toEqual([['navigator'], ['color'], ['layers']]);
  });

  it('is a no-op when the panel is already present', () => {
    const layout = createDefaultLayout();
    expect(addPanelToDefaultLocation(layout, 'color', ORDER)).toBe(layout);
  });

  it('stacks above a lone group of later rank', () => {
    const layout = layoutWithRight(createTabGroup(['layers']));
    const next = addPanelToDefaultLocation(layout, 'info', ORDER);
    expect(rightGroups(next).map((g) => g.tabs)).toEqual([['info'], ['layers']]);
  });
});

describe('normalizeNode', () => {
  it('repairs an out-of-tabs active tab', () => {
    const group: TabGroupNode = { kind: 'tabs', id: 'g', tabs: ['a', 'b'], activeTab: 'zzz' };
    expect((normalizeNode(group) as TabGroupNode).activeTab).toBe('a');
  });

  it('flattens nested same-direction splits with scaled sizes', () => {
    const node: SplitNode = {
      kind: 'split',
      id: 's1',
      direction: 'column',
      children: [
        { kind: 'tabs', id: 'g1', tabs: ['a'], activeTab: 'a' },
        {
          kind: 'split',
          id: 's2',
          direction: 'column',
          children: [
            { kind: 'tabs', id: 'g2', tabs: ['b'], activeTab: 'b' },
            { kind: 'tabs', id: 'g3', tabs: ['c'], activeTab: 'c' },
          ],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    const result = normalizeNode(node) as SplitNode;
    expect(result.children).toHaveLength(3);
    expect(result.sizes).toEqual([0.5, 0.25, 0.25]);
  });
});
