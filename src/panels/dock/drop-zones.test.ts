import { describe, expect, it } from 'vitest';
import type { DropZones } from './drop-zones';
import { dropIndicatorRect, groupRegionAt, resolveDropTarget } from './drop-zones';

const HOST = { x: 0, y: 0, width: 1200, height: 800 };

function zones(partial?: Partial<DropZones>): DropZones {
  return { hostRect: HOST, groups: [], ...partial };
}

describe('groupRegionAt', () => {
  const rect = { x: 100, y: 100, width: 200, height: 200 };

  it('detects the center', () => {
    expect(groupRegionAt(200, 200, rect)).toBe('center');
  });

  it('detects each edge band', () => {
    expect(groupRegionAt(110, 200, rect)).toBe('left');
    expect(groupRegionAt(290, 200, rect)).toBe('right');
    expect(groupRegionAt(200, 110, rect)).toBe('top');
    expect(groupRegionAt(200, 290, rect)).toBe('bottom');
  });
});

describe('resolveDropTarget', () => {
  it('returns null in open space (float)', () => {
    expect(resolveDropTarget(600, 400, zones())).toBeNull();
  });

  it('targets host edges inside the edge band', () => {
    expect(resolveDropTarget(10, 400, zones())).toEqual({ kind: 'edge', side: 'left' });
    expect(resolveDropTarget(1195, 400, zones())).toEqual({ kind: 'edge', side: 'right' });
    expect(resolveDropTarget(600, 5, zones())).toEqual({ kind: 'edge', side: 'top' });
    expect(resolveDropTarget(600, 795, zones())).toEqual({ kind: 'edge', side: 'bottom' });
  });

  it('returns null outside the host', () => {
    expect(resolveDropTarget(-5, 400, zones())).toBeNull();
    expect(resolveDropTarget(1300, 400, zones())).toBeNull();
  });

  it('targets a docked group with a region', () => {
    const z = zones({
      groups: [
        {
          groupId: 'g1',
          rect: { x: 900, y: 0, width: 300, height: 400 },
          isFloating: false,
          tabCount: 1,
        },
      ],
    });
    expect(resolveDropTarget(1050, 200, z)).toEqual({
      kind: 'group',
      groupId: 'g1',
      region: 'center',
    });
    expect(resolveDropTarget(1050, 390, z)).toEqual({
      kind: 'group',
      groupId: 'g1',
      region: 'bottom',
    });
  });

  it('degrades a full group center to a side split', () => {
    const z = zones({
      groups: [
        {
          groupId: 'g1',
          rect: { x: 900, y: 0, width: 300, height: 400 },
          isFloating: false,
          tabCount: 3,
        },
      ],
    });
    const target = resolveDropTarget(1050, 210, z);
    expect(target?.kind).toBe('group');
    expect(target?.kind === 'group' && target.region).not.toBe('center');
  });

  it('prefers a group over the host edge band', () => {
    const z = zones({
      groups: [
        {
          groupId: 'g1',
          rect: { x: 900, y: 0, width: 300, height: 800 },
          isFloating: false,
          tabCount: 1,
        },
      ],
    });
    const target = resolveDropTarget(1195, 400, z);
    expect(target).toEqual({ kind: 'group', groupId: 'g1', region: 'right' });
  });

  it('merges into a floating window anywhere over it, unless full', () => {
    const floating = {
      groupId: 'w1',
      rect: { x: 400, y: 300, width: 300, height: 200 },
      isFloating: true,
      tabCount: 2,
    };
    const z = zones({ groups: [floating] });
    expect(resolveDropTarget(410, 310, z)).toEqual({
      kind: 'group',
      groupId: 'w1',
      region: 'center',
    });
    const full = zones({ groups: [{ ...floating, tabCount: 3 }] });
    expect(resolveDropTarget(410, 310, full)).toBeNull();
  });

  it('hits the top-most floating window first', () => {
    const rect = { x: 400, y: 300, width: 300, height: 200 };
    const z = zones({
      groups: [
        { groupId: 'top', rect, isFloating: true, tabCount: 1 },
        { groupId: 'below', rect, isFloating: true, tabCount: 1 },
      ],
    });
    expect(resolveDropTarget(450, 350, z)).toEqual({
      kind: 'group',
      groupId: 'top',
      region: 'center',
    });
  });
});

describe('dropIndicatorRect', () => {
  it('renders edge strips against the host bounds', () => {
    const left = dropIndicatorRect({ kind: 'edge', side: 'left' }, zones());
    expect(left).toMatchObject({ x: 0, y: 0, height: 800 });
    const bottom = dropIndicatorRect({ kind: 'edge', side: 'bottom' }, zones());
    expect(bottom?.width).toBe(1200);
    expect((bottom?.y ?? 0) + (bottom?.height ?? 0)).toBe(800);
  });

  it('renders group halves for side regions and the full rect for center', () => {
    const z = zones({
      groups: [
        {
          groupId: 'g1',
          rect: { x: 100, y: 100, width: 200, height: 400 },
          isFloating: false,
          tabCount: 1,
        },
      ],
    });
    expect(dropIndicatorRect({ kind: 'group', groupId: 'g1', region: 'center' }, z)).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 400,
    });
    expect(dropIndicatorRect({ kind: 'group', groupId: 'g1', region: 'right' }, z)).toEqual({
      x: 200,
      y: 100,
      width: 100,
      height: 400,
    });
  });

  it('returns null for float targets and unknown groups', () => {
    expect(
      dropIndicatorRect({ kind: 'float', rect: { x: 0, y: 0, width: 10, height: 10 } }, zones()),
    ).toBeNull();
    expect(
      dropIndicatorRect({ kind: 'group', groupId: 'missing', region: 'center' }, zones()),
    ).toBeNull();
    expect(dropIndicatorRect(null, zones())).toBeNull();
  });
});
