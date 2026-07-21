import { describe, expect, it } from 'vitest';
import type { SplitNode } from './dock-layout';
import { collectGroups, createDefaultLayout, panelsInLayout } from './dock-layout';
import { sanitizeLayout, serializeLayout } from './dock-persist';

const PANELS = ['navigator', 'info', 'color', 'channels', 'history', 'paths', 'layers'];

describe('sanitizeLayout', () => {
  it('round-trips a valid layout', () => {
    const layout = createDefaultLayout();
    const parsed = sanitizeLayout(JSON.parse(serializeLayout(layout)), PANELS);
    expect(parsed).toEqual(layout);
  });

  it('rejects non-layout values', () => {
    expect(sanitizeLayout(null, PANELS)).toBeNull();
    expect(sanitizeLayout('junk', PANELS)).toBeNull();
    expect(sanitizeLayout({ docks: 3 }, PANELS)).toBeNull();
  });

  it('drops unknown panel ids and empty groups', () => {
    const raw = {
      docks: {
        right: {
          kind: 'split',
          id: 's',
          direction: 'column',
          children: [
            { kind: 'tabs', id: 'g1', tabs: ['color', 'bogus'], activeTab: 'bogus' },
            { kind: 'tabs', id: 'g2', tabs: ['nonsense'], activeTab: 'nonsense' },
          ],
          sizes: [0.5, 0.5],
        },
      },
    };
    const layout = sanitizeLayout(raw, PANELS);
    expect(layout).not.toBeNull();
    const groups = collectGroups(layout?.docks.right ?? null);
    expect(groups.map((g) => g.tabs)).toEqual([['color']]);
    expect(groups[0]?.activeTab).toBe('color');
  });

  it('deduplicates a panel that appears twice — first occurrence wins', () => {
    const raw = {
      docks: {
        left: { kind: 'tabs', id: 'g1', tabs: ['color'], activeTab: 'color' },
        right: { kind: 'tabs', id: 'g2', tabs: ['color', 'layers'], activeTab: 'color' },
      },
    };
    const layout = sanitizeLayout(raw, PANELS);
    expect(panelsInLayout(layout ?? createDefaultLayout()).sort()).toEqual(['color', 'layers']);
    expect(collectGroups(layout?.docks.left ?? null)[0]?.tabs).toEqual(['color']);
    expect(collectGroups(layout?.docks.right ?? null)[0]?.tabs).toEqual(['layers']);
  });

  it('caps tabs per group at three', () => {
    const raw = {
      docks: {
        right: {
          kind: 'tabs',
          id: 'g',
          tabs: ['navigator', 'info', 'color', 'channels'],
          activeTab: 'channels',
        },
      },
    };
    const layout = sanitizeLayout(raw, PANELS);
    expect(collectGroups(layout?.docks.right ?? null)[0]?.tabs).toEqual([
      'navigator',
      'info',
      'color',
    ]);
  });

  it('repairs malformed sizes and clamps dock sizes', () => {
    const raw = {
      docks: {
        right: {
          kind: 'split',
          id: 's',
          direction: 'column',
          children: [
            { kind: 'tabs', id: 'g1', tabs: ['color'], activeTab: 'color' },
            { kind: 'tabs', id: 'g2', tabs: ['layers'], activeTab: 'layers' },
          ],
          sizes: ['bad', Number.NaN],
        },
      },
      dockSizes: { right: 5, left: 'wide' },
    };
    const layout = sanitizeLayout(raw, PANELS);
    expect((layout?.docks.right as SplitNode).sizes).toEqual([0.5, 0.5]);
    expect(layout?.dockSizes.right).toBe(160);
    expect(layout?.dockSizes.left).toBe(280);
  });

  it('sanitizes floating windows: sizes clamped, bad entries dropped', () => {
    const raw = {
      docks: {},
      floating: [
        { id: 'w1', tabs: ['history'], activeTab: 'history', x: 50, y: 60, width: 5, height: 5 },
        { id: 'w2', tabs: [], activeTab: '' },
        'garbage',
      ],
    };
    const layout = sanitizeLayout(raw, PANELS);
    expect(layout?.floating).toHaveLength(1);
    expect(layout?.floating[0]).toMatchObject({ x: 50, y: 60, width: 200, height: 140 });
  });

  it('collapses a split left with one child after invalid children are dropped', () => {
    const raw = {
      docks: {
        right: {
          kind: 'split',
          id: 's',
          direction: 'row',
          children: [
            { kind: 'tabs', id: 'g1', tabs: ['color'], activeTab: 'color' },
            { kind: 'tabs', id: 'g2', tabs: ['fake'], activeTab: 'fake' },
          ],
          sizes: [0.5, 0.5],
        },
      },
    };
    const layout = sanitizeLayout(raw, PANELS);
    expect(layout?.docks.right?.kind).toBe('tabs');
  });
});
