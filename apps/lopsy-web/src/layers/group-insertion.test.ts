import { describe, it, expect } from 'vitest';
import { createGroupLayer, createRasterLayer } from './layer-model';
import { getInsertionGroupId, getInsertionOrderIndex } from './group-utils';
import type { Layer } from '../types';

function buildDoc(isCollapsed: boolean) {
  const bg = createRasterLayer({ name: 'Background', width: 10, height: 10 });
  const child = createRasterLayer({ name: 'Child', width: 10, height: 10 });
  const group = { ...createGroupLayer({ name: 'Group', children: [child.id] }), collapsed: isCollapsed };
  const root = { ...createGroupLayer({ name: 'Project', children: [bg.id, group.id] }), collapsed: true };
  const layers: Layer[] = [bg, child, group, root];
  const layerOrder = [bg.id, child.id, group.id, root.id];
  return { layers, layerOrder, group, root };
}

describe('insertion with a group active (#1145)', () => {
  it('inserts inside an expanded group', () => {
    const { layers, layerOrder, group, root } = buildDoc(false);
    expect(getInsertionGroupId(layers, group.id, root.id)).toBe(group.id);
    expect(getInsertionOrderIndex(layerOrder, group.id, root.id, layers)).toBe(2);
  });

  it('inserts a sibling above a collapsed group', () => {
    const { layers, layerOrder, group, root } = buildDoc(true);
    expect(getInsertionGroupId(layers, group.id, root.id)).toBe(root.id);
    expect(getInsertionOrderIndex(layerOrder, group.id, root.id, layers)).toBe(3);
  });

  it('still inserts into the root group even if flagged collapsed', () => {
    const { layers, layerOrder, root } = buildDoc(false);
    expect(getInsertionGroupId(layers, root.id, root.id)).toBe(root.id);
    expect(getInsertionOrderIndex(layerOrder, root.id, root.id, layers)).toBe(3);
  });
});
