import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { requireDocument, requireEngine } from '../context';
import type { NumberSpec, ParamSchema, ParamSpec, StringSpec } from '../params';
import {
  applyDesaturate,
  applyFindEdges,
  applyGenericFilter,
  applyInvert,
  type FilterDialogId,
} from '../../app/MenuBar/filter-actions';
import { filterTargetRefusal, isFilteringMask } from '../../app/MenuBar/filter-target';
import { applyPatternFill } from '../../app/MenuBar/pattern-actions';
import { applyColorLutDirect } from '../../app/MenuBar/color-lut-actions';
import { usePatternStore, type PatternDefinition } from '../../app/pattern-store';
import { filterRegistry } from '../../filters/filter-registry';
import type { FilterDefinition } from '../../filters/filter-types';
import { BUILTIN_LUT_PRESETS, getBuiltinPresets } from '../../filters/color-lut';
import { pixelWriteRefusal } from '../../layers/paint-target';
import { docScaledMax } from '../../utils/slider-ranges';
import { MAX_DOCUMENT_SIDE } from '../../utils/document-size';

export interface FilterResult {
  layer: string;
  target: 'pixels' | 'mask';
}

type FilterParam = FilterDefinition['params'][number];

/**
 * Registry entries the Filter menu does not open as a dialog. Find Edges
 * applies straight from the menu (filter.find-edges wraps that path), and
 * Tilt-Shift Blur is an on-canvas session, not a dialog.
 */
const NOT_DIALOG_FILTERS: ReadonlySet<string> = new Set(['find-edges', 'tilt-shift-blur']);

const WRITES =
  'the active layer\'s pixels, or its mask in layer-mask edit mode, within the selection when there is one';

const RESULT = 'Returns the layer id and whether its pixels or its mask were written.';

const REFUSALS = 'Refused on a text or group layer outside mask edit mode, with the text the menu toasts.';

function activeLayerId(): string {
  const id = requireDocument().activeLayerId;
  if (!id) throw new CommandError('refused', 'There is no active layer.');
  return id;
}

/** The checks the menu's shared filter path makes before it writes, as a command error. */
function requireFilterTarget(): FilterResult {
  const refusal = filterTargetRefusal();
  if (refusal) throw refusalError(refusal);
  const layer = activeLayerId();
  requireEngine();
  return { layer, target: isFilteringMask() ? 'mask' : 'pixels' };
}

function optionSpec(param: FilterParam, options: NonNullable<FilterParam['options']>): StringSpec {
  const labels = options.map((option) => option.label);
  const initial = options.find((option) => option.value === param.defaultValue);
  if (!initial || new Set(labels).size !== labels.length) {
    throw new Error(`Filter param ${param.key}: its options need unique labels and one for the default`);
  }
  return { type: 'string', enum: labels, default: initial.label, description: `"${param.label}" in the dialog: one of its toggle buttons.` };
}

function sliderSpec(param: FilterParam): NumberSpec {
  const isDocScaled = param.dynamicMax === 'doc';
  const max = isDocScaled ? docScaledMax(MAX_DOCUMENT_SIDE, MAX_DOCUMENT_SIDE, param.max) : param.max;
  const scaled = isDocScaled
    ? ` Its maximum is ${param.max}, raised to 1.5 times the document's longer side up to ${max}, as the dialog's slider is.`
    : '';
  return { type: 'number', min: param.min, max, default: param.defaultValue, description: `"${param.label}" in the dialog.${scaled}` };
}

function paramSpec(param: FilterParam): ParamSpec {
  return param.options ? optionSpec(param, param.options) : sliderSpec(param);
}

export function filterParamSchema(params: readonly FilterParam[]): ParamSchema {
  return Object.fromEntries(params.map((param) => [param.key, paramSpec(param)]));
}

function checkDocScaledMax(commandId: string, param: FilterParam, value: number): void {
  if (param.dynamicMax !== 'doc') return;
  const { width, height } = requireDocument();
  const max = docScaledMax(width, height, param.max);
  if (value <= max) return;
  throw new CommandError('invalid', `${commandId}: ${param.key} must be at most ${max} on this ${width}x${height} document, as the dialog's slider is, got ${value}`);
}

/** The numbers the dialog hands applyGenericFilter: an option's value for a toggle, the slider's value otherwise. */
export function filterValues(commandId: string, definition: FilterDefinition, params: Record<string, unknown>): Record<string, number> {
  const values: Record<string, number> = {};
  for (const param of definition.params) {
    const raw = params[param.key];
    const option = param.options?.find((candidate) => candidate.label === raw);
    if (option) {
      values[param.key] = option.value;
      continue;
    }
    if (typeof raw !== 'number') throw new Error(`${commandId}: ${param.key} was not validated`);
    checkDocScaledMax(commandId, param, raw);
    values[param.key] = raw;
  }
  return values;
}

function dialogSummary(definition: FilterDefinition): string {
  const varies = definition.randomized
    ? ' The result varies per call: the filter draws a new random seed each time it runs, as the dialog does.'
    : '';
  return `Applies Filter > ${definition.title} to ${WRITES}, as the dialog's Apply does with Preview off ("${definition.title}"). Params left out take the dialog's defaults.${varies} ${REFUSALS} ${RESULT}`;
}

function defineDialogFilter(definition: FilterDefinition): void {
  const id = `filter.${definition.id}`;
  // The dialog opens every registry filter by its registry id.
  const dialogId = definition.id as FilterDialogId;
  defineCommand({
    id,
    summary: dialogSummary(definition),
    surface: 'document',
    params: filterParamSchema(definition.params),
    run(params): FilterResult {
      requireDocument();
      const values = filterValues(id, definition, params);
      const result = requireFilterTarget();
      applyGenericFilter(dialogId, values);
      return result;
    },
  });
}

for (const definition of Object.values(filterRegistry)) {
  if (!NOT_DIALOG_FILTERS.has(definition.id)) defineDialogFilter(definition);
}

function defineInstantFilter(id: string, label: string, apply: () => void): void {
  defineCommand({
    id,
    summary: `Applies Filter > ${label} to ${WRITES}, as the menu item does with no dialog ("${label}"). ${REFUSALS} ${RESULT}`,
    surface: 'document',
    params: {},
    run(): FilterResult {
      const result = requireFilterTarget();
      apply();
      return result;
    },
  });
}

defineInstantFilter('filter.invert', 'Invert', applyInvert);
defineInstantFilter('filter.desaturate', 'Desaturate', applyDesaturate);
defineInstantFilter('filter.find-edges', 'Find Edges', applyFindEdges);

const percentSpec = (label: string) =>
  ({ type: 'number', min: 0, max: 100, default: 0, description: `"${label}" in the dialog, percent 0-100.` }) as const;

const NO_PATTERNS = 'No patterns defined. Use Edit > Define Pattern to capture the active layer as a pattern.';

function resolvePattern(ref: string | undefined): PatternDefinition {
  const { patterns, activePatternId } = usePatternStore.getState();
  if (patterns.length === 0) throw new CommandError('refused', NO_PATTERNS);
  if (ref === undefined) {
    const active = patterns.find((p) => p.id === activePatternId);
    if (!active) throw new CommandError('refused', 'No pattern is chosen: pass pattern, as the dialog\'s Apply is disabled until one is picked.');
    return active;
  }
  const byId = patterns.find((p) => p.id === ref);
  if (byId) return byId;
  const byName = patterns.filter((p) => p.name === ref);
  const [only] = byName;
  if (byName.length === 1 && only) return only;
  const known = patterns.map((p) => `${p.id} (${p.name})`).join(', ');
  if (byName.length > 1) throw new CommandError('invalid', `${byName.length} patterns are named ${JSON.stringify(ref)}: pass one of their ids: ${known}`);
  throw new CommandError('not-found', `No pattern has the id or name ${JSON.stringify(ref)}. Patterns: ${known}`);
}

function requirePixelTarget(): FilterResult {
  const doc = requireDocument();
  const refusal = pixelWriteRefusal(doc.layers.find((layer) => layer.id === doc.activeLayerId));
  if (refusal) throw refusalError(refusal);
  const layer = activeLayerId();
  requireEngine();
  return { layer, target: 'pixels' };
}

export const filterPatternFill = defineCommand({
  id: 'filter.pattern-fill',
  summary:
    'Tiles a defined pattern over the active layer\'s pixels (never its mask), within the selection when there is one, as Edit > Fill with Pattern...\'s Apply does with Preview off ("Pattern Fill"). Define patterns with Edit > Define Pattern first. Choosing a pattern makes it the dialog\'s current one, as clicking its swatch does. Refused when no pattern is defined, and on a text or group layer with the text the menu toasts. Returns the layer id and target "pixels".',
  surface: 'document',
  params: {
    pattern: {
      type: 'string',
      optional: true,
      description: 'A pattern id or exact name ("Pattern 1"). Omitted means the pattern the dialog opens with: the last one defined or picked.',
    },
    scale: { type: 'number', min: 10, max: 1000, default: 100, description: '"Scale" in the dialog, percent 10-1000.' },
    rowStagger: percentSpec('Row Stagger'),
    columnStagger: percentSpec('Column Stagger'),
    offsetX: percentSpec('Horizontal Offset'),
    offsetY: percentSpec('Vertical Offset'),
  },
  run({ pattern: ref, ...settings }): FilterResult {
    requireDocument();
    const pattern = resolvePattern(ref);
    const result = requirePixelTarget();
    if (ref !== undefined) usePatternStore.getState().setActivePattern(pattern.id);
    applyPatternFill(pattern.id, settings);
    return result;
  },
});

const LUT_PRESET_IDS = BUILTIN_LUT_PRESETS.map((preset) => preset.id);

export const filterColorLut = defineCommand({
  id: 'filter.color-lut',
  summary: `Applies one of the Color LUT dialog's built-in looks to ${WRITES}, as its Apply does with Preview off ("Color LUT"). Importing a .cube file is not offered. ${REFUSALS} ${RESULT}`,
  surface: 'document',
  params: {
    preset: {
      type: 'string',
      enum: LUT_PRESET_IDS,
      default: LUT_PRESET_IDS[0],
      description: `The preset, as the dialog lists them: ${BUILTIN_LUT_PRESETS.map((p) => `${p.id} (${p.name})`).join(', ')}.`,
    },
    intensity: { type: 'number', min: 0, max: 100, default: 100, description: '"Intensity" in the dialog, percent 0-100.' },
  },
  run({ preset: presetId, intensity }): FilterResult {
    requireDocument();
    const result = requireFilterTarget();
    const preset = getBuiltinPresets().find((p) => p.id === presetId);
    if (!preset) throw new Error(`filter.color-lut: no built-in preset ${presetId}`);
    applyColorLutDirect(preset, intensity / 100);
    return result;
  },
});
