import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { layerRefSpec, requireDocument, resolveLayer } from '../context';
import { useEditorStore } from '../../app/editor-store';
import type { EffectKey } from '../../app/effects-clipboard';
import { EFFECT_LIST, effectLabel, effectSliderLimits, type EffectSliderLimits } from '../../panels/LayerEffectsPanel/effect-list';
import { colorToHex, hexToColor } from '../../panels/LayerEffectsPanel/color-convert';
import { isGroupLayer } from '../../layers/group-utils';
import type { Color, LayerEffects } from '../../types';

type ControlKind = 'toggle' | 'edit' | 'silent';
type Unit = 'color' | 'percent' | 'pixels' | 'raw';
type Limit = (limits: EffectSliderLimits) => { min: number; max: number };

interface Control {
  readonly field: string;
  readonly kind: ControlKind;
  readonly unit: Unit;
  readonly limit?: Limit;
}

const ENABLED: Control = { field: 'enabled', kind: 'toggle', unit: 'raw' };
const COLOR: Control = { field: 'color', kind: 'edit', unit: 'color' };
const OPACITY: Control = { field: 'opacity', kind: 'edit', unit: 'percent' };

const upTo = (pick: (l: EffectSliderLimits) => number, min = 0): Limit => (l) => ({ min, max: pick(l) });
const shadowOffset: Limit = (l) => ({ min: -l.shadowOffset, max: l.shadowOffset });

/** Each form's controls in the drawer's order. Stroke position pushes no history entry in the drawer. */
const CONTROLS: Record<EffectKey, readonly Control[]> = {
  dropShadow: [
    ENABLED, COLOR,
    { field: 'offsetX', kind: 'edit', unit: 'pixels', limit: shadowOffset },
    { field: 'offsetY', kind: 'edit', unit: 'pixels', limit: shadowOffset },
    { field: 'blur', kind: 'edit', unit: 'pixels', limit: upTo((l) => l.shadowBlurMax) },
    { field: 'spread', kind: 'edit', unit: 'pixels', limit: upTo((l) => l.shadowSpreadMax) },
    OPACITY,
  ],
  stroke: [
    ENABLED, COLOR,
    { field: 'width', kind: 'edit', unit: 'pixels', limit: upTo((l) => l.strokeWidthMax, 1) },
    { field: 'position', kind: 'silent', unit: 'raw' },
  ],
  outerGlow: [
    ENABLED, COLOR,
    { field: 'size', kind: 'edit', unit: 'pixels', limit: upTo((l) => l.glowSizeMax) },
    { field: 'spread', kind: 'edit', unit: 'pixels', limit: upTo((l) => l.glowSpreadMax) },
    OPACITY,
  ],
  innerGlow: [
    ENABLED, COLOR,
    { field: 'size', kind: 'edit', unit: 'pixels', limit: upTo((l) => l.glowSizeMax) },
    { field: 'spread', kind: 'edit', unit: 'pixels', limit: upTo((l) => l.glowSpreadMax) },
    OPACITY,
  ],
  colorOverlay: [ENABLED, COLOR],
};

const enabledSpec = { type: 'boolean', optional: true, description: 'The effect\'s checkbox in the drawer ("Enable <Effect>" / "Disable <Effect>").' } as const;
const colorSpec = {
  type: 'color',
  optional: true,
  description: '"#rrggbb" (or "#rgb"), as the drawer\'s colour picker; the colour\'s alpha is kept, as the picker keeps it.',
} as const;
const opacitySpec = { type: 'number', optional: true, min: 0, max: 100, description: 'Percent, 0-100.' } as const;
const pixelSpec = (description: string, min?: number) =>
  ({ type: 'number', optional: true, ...(min === undefined ? {} : { min }), description }) as const;
const SCALED = 'the larger of 100 and 1.5 x the document\'s longer side, capped at 5000';

const glowSpec = (inner: boolean) =>
  ({
    type: 'object',
    optional: true,
    description: inner ? 'Inner Glow.' : 'Outer Glow.',
    fields: {
      enabled: enabledSpec,
      color: colorSpec,
      size: pixelSpec(`Pixels, 0 to ${SCALED}.`, 0),
      spread: pixelSpec(`Pixels, 0 to ${SCALED}.`, 0),
      opacity: opacitySpec,
    },
  }) as const;

const effectsParams = {
  layer: layerRefSpec,
  dropShadow: {
    type: 'object',
    optional: true,
    description: 'Drop Shadow.',
    fields: {
      enabled: enabledSpec,
      color: colorSpec,
      offsetX: pixelSpec(`Pixels, from minus to plus ${SCALED}; positive is right.`),
      offsetY: pixelSpec(`Pixels, from minus to plus ${SCALED}; positive is down.`),
      blur: pixelSpec(`Pixels, 0 to ${SCALED}.`, 0),
      spread: pixelSpec(`Pixels, 0 to ${SCALED}.`, 0),
      opacity: opacitySpec,
    },
  },
  stroke: {
    type: 'object',
    optional: true,
    description: 'Stroke.',
    fields: {
      enabled: enabledSpec,
      color: colorSpec,
      width: pixelSpec('Pixels, 1 to the larger of 50 and 1.5 x the document\'s longer side, capped at 5000.', 1),
      position: { type: 'string', optional: true, enum: ['outside', 'center', 'inside'] },
    },
  },
  outerGlow: glowSpec(false),
  innerGlow: glowSpec(true),
  colorOverlay: {
    type: 'object',
    optional: true,
    description: 'Color Overlay.',
    fields: { enabled: enabledSpec, color: colorSpec },
  },
} as const;

type EffectPatch = Readonly<Record<string, unknown>>;

/** A layer's effects in the drawer's units: colours as "#rrggbb", opacity in percent. */
export type EffectsResult = Record<EffectKey, Record<string, unknown>>;

function store() {
  return useEditorStore.getState();
}

function toModel(control: Control, value: unknown, current: Readonly<Record<string, unknown>>): unknown {
  if (control.unit === 'color') return hexToColor(value as string, (current.color as Color).a);
  if (control.unit === 'percent') return (value as number) / 100;
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ca = a as Color;
    const cb = b as Color;
    return ca.r === cb.r && ca.g === cb.g && ca.b === cb.b && ca.a === cb.a;
  }
  return a === b;
}

function assertInRange(key: EffectKey, control: Control, value: unknown, limits: EffectSliderLimits): void {
  if (control.unit === 'color' && (value as string).length > 7) {
    throw new CommandError('invalid', `layer.effects: ${key}.color must be "#rrggbb": the drawer's colour picker cannot set alpha`);
  }
  if (!control.limit) return;
  const { min, max } = control.limit(limits);
  const n = value as number;
  if (n < min || n > max) {
    throw new CommandError('invalid', `layer.effects: ${key}.${control.field} must be from ${min} to ${max} in this document, got ${n}`);
  }
}

function validatePatches(patches: Partial<Record<EffectKey, EffectPatch>>): void {
  const { width, height } = requireDocument();
  const limits = effectSliderLimits(width, height);
  for (const { key } of EFFECT_LIST) {
    const patch = patches[key];
    if (!patch) continue;
    for (const control of CONTROLS[key]) {
      if (patch[control.field] !== undefined) assertInRange(key, control, patch[control.field], limits);
    }
  }
}

function historyLabel(key: EffectKey, control: Control, enabled: unknown): string | null {
  if (control.kind === 'silent') return null;
  if (control.kind === 'toggle') return `${enabled ? 'Enable' : 'Disable'} ${effectLabel(key)}`;
  return `Edit ${effectLabel(key)}`;
}

function currentEffect(layerId: string, key: EffectKey): Readonly<Record<string, unknown>> {
  const layer = store().document.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Layer ${layerId} vanished during layer.effects`);
  return layer.effects[key] as unknown as Readonly<Record<string, unknown>>;
}

/** One committed change of one drawer control: its history entry, then the change. */
function applyControl(layerId: string, key: EffectKey, control: Control, value: unknown): void {
  const current = currentEffect(layerId, key);
  const next = toModel(control, value, current);
  if (sameValue(next, current[control.field])) return;
  const label = historyLabel(key, control, next);
  if (label) store().pushHistoryMetadata(label);
  const effect = { ...current, [control.field]: next } as unknown as LayerEffects[EffectKey];
  store().updateLayerEffects(layerId, { [key]: effect }, true);
}

function applyPatches(layerId: string, patches: Partial<Record<EffectKey, EffectPatch>>): void {
  for (const { key } of EFFECT_LIST) {
    const patch = patches[key];
    if (!patch) continue;
    for (const control of CONTROLS[key]) {
      if (patch[control.field] !== undefined) applyControl(layerId, key, control, patch[control.field]);
    }
  }
}

function inDrawerUnits(effect: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...effect };
  if (effect.color) out.color = colorToHex(effect.color as Color);
  if (typeof effect.opacity === 'number') out.opacity = Math.round(effect.opacity * 10000) / 100;
  return out;
}

export function effectsResult(effects: LayerEffects): EffectsResult {
  const result = {} as EffectsResult;
  for (const { key } of EFFECT_LIST) {
    result[key] = inDrawerUnits(effects[key] as unknown as Readonly<Record<string, unknown>>);
  }
  return result;
}

export const layerEffects = defineCommand({
  id: 'layer.effects',
  summary:
    'Changes a raster or text layer\'s effects (drop shadow, stroke, outer glow, inner glow, colour overlay) as the Layer Effects drawer does: fields left out keep their values, and each changed control is one history step, as changing them one after another in the drawer is, in the drawer\'s order ("Enable <Effect>" / "Disable <Effect>" for the checkbox, "Edit <Effect>" for a colour or slider; a stroke position change adds none, as in the drawer). Returns the layer\'s effects after.',
  surface: 'document',
  params: effectsParams,
  run({ layer: ref, ...patches }): EffectsResult {
    requireDocument();
    const layer = resolveLayer(ref);
    if (EFFECT_LIST.every(({ key }) => patches[key] === undefined)) {
      throw new CommandError('invalid', `layer.effects: pass at least one of ${EFFECT_LIST.map((e) => e.key).join(', ')}`);
    }
    if (isGroupLayer(layer)) {
      throw new CommandError('refused', `"${layer.name}" is a group: groups have no layer effects (their effects button opens the Adjustments drawer).`);
    }
    validatePatches(patches);
    applyPatches(layer.id, patches);
    return effectsResult(currentLayerEffects(layer.id));
  },
});

function currentLayerEffects(layerId: string): LayerEffects {
  const layer = store().document.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Layer ${layerId} vanished during layer.effects`);
  return layer.effects;
}
