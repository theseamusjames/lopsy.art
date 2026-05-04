import { describe, it, expect } from 'vitest';
import { migrateFromLegacy, nodesToLegacyAdjustments, createDefaultNode, hasActiveNodes } from './adjustment-node-utils';
import type { ImageAdjustments } from './image-adjustments';
import { IDENTITY_CURVES, IDENTITY_POINTS } from './curves';
import { IDENTITY_LEVELS } from './levels';
import type { AdjustmentNode } from '../types/adjustment-nodes';

const ZERO_ADJ: ImageAdjustments = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  vignette: 0, saturation: 0, vibrance: 0, temperature: 0, tint: 0,
  curves: IDENTITY_CURVES,
  levels: IDENTITY_LEVELS,
};

describe('migrateFromLegacy', () => {
  it('returns an empty array for zero/identity adjustments', () => {
    const nodes = migrateFromLegacy(ZERO_ADJ);
    expect(nodes).toHaveLength(0);
  });

  it('creates an ExposureNode for non-zero exposure', () => {
    const nodes = migrateFromLegacy({ ...ZERO_ADJ, exposure: 1.5 });
    expect(nodes).toHaveLength(1);
    const n = nodes[0];
    expect(n?.type).toBe('exposure');
    if (!n || n.type !== 'exposure') throw new Error('wrong type');
    expect(n.exposure).toBe(1.5);
    expect(n.enabled).toBe(true);
  });

  it('creates separate ContrastNode for non-zero contrast', () => {
    const nodes = migrateFromLegacy({ ...ZERO_ADJ, contrast: 30 });
    const n = nodes[0];
    expect(n?.type).toBe('contrast');
    if (!n || n.type !== 'contrast') throw new Error('wrong type');
    expect(n.contrast).toBe(30);
  });

  it('creates a HighlightsShadowsNode grouping all four fields', () => {
    const nodes = migrateFromLegacy({ ...ZERO_ADJ, highlights: 10, shadows: -20, whites: 5, blacks: 0 });
    const n = nodes[0];
    expect(n?.type).toBe('highlights-shadows');
    if (!n || n.type !== 'highlights-shadows') throw new Error('wrong type');
    expect(n.highlights).toBe(10);
    expect(n.shadows).toBe(-20);
    expect(n.whites).toBe(5);
    expect(n.blacks).toBe(0);
  });

  it('creates a SaturationNode grouping saturation and vibrance', () => {
    const nodes = migrateFromLegacy({ ...ZERO_ADJ, saturation: 40, vibrance: 20 });
    const n = nodes[0];
    expect(n?.type).toBe('saturation');
    if (!n || n.type !== 'saturation') throw new Error('wrong type');
    expect(n.saturation).toBe(40);
    expect(n.vibrance).toBe(20);
  });

  it('creates a CurvesNode for non-identity curves', () => {
    const customCurves = { ...IDENTITY_CURVES, rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] };
    const nodes = migrateFromLegacy({ ...ZERO_ADJ, curves: customCurves });
    const n = nodes.find((node) => node.type === 'curves');
    expect(n).toBeDefined();
    if (!n || n.type !== 'curves') throw new Error('wrong type');
    expect(n.curves.rgb).toHaveLength(3);
  });

  it('creates a LevelsNode for non-identity levels', () => {
    const customLevels = { ...IDENTITY_LEVELS, rgb: { inputBlack: 0.1, inputWhite: 0.9, gamma: 1, outputBlack: 0, outputWhite: 1 } };
    const nodes = migrateFromLegacy({ ...ZERO_ADJ, levels: customLevels });
    const n = nodes.find((node) => node.type === 'levels');
    expect(n).toBeDefined();
    if (!n || n.type !== 'levels') throw new Error('wrong type');
    expect(n.levels.rgb.inputBlack).toBe(0.1);
  });

  it('each node gets a unique id', () => {
    const nodes = migrateFromLegacy({ ...ZERO_ADJ, exposure: 1, contrast: 2, vignette: 10 });
    const ids = nodes.map((n) => n.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe('nodesToLegacyAdjustments', () => {
  it('returns all-zero for an empty node list', () => {
    const adj = nodesToLegacyAdjustments([]);
    expect(adj.exposure).toBe(0);
    expect(adj.contrast).toBe(0);
    expect(adj.saturation).toBe(0);
  });

  it('accumulates exposure from an ExposureNode', () => {
    const node: AdjustmentNode = { id: '1', enabled: true, type: 'exposure', exposure: 2 };
    const adj = nodesToLegacyAdjustments([node]);
    expect(adj.exposure).toBe(2);
  });

  it('skips disabled nodes', () => {
    const node: AdjustmentNode = { id: '1', enabled: false, type: 'exposure', exposure: 5 };
    const adj = nodesToLegacyAdjustments([node]);
    expect(adj.exposure).toBe(0);
  });

  it('accumulates multiple exposure nodes additively', () => {
    const nodes: AdjustmentNode[] = [
      { id: '1', enabled: true, type: 'exposure', exposure: 1 },
      { id: '2', enabled: true, type: 'exposure', exposure: 0.5 },
    ];
    const adj = nodesToLegacyAdjustments(nodes);
    expect(adj.exposure).toBeCloseTo(1.5);
  });

  it('uses the last CurvesNode (non-additive)', () => {
    const curves1 = { ...IDENTITY_CURVES, rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 1, y: 1 }] };
    const curves2 = { ...IDENTITY_CURVES, rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] };
    const nodes: AdjustmentNode[] = [
      { id: '1', enabled: true, type: 'curves', curves: curves1 },
      { id: '2', enabled: true, type: 'curves', curves: curves2 },
    ];
    const adj = nodesToLegacyAdjustments(nodes);
    // Last write wins for curves.
    expect(adj.curves).toBe(curves2);
  });

  it('round-trips migration correctly', () => {
    const original: ImageAdjustments = { ...ZERO_ADJ, exposure: 0.5, contrast: 20, saturation: -30, vignette: 15 };
    const nodes = migrateFromLegacy(original);
    const restored = nodesToLegacyAdjustments(nodes);
    expect(restored.exposure).toBeCloseTo(original.exposure);
    expect(restored.contrast).toBeCloseTo(original.contrast);
    expect(restored.saturation).toBeCloseTo(original.saturation);
    expect(restored.vignette).toBeCloseTo(original.vignette);
    expect(restored.highlights).toBe(0);
    expect(restored.shadows).toBe(0);
  });
});

describe('createDefaultNode', () => {
  it('creates enabled nodes with expected defaults', () => {
    const exp = createDefaultNode('exposure');
    expect(exp.type).toBe('exposure');
    expect(exp.enabled).toBe(true);
    if (exp.type !== 'exposure') throw new Error('wrong type');
    expect(exp.exposure).toBe(0);

    const sat = createDefaultNode('saturation');
    expect(sat.type).toBe('saturation');
    if (sat.type !== 'saturation') throw new Error('wrong type');
    expect(sat.saturation).toBe(0);
    expect(sat.vibrance).toBe(0);

    const curves = createDefaultNode('curves');
    expect(curves.type).toBe('curves');
    if (curves.type !== 'curves') throw new Error('wrong type');
    expect(curves.curves.rgb).toBe(IDENTITY_POINTS);

    const invert = createDefaultNode('invert');
    expect(invert.type).toBe('invert');
  });
});

describe('hasActiveNodes', () => {
  it('returns false for empty list', () => {
    expect(hasActiveNodes([])).toBe(false);
  });

  it('returns false when all nodes are disabled', () => {
    const nodes: AdjustmentNode[] = [
      { id: '1', enabled: false, type: 'exposure', exposure: 5 },
    ];
    expect(hasActiveNodes(nodes)).toBe(false);
  });

  it('returns true when at least one node is enabled', () => {
    const nodes: AdjustmentNode[] = [
      { id: '1', enabled: false, type: 'exposure', exposure: 5 },
      { id: '2', enabled: true, type: 'contrast', contrast: 10 },
    ];
    expect(hasActiveNodes(nodes)).toBe(true);
  });
});
