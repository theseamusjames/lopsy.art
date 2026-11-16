import { describe, expect, it } from 'vitest';
import type { LayerEffects } from '../types';
import type { AdjustmentNode } from '../types/adjustment-nodes';
import {
  canPasteOnto,
  pasteGroupAdjustments,
  pasteLayerEffects,
  type EffectsClipboard,
} from './effects-clipboard';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const RED = { r: 255, g: 0, b: 0, a: 1 };

function makeEffects(overrides: Partial<LayerEffects> = {}): LayerEffects {
  return {
    stroke: { enabled: false, color: BLACK, width: 2, position: 'outside' },
    dropShadow: { enabled: false, color: BLACK, offsetX: 4, offsetY: 4, blur: 4, spread: 0, opacity: 0.75 },
    outerGlow: { enabled: false, color: BLACK, size: 10, spread: 0, opacity: 0.75 },
    innerGlow: { enabled: false, color: BLACK, size: 10, spread: 0, opacity: 0.75 },
    colorOverlay: { enabled: false, color: BLACK },
    ...overrides,
  };
}

function idFactory(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

const allowAll = (): boolean => true;

describe('canPasteOnto', () => {
  it('is false with an empty clipboard', () => {
    expect(canPasteOnto(null, 'layer')).toBe(false);
    expect(canPasteOnto(null, 'group')).toBe(false);
  });

  it('only pastes layer effects onto layers and adjustments onto groups', () => {
    const layerClip: EffectsClipboard = { kind: 'layer-effects', effects: makeEffects() };
    const groupClip: EffectsClipboard = {
      kind: 'group-adjustment',
      node: { id: 'a', enabled: true, type: 'invert' },
    };
    expect(canPasteOnto(layerClip, 'layer')).toBe(true);
    expect(canPasteOnto(layerClip, 'group')).toBe(false);
    expect(canPasteOnto(groupClip, 'group')).toBe(true);
    expect(canPasteOnto(groupClip, 'layer')).toBe(false);
  });
});

describe('pasteLayerEffects', () => {
  it('replaces every effect with a full copy', () => {
    const source = makeEffects({
      stroke: { enabled: true, color: RED, width: 6, position: 'inside' },
    });
    const target = makeEffects({
      dropShadow: { enabled: true, color: RED, offsetX: 9, offsetY: 9, blur: 0, spread: 0, opacity: 1 },
    });
    const result = pasteLayerEffects(target, { kind: 'layer-effects', effects: source });
    expect(result).toEqual(source);
    expect(result.dropShadow.enabled).toBe(false);
  });

  it('replaces only the copied kind with a single effect and enables it', () => {
    const source = makeEffects({
      outerGlow: { enabled: false, color: RED, size: 30, spread: 20, opacity: 0.5 },
    });
    const targetShadow = { enabled: true, color: RED, offsetX: 9, offsetY: 9, blur: 0, spread: 0, opacity: 1 };
    const target = makeEffects({ dropShadow: targetShadow });
    const result = pasteLayerEffects(target, { kind: 'layer-effect', key: 'outerGlow', effects: source });
    expect(result.outerGlow).toEqual({ ...source.outerGlow, enabled: true });
    expect(result.dropShadow).toEqual(targetShadow);
    expect(result.stroke).toEqual(target.stroke);
  });

  it('does not share objects with the clipboard', () => {
    const source = makeEffects({ colorOverlay: { enabled: true, color: RED } });
    const result = pasteLayerEffects(makeEffects(), { kind: 'layer-effects', effects: source });
    expect(result.colorOverlay.color).not.toBe(source.colorOverlay.color);
  });

  it('leaves the layer unchanged for a group clipboard', () => {
    const target = makeEffects();
    const result = pasteLayerEffects(target, {
      kind: 'group-adjustment',
      node: { id: 'a', enabled: true, type: 'invert' },
    });
    expect(result).toBe(target);
  });
});

describe('pasteGroupAdjustments', () => {
  const exposure: AdjustmentNode = { id: 'e1', enabled: true, type: 'exposure', exposure: 1.5 };
  const invert: AdjustmentNode = { id: 'i1', enabled: false, type: 'invert' };
  const contrast: AdjustmentNode = { id: 'c1', enabled: true, type: 'contrast', contrast: 20 };

  it('replaces the stack and its switch with a full copy, under fresh ids', () => {
    const result = pasteGroupAdjustments(
      [contrast],
      true,
      { kind: 'group-adjustments', nodes: [exposure, invert], adjustmentsEnabled: false },
      allowAll,
      idFactory(),
    );
    expect(result.adjustmentsEnabled).toBe(false);
    expect(result.nodes).toEqual([
      { ...exposure, id: 'new-1' },
      { ...invert, id: 'new-2' },
    ]);
  });

  it('appends a single adjustment and keeps the existing ones', () => {
    const newId = idFactory();
    const clip: EffectsClipboard = { kind: 'group-adjustment', node: exposure };
    const once = pasteGroupAdjustments([contrast], true, clip, allowAll, newId);
    const twice = pasteGroupAdjustments(once.nodes, once.adjustmentsEnabled, clip, allowAll, newId);
    expect(twice.adjustmentsEnabled).toBe(true);
    expect(twice.nodes.map((n) => n.id)).toEqual(['c1', 'new-1', 'new-2']);
    expect(twice.nodes[2]).toEqual({ ...exposure, id: 'new-2' });
  });

  it('drops adjustments the color mode does not allow', () => {
    const noInvert = (n: AdjustmentNode): boolean => n.type !== 'invert';
    const all = pasteGroupAdjustments(
      [],
      true,
      { kind: 'group-adjustments', nodes: [exposure, invert], adjustmentsEnabled: true },
      noInvert,
      idFactory(),
    );
    expect(all.nodes.map((n) => n.type)).toEqual(['exposure']);
    const single = pasteGroupAdjustments(
      [contrast],
      true,
      { kind: 'group-adjustment', node: invert },
      noInvert,
      idFactory(),
    );
    expect(single.nodes).toEqual([contrast]);
  });
});
