import type { LayerEffects } from '../types';
import type { AdjustmentNode } from '../types/adjustment-nodes';

export type EffectKey = 'dropShadow' | 'stroke' | 'outerGlow' | 'innerGlow' | 'colorOverlay';

/**
 * What the effects drawer's Copy buttons hold. Layers and groups keep
 * separate kinds: a layer's effects only paste onto a layer and a group's
 * adjustments only onto a group.
 */
export type EffectsClipboard =
  | { readonly kind: 'layer-effects'; readonly effects: LayerEffects }
  | { readonly kind: 'layer-effect'; readonly key: EffectKey; readonly effects: LayerEffects }
  | {
      readonly kind: 'group-adjustments';
      readonly nodes: readonly AdjustmentNode[];
      readonly adjustmentsEnabled: boolean;
    }
  | { readonly kind: 'group-adjustment'; readonly node: AdjustmentNode };

export type EffectsClipboardTarget = 'layer' | 'group';

export function clipboardTarget(clip: EffectsClipboard): EffectsClipboardTarget {
  return clip.kind === 'layer-effects' || clip.kind === 'layer-effect' ? 'layer' : 'group';
}

export function canPasteOnto(
  clip: EffectsClipboard | null,
  target: EffectsClipboardTarget,
): boolean {
  return clip !== null && clipboardTarget(clip) === target;
}

/**
 * The layer's effects after a paste. A full copy replaces every effect.
 * A layer carries exactly one of each effect, so a single effect replaces
 * that kind's settings and is switched on, leaving the others untouched.
 */
export function pasteLayerEffects(target: LayerEffects, clip: EffectsClipboard): LayerEffects {
  if (clip.kind === 'layer-effects') return structuredClone(clip.effects);
  if (clip.kind !== 'layer-effect') return target;
  const pasted = structuredClone(clip.effects[clip.key]);
  return { ...target, [clip.key]: { ...pasted, enabled: true } };
}

export interface GroupAdjustmentsPaste {
  readonly nodes: AdjustmentNode[];
  readonly adjustmentsEnabled: boolean;
}

/**
 * The group's adjustment stack after a paste. A full copy replaces the
 * stack (and its on/off switch); a single adjustment is appended. Every
 * pasted node gets a fresh id so pasting twice never repeats an id.
 * Types the document's color mode does not allow are left out.
 */
export function pasteGroupAdjustments(
  current: readonly AdjustmentNode[],
  currentEnabled: boolean,
  clip: EffectsClipboard,
  isAllowed: (node: AdjustmentNode) => boolean,
  newId: () => string,
): GroupAdjustmentsPaste {
  const withFreshId = (node: AdjustmentNode): AdjustmentNode => ({ ...structuredClone(node), id: newId() });
  if (clip.kind === 'group-adjustments') {
    return {
      nodes: clip.nodes.filter(isAllowed).map(withFreshId),
      adjustmentsEnabled: clip.adjustmentsEnabled,
    };
  }
  if (clip.kind === 'group-adjustment' && isAllowed(clip.node)) {
    return { nodes: [...current, withFreshId(clip.node)], adjustmentsEnabled: currentEnabled };
  }
  return { nodes: [...current], adjustmentsEnabled: currentEnabled };
}
