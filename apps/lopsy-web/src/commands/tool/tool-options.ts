import { CommandError } from '../command';
import { colorHex, gradientStopsJson, parseGradientStops, parseHexColor } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { applyTextSetting } from '../../tools/text/apply-text-setting';
import { textSizeTypedMax } from '../../tools/text/text-settings';
import { setCropMode } from '../../tools/crop/crop-mode';
import { docScaledMax } from '../../utils/slider-ranges';
import { MAX_ASPECT_RATIO_TERM, MIN_ASPECT_RATIO_TERM } from '../../utils/aspect-ratio';
import type { TextSettings } from '../../tools/text/text-settings';
import type { Color, ToolId } from '../../types';

export type OptionKind = 'number' | 'boolean' | 'enum' | 'color' | 'stops';

/** One option a tool's options bar shows, and the setter it calls. */
export interface ToolOption {
  readonly kind: OptionKind;
  readonly values?: readonly string[];
  readonly min?: number;
  /** A fixed maximum, or the largest value the options bar takes for the open document. */
  readonly max?: number | ((width: number, height: number) => number);
  /** For a colour: whether "none" (no colour) is accepted. */
  readonly nullable?: boolean;
  readonly note?: string;
  read(): unknown;
  /** Takes a value already checked by `checkOption`. */
  write(value: unknown): void;
}

export interface OptionDescription {
  type: OptionKind;
  enum?: string[];
  min?: number;
  max?: number;
  note?: string;
  value: unknown;
}

const ts = () => useToolSettingsStore.getState();
const slices = () => ts().settings;

interface Range {
  min: number;
  max: ToolOption['max'];
  note?: string;
}

function num(range: Range, read: () => number, write: (value: number) => void): ToolOption {
  return { kind: 'number', ...range, read, write: (value) => write(value as number) };
}

function bool(read: () => boolean, write: (value: boolean) => void): ToolOption {
  return { kind: 'boolean', read, write: (value) => write(value as boolean) };
}

function choice<T extends string>(values: readonly T[], read: () => T, write: (value: T) => void): ToolOption {
  return { kind: 'enum', values, read, write: (value) => write(value as T) };
}

function shapeColor(read: () => Color | null, write: (value: Color | null) => void): ToolOption {
  return {
    kind: 'color',
    nullable: true,
    note: '"#rrggbb" or "#rrggbbaa", or "none" for no colour (the swatch\'s Remove button).',
    read: () => {
      const color = read();
      return color ? colorHex(color) : 'none';
    },
    write: (value) => write(value === 'none' ? null : parseHexColor('tool.set', 'color', value)),
  };
}

const SCALED = (base: number) => `the larger of ${base} and 1.5 x the document's longer side, capped at 5000`;
const docMax = (base: number): Range['max'] => (width, height) => docScaledMax(width, height, base);
const percent = (min: number): Range => ({ min, max: 100 });
const pixels = (base: number): Range => ({ min: 1, max: docMax(base), note: `Pixels, 1 to ${SCALED(base)}.` });

const brushSize = num(pixels(200), () => slices().brush.size, (v) => ts().setBrushSetting('size', v));

function symmetry(hasRadial: boolean): Record<string, ToolOption> {
  const options: Record<string, ToolOption> = {
    symmetryHorizontal: bool(() => ts().symmetryHorizontal, (v) => ts().setSymmetryHorizontal(v)),
    symmetryVertical: bool(() => ts().symmetryVertical, (v) => ts().setSymmetryVertical(v)),
  };
  if (!hasRadial) return options;
  options.symmetryRadialSegments = num(
    { min: 0, max: 32, note: 'Radial segments: 0 turns radial symmetry off; the options bar offers 2 to 32. Shared with the pencil\'s mirror toggles.' },
    () => ts().symmetryRadialSegments,
    (v) => ts().setSymmetryRadialSegments(v),
  );
  return options;
}

const ASPECT_NOTE = 'Fixed Ratio, shared by the marquees, the Crop tool and the Shape tool.';
const aspectRatio: Record<string, ToolOption> = {
  aspectRatioLocked: { ...bool(() => ts().aspectRatioLocked, (v) => ts().setAspectRatioLocked(v)), note: ASPECT_NOTE },
  aspectRatioW: num({ min: MIN_ASPECT_RATIO_TERM, max: MAX_ASPECT_RATIO_TERM, note: ASPECT_NOTE }, () => ts().aspectRatioW, (v) => ts().setAspectRatioW(v)),
  aspectRatioH: num({ min: MIN_ASPECT_RATIO_TERM, max: MAX_ASPECT_RATIO_TERM, note: ASPECT_NOTE }, () => ts().aspectRatioH, (v) => ts().setAspectRatioH(v)),
};

const marquee: Record<string, ToolOption> = {
  feather: num({ min: 0, max: 250, note: 'Pixels.' }, () => slices().marquee.feather, (v) => ts().setMarqueeSetting('feather', v)),
  ...aspectRatio,
};

/** The text options restyle the selected or edited text layer, so tool.set takes them only when there is none. */
function textOption<K extends keyof TextSettings>(key: K, option: Omit<ToolOption, 'read' | 'write'>): ToolOption {
  return {
    ...option,
    read: () => slices().text[key],
    write: (value) => applyTextSetting(key, value as TextSettings[K]),
  };
}

export const TOOL_OPTIONS: Readonly<Record<ToolId, Readonly<Record<string, ToolOption>>>> = {
  move: {},
  brush: {
    size: brushSize,
    opacity: num(percent(1), () => slices().brush.opacity, (v) => ts().setBrushSetting('opacity', v)),
    hardness: num(percent(0), () => slices().brush.hardness, (v) => ts().setBrushSetting('hardness', v)),
    fade: num({ min: 0, max: docMax(2000), note: `Pixels, 0 to ${SCALED(2000)}.` }, () => slices().brush.fade, (v) => ts().setBrushSetting('fade', v)),
    ...symmetry(true),
  },
  pencil: {
    size: num(pixels(100), () => slices().pencil.size, (v) => ts().setPencilSetting('size', v)),
    ...symmetry(false),
  },
  eraser: {
    size: num(pixels(200), () => slices().eraser.size, (v) => ts().setEraserSetting('size', v)),
    opacity: num(percent(1), () => slices().eraser.opacity, (v) => ts().setEraserSetting('opacity', v)),
  },
  fill: {
    tolerance: num({ min: 0, max: 255 }, () => slices().fill.tolerance, (v) => ts().setFillSetting('tolerance', v)),
    contiguous: bool(() => slices().fill.contiguous, (v) => ts().setFillSetting('contiguous', v)),
  },
  gradient: {
    type: choice(['linear', 'radial'], () => slices().gradient.type, (v) => ts().setGradientSetting('type', v)),
    stops: {
      kind: 'stops',
      note: 'An array of 2 to 16 { position: 0-1, color: "#rrggbb" or "#rrggbbaa" }, as the Gradient Editor holds them; sorted by position.',
      read: () => gradientStopsJson(slices().gradient.stops),
      write: (value) => ts().setGradientSetting('stops', parseGradientStops('tool.set', 'options.stops', value)),
    },
    reverse: bool(() => slices().gradient.reverse, (v) => ts().setGradientSetting('reverse', v)),
  },
  eyedropper: {},
  stamp: { size: num(pixels(200), () => slices().stamp.size, (v) => ts().setStampSetting('size', v)) },
  dodge: {
    mode: choice(['dodge', 'burn'], () => slices().dodge.mode, (v) => ts().setDodgeSetting('mode', v)),
    exposure: num(percent(1), () => slices().dodge.exposure, (v) => ts().setDodgeSetting('exposure', v)),
    size: { ...brushSize, note: `${pixels(200).note} The Brush's size, as the Dodge/Burn options bar shows it.` },
  },
  sponge: {
    mode: choice(['saturate', 'desaturate'], () => slices().sponge.mode, (v) => ts().setSpongeSetting('mode', v)),
    strength: num(percent(1), () => slices().sponge.strength, (v) => ts().setSpongeSetting('strength', v)),
    size: num(pixels(200), () => slices().sponge.size, (v) => ts().setSpongeSetting('size', v)),
  },
  smudge: {
    size: num(pixels(200), () => slices().smudge.size, (v) => ts().setSmudgeSetting('size', v)),
    strength: num(percent(0), () => slices().smudge.strength, (v) => ts().setSmudgeSetting('strength', v)),
  },
  'marquee-rect': marquee,
  'marquee-ellipse': marquee,
  lasso: {},
  'lasso-magnetic': {
    width: num({ min: 1, max: 40 }, () => slices().magneticLasso.width, (v) => ts().setMagneticLassoSetting('width', v)),
    contrast: num({ min: 1, max: 100 }, () => slices().magneticLasso.contrast, (v) => ts().setMagneticLassoSetting('contrast', v)),
    frequency: num({ min: 0, max: 200 }, () => slices().magneticLasso.frequency, (v) => ts().setMagneticLassoSetting('frequency', v)),
  },
  wand: {
    tolerance: num({ min: 0, max: 255 }, () => slices().wand.tolerance, (v) => ts().setWandSetting('tolerance', v)),
    contiguous: bool(() => slices().wand.contiguous, (v) => ts().setWandSetting('contiguous', v)),
    graduated: bool(() => slices().wand.graduated, (v) => ts().setWandSetting('graduated', v)),
  },
  'quick-select': {
    size: num({ min: 1, max: 100 }, () => slices().quickSelect.size, (v) => ts().setQuickSelectSetting('size', v)),
    tolerance: num({ min: 0, max: 255 }, () => slices().quickSelect.tolerance, (v) => ts().setQuickSelectSetting('tolerance', v)),
    edgeStrength: num(percent(0), () => slices().quickSelect.edgeStrength, (v) => ts().setQuickSelectSetting('edgeStrength', v)),
    mode: choice(['add', 'subtract'], () => slices().quickSelect.mode, (v) => ts().setQuickSelectSetting('mode', v)),
  },
  shape: {
    mode: choice(['rectangle', 'ellipse', 'polygon'], () => slices().shape.mode, (v) => ts().setShapeSetting('mode', v)),
    output: choice(['pixels', 'path'], () => slices().shape.output, (v) => ts().setShapeSetting('output', v)),
    polygonSides: num({ min: 3, max: 64 }, () => slices().shape.polygonSides, (v) => ts().setShapeSetting('polygonSides', v)),
    cornerRadius: num({ min: 0, max: 200, note: 'Pixels.' }, () => slices().shape.cornerRadius, (v) => ts().setShapeSetting('cornerRadius', v)),
    ...aspectRatio,
    fillColor: shapeColor(() => slices().shape.fillColor, (v) => ts().setShapeSetting('fillColor', v)),
    strokeColor: shapeColor(() => slices().shape.strokeColor, (v) => ts().setShapeSetting('strokeColor', v)),
    strokeWidth: num({ min: 1, max: 50, note: 'Pixels.' }, () => slices().shape.strokeWidth, (v) => ts().setShapeSetting('strokeWidth', v)),
  },
  text: {
    fontSize: textOption('fontSize', { kind: 'number', min: 1, max: textSizeTypedMax, note: `Pixels, 1 to ${SCALED(500)}.` }),
    fontStyle: textOption('fontStyle', { kind: 'enum', values: ['normal', 'italic'] }),
    align: textOption('align', { kind: 'enum', values: ['left', 'center', 'right', 'justify'] }),
    underline: textOption('underline', { kind: 'boolean' }),
    strikethrough: textOption('strikethrough', { kind: 'boolean' }),
    vertical: textOption('vertical', { kind: 'boolean' }),
  },
  crop: {
    mode: choice(['normal', 'perspective'], () => slices().crop.mode, setCropMode),
    ...aspectRatio,
  },
  path: {
    strokeWidth: num({ min: 1, max: 50, note: 'Pixels.' }, () => slices().path.strokeWidth, (v) => ts().setPathSetting('strokeWidth', v)),
  },
  spray: {
    size: num(pixels(500), () => slices().spray.size, (v) => ts().setSpraySetting('size', v)),
    density: num(percent(1), () => slices().spray.density, (v) => ts().setSpraySetting('density', v)),
    opacity: num(percent(1), () => slices().spray.opacity, (v) => ts().setSpraySetting('opacity', v)),
    softness: num(percent(0), () => slices().spray.softness, (v) => ts().setSpraySetting('softness', v)),
  },
  healing: {
    size: num(pixels(200), () => slices().healing.size, (v) => ts().setHealingSetting('size', v)),
    opacity: num(percent(1), () => slices().healing.opacity, (v) => ts().setHealingSetting('opacity', v)),
  },
};

function resolvedMax(option: ToolOption): number | undefined {
  if (typeof option.max !== 'function') return option.max;
  const { width, height } = useEditorStore.getState().document;
  return option.max(width, height);
}

export function describeOption(option: ToolOption): OptionDescription {
  const description: OptionDescription = { type: option.kind, value: option.read() };
  if (option.values) description.enum = [...option.values];
  if (option.min !== undefined) description.min = option.min;
  const max = resolvedMax(option);
  if (max !== undefined) description.max = max;
  if (option.note) description.note = option.note;
  return description;
}

export function optionValues(tool: ToolId): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, option] of Object.entries(TOOL_OPTIONS[tool])) values[name] = option.read();
  return values;
}

function invalid(commandId: string, message: string): never {
  throw new CommandError('invalid', `${commandId}: ${message}`);
}

function checkNumber(commandId: string, path: string, option: ToolOption, value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(commandId, `${path} must be a finite number, got ${JSON.stringify(value)}`);
  const max = resolvedMax(option);
  const isBelow = option.min !== undefined && value < option.min;
  const isAbove = max !== undefined && value > max;
  if (isBelow || isAbove) invalid(commandId, `${path} must be from ${option.min} to ${max} in this document, got ${value}`);
}

/** Throws `invalid` (naming `commandId`) unless `value` is what the option takes. */
export function checkOption(path: string, option: ToolOption, value: unknown, commandId = 'tool.set'): void {
  switch (option.kind) {
    case 'number':
      return checkNumber(commandId, path, option, value);
    case 'boolean':
      if (typeof value !== 'boolean') invalid(commandId, `${path} must be a boolean, got ${JSON.stringify(value)}`);
      return;
    case 'enum':
      if (typeof value !== 'string' || !option.values?.includes(value)) {
        invalid(commandId, `${path} must be one of ${(option.values ?? []).map((v) => JSON.stringify(v)).join(', ')}, got ${JSON.stringify(value)}`);
      }
      return;
    case 'color':
      if (option.nullable && value === 'none') return;
      parseHexColor(commandId, path, value);
      return;
    case 'stops':
      parseGradientStops(commandId, path, value);
      return;
    default:
      invalid(commandId, `${path} is not an option this command takes`);
  }
}

/** Why the text options cannot be set now, or null when they can. */
export function textOptionsRefusal(): string | null {
  if (useUIStore.getState().textEditing) {
    return 'Text is being edited: the text options would restyle it. Commit the text first (for example with tool.select).';
  }
  const doc = useEditorStore.getState().document;
  const active = doc.layers.find((layer) => layer.id === doc.activeLayerId);
  if (active?.type === 'text') {
    return `The active layer "${active.name}" is a text layer: the text options would restyle it. Restyle it with text.style, or select another layer first.`;
  }
  return null;
}
