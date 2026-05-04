/**
 * Utilities for working with AdjustmentNode arrays:
 * - Migration from legacy flat ImageAdjustments
 * - Conversion to flat ImageAdjustments for the engine bridge
 * - Default node factory
 */

import type { AdjustmentNode, AdjustmentNodeType } from '../types/adjustment-nodes';
import type { ImageAdjustments } from './image-adjustments';
import { DEFAULT_ADJUSTMENTS } from './image-adjustments';
import { IDENTITY_CURVES, isIdentityCurves } from './curves';
import { IDENTITY_LEVELS, isIdentityLevels } from './levels';

/** Convert a legacy flat ImageAdjustments object to an AdjustmentNode array.
 *  Skips nodes whose values are all at their defaults to keep the list lean.
 */
export function migrateFromLegacy(adj: ImageAdjustments): AdjustmentNode[] {
  const nodes: AdjustmentNode[] = [];

  if (adj.exposure !== 0) {
    nodes.push({ id: crypto.randomUUID(), enabled: true, type: 'exposure', exposure: adj.exposure });
  }
  if (adj.contrast !== 0) {
    nodes.push({ id: crypto.randomUUID(), enabled: true, type: 'contrast', contrast: adj.contrast });
  }
  if (adj.highlights !== 0 || adj.shadows !== 0 || adj.whites !== 0 || adj.blacks !== 0) {
    nodes.push({
      id: crypto.randomUUID(), enabled: true,
      type: 'highlights-shadows',
      highlights: adj.highlights,
      shadows: adj.shadows,
      whites: adj.whites,
      blacks: adj.blacks,
    });
  }
  if (adj.saturation !== 0 || adj.vibrance !== 0) {
    nodes.push({
      id: crypto.randomUUID(), enabled: true,
      type: 'saturation',
      saturation: adj.saturation,
      vibrance: adj.vibrance,
    });
  }
  if (adj.temperature !== 0 || adj.tint !== 0) {
    nodes.push({
      id: crypto.randomUUID(), enabled: true,
      type: 'temperature-tint',
      temperature: adj.temperature,
      tint: adj.tint,
    });
  }
  if (adj.vignette !== 0) {
    nodes.push({ id: crypto.randomUUID(), enabled: true, type: 'vignette', vignette: adj.vignette });
  }
  if (adj.levels && !isIdentityLevels(adj.levels)) {
    nodes.push({ id: crypto.randomUUID(), enabled: true, type: 'levels', levels: adj.levels });
  }
  if (adj.curves && !isIdentityCurves(adj.curves)) {
    nodes.push({ id: crypto.randomUUID(), enabled: true, type: 'curves', curves: adj.curves });
  }

  return nodes;
}

/** Flatten an AdjustmentNode[] down to a single ImageAdjustments that the
 *  existing engine bridge (setGroupAdjustments etc.) can consume.
 *
 *  For additive scalar fields (exposure, contrast, etc.) we accumulate all
 *  enabled nodes of the matching type. For non-additive ops (curves, levels)
 *  we use the last enabled node — matching how the legacy aggregation worked.
 */
export function nodesToLegacyAdjustments(nodes: readonly AdjustmentNode[]): ImageAdjustments {
  const result: ImageAdjustments = { ...DEFAULT_ADJUSTMENTS };

  for (const node of nodes) {
    if (!node.enabled) continue;
    switch (node.type) {
      case 'exposure':
        result.exposure += node.exposure;
        break;
      case 'contrast':
        result.contrast += node.contrast;
        break;
      case 'highlights-shadows':
        result.highlights += node.highlights;
        result.shadows += node.shadows;
        result.whites += node.whites;
        result.blacks += node.blacks;
        break;
      case 'saturation':
        result.saturation += node.saturation;
        result.vibrance += node.vibrance;
        break;
      case 'temperature-tint':
        result.temperature += node.temperature;
        result.tint += node.tint;
        break;
      case 'vignette':
        result.vignette += node.vignette;
        break;
      case 'curves':
        result.curves = node.curves;
        break;
      case 'levels':
        result.levels = node.levels;
        break;
      case 'hue-saturation':
        result.hueSatHue = (result.hueSatHue ?? 0) + node.hue;
        result.hueSatSaturation = (result.hueSatSaturation ?? 0) + node.saturation;
        result.hueSatLightness = (result.hueSatLightness ?? 0) + node.lightness;
        break;
      case 'color-balance': {
        const s = result.colorBalanceShadows ?? [0, 0, 0];
        const m = result.colorBalanceMidtones ?? [0, 0, 0];
        const h = result.colorBalanceHighlights ?? [0, 0, 0];
        result.colorBalanceShadows    = [s[0] + node.shadowsCMY[0],    s[1] + node.shadowsCMY[1],    s[2] + node.shadowsCMY[2]];
        result.colorBalanceMidtones   = [m[0] + node.midtonesCMY[0],   m[1] + node.midtonesCMY[1],   m[2] + node.midtonesCMY[2]];
        result.colorBalanceHighlights = [h[0] + node.highlightsCMY[0], h[1] + node.highlightsCMY[1], h[2] + node.highlightsCMY[2]];
        break;
      }
      case 'photo-filter':
        result.photoFilterColor = node.color;
        result.photoFilterDensity = node.density / 100;
        result.photoFilterPreserveLuminosity = node.preserveLuminosity;
        break;
      case 'black-white':
        result.bwEnabled  = true;
        result.bwReds     = node.reds;
        result.bwYellows  = node.yellows;
        result.bwGreens   = node.greens;
        result.bwCyans    = node.cyans;
        result.bwBlues    = node.blues;
        result.bwMagentas = node.magentas;
        break;
      case 'channel-mixer': {
        result.channelMixerEnabled = true;
        const identity: [number, number, number, number] = [100, 0, 0, 0];
        const prev = {
          r: result.channelMixerR ?? identity,
          g: result.channelMixerG ?? [0, 100, 0, 0] as [number, number, number, number],
          b: result.channelMixerB ?? [0, 0, 100, 0] as [number, number, number, number],
        };
        if (node.outputChannel === 'red')   result.channelMixerR = [node.red, node.green, node.blue, node.constant];
        if (node.outputChannel === 'green') result.channelMixerG = [node.red, node.green, node.blue, node.constant];
        if (node.outputChannel === 'blue')  result.channelMixerB = [node.red, node.green, node.blue, node.constant];
        if (!result.channelMixerR) result.channelMixerR = prev.r;
        if (!result.channelMixerG) result.channelMixerG = prev.g;
        if (!result.channelMixerB) result.channelMixerB = prev.b;
        break;
      }
      case 'invert':
        result.invert = !result.invert;
        break;
      case 'gradient-map':
        result.gradientMapStops = node.stops;
        break;
    }
  }

  return result;
}

/** Returns true if any node in the list is enabled and non-default. */
export function hasActiveNodes(nodes: readonly AdjustmentNode[]): boolean {
  return nodes.some((n) => n.enabled);
}

/** Create a new node with sensible defaults for the given type. */
export function createDefaultNode(type: AdjustmentNodeType): AdjustmentNode {
  const id = crypto.randomUUID();
  switch (type) {
    case 'exposure':
      return { id, enabled: true, type: 'exposure', exposure: 0 };
    case 'contrast':
      return { id, enabled: true, type: 'contrast', contrast: 0 };
    case 'highlights-shadows':
      return { id, enabled: true, type: 'highlights-shadows', highlights: 0, shadows: 0, whites: 0, blacks: 0 };
    case 'saturation':
      return { id, enabled: true, type: 'saturation', saturation: 0, vibrance: 0 };
    case 'temperature-tint':
      return { id, enabled: true, type: 'temperature-tint', temperature: 0, tint: 0 };
    case 'vignette':
      return { id, enabled: true, type: 'vignette', vignette: 0 };
    case 'curves':
      return { id, enabled: true, type: 'curves', curves: IDENTITY_CURVES };
    case 'levels':
      return { id, enabled: true, type: 'levels', levels: IDENTITY_LEVELS };
    case 'color-balance':
      return { id, enabled: true, type: 'color-balance', shadowsCMY: [0, 0, 0], midtonesCMY: [0, 0, 0], highlightsCMY: [0, 0, 0] };
    case 'gradient-map':
      return { id, enabled: true, type: 'gradient-map', stops: [{ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } }] };
    case 'black-white':
      return { id, enabled: true, type: 'black-white', reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
    case 'photo-filter':
      return { id, enabled: true, type: 'photo-filter', color: { r: 255, g: 160, b: 0 }, density: 25, preserveLuminosity: true };
    case 'channel-mixer':
      return { id, enabled: true, type: 'channel-mixer', outputChannel: 'red', red: 100, green: 0, blue: 0, constant: 0 };
    case 'invert':
      return { id, enabled: true, type: 'invert' };
    case 'hue-saturation':
      return { id, enabled: true, type: 'hue-saturation', hue: 0, saturation: 0, lightness: 0 };
  }
}

/** Human-readable label for each node type, shown in the Add menu and node headers. */
export const ADJUSTMENT_NODE_LABELS: Record<AdjustmentNodeType, string> = {
  'exposure': 'Exposure',
  'contrast': 'Contrast',
  'highlights-shadows': 'Highlights & Shadows',
  'saturation': 'Saturation & Vibrance',
  'temperature-tint': 'Temperature & Tint',
  'vignette': 'Vignette',
  'curves': 'Curves',
  'levels': 'Levels',
  'color-balance': 'Color Balance',
  'gradient-map': 'Gradient Map',
  'black-white': 'Black & White',
  'photo-filter': 'Photo Filter',
  'channel-mixer': 'Channel Mixer',
  'invert': 'Invert',
  'hue-saturation': 'Hue / Saturation',
};
