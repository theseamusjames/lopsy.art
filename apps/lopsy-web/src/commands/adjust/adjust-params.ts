import { CommandError } from '../command';
import { gradientStopsJson, parseGradientStops } from '../context';
import { normalizePoints, type CurvePoint, type Curves } from '../../filters/curves';
import type { Levels, LevelsChannel } from '../../filters/levels';
import type { AdjustmentNode, AdjustmentNodeType, ColorGradeWheel } from '../../types/adjustment-nodes';

/** Checks a value for one node param and returns what the store holds for it; `current` is the node before the change. */
type ParamCheck = (path: string, value: unknown, current: Readonly<Record<string, unknown>>) => unknown;

function fail(path: string, expected: string, value: unknown): never {
  throw new CommandError('invalid', `adjust.set: ${path} must be ${expected}, got ${JSON.stringify(value) ?? 'undefined'}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkNumber(path: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `a number from ${min} to ${max}`, value);
  }
  return value;
}

function rejectExtraKeys(path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined) {
    throw new CommandError('invalid', `adjust.set: ${path} has unknown key ${JSON.stringify(extra)}; allowed: ${allowed.join(', ')}`);
  }
}

const num = (min: number, max: number): ParamCheck => (path, value) => checkNumber(path, value, min, max);

const bool: ParamCheck = (path, value) => (typeof value === 'boolean' ? value : fail(path, 'a boolean', value));

const oneOf = (values: readonly string[]): ParamCheck => (path, value) =>
  typeof value === 'string' && values.includes(value) ? value : fail(path, `one of ${values.map((v) => JSON.stringify(v)).join(', ')}`, value);

/** Color Balance: [cyan-red, magenta-green, yellow-blue], each -100 to 100. */
const triple: ParamCheck = (path, value) => {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'an array of 3 numbers from -100 to 100', value);
  return value.map((v: unknown, i) => checkNumber(`${path}[${i}]`, v, -100, 100));
};

const WHEEL_RANGES: Record<keyof ColorGradeWheel, [number, number]> = {
  hue: [0, 360],
  saturation: [0, 100],
  luminance: [-100, 100],
};

/** A Color Grading wheel: any of hue, saturation, luminance, merged into the wheel as the panel does. */
const wheel = (key: string): ParamCheck => (path, value, current) => {
  if (!isRecord(value)) fail(path, 'an object { hue?, saturation?, luminance? }', value);
  rejectExtraKeys(path, value, Object.keys(WHEEL_RANGES));
  const next: Record<string, unknown> = { ...(current[key] as ColorGradeWheel) };
  for (const [field, [min, max]] of Object.entries(WHEEL_RANGES)) {
    if (value[field] !== undefined) next[field] = checkNumber(`${path}.${field}`, value[field], min, max);
  }
  return next;
};

const CHANNELS = ['rgb', 'r', 'g', 'b'] as const;

function curvePoints(path: string, value: unknown): CurvePoint[] {
  if (!Array.isArray(value) || value.length < 2) fail(path, 'an array of at least 2 points { x: 0-1, y: 0-1 }', value);
  const points = value.map((point: unknown, i) => {
    const at = `${path}[${i}]`;
    if (!isRecord(point)) fail(at, 'a point { x, y }', point);
    rejectExtraKeys(at, point, ['x', 'y']);
    return { x: checkNumber(`${at}.x`, point.x, 0, 1), y: checkNumber(`${at}.y`, point.y, 0, 1) };
  });
  return normalizePoints(points);
}

/** Curves: any of rgb, r, g, b as point lists; normalised as the curve editor normalises them, other channels kept. */
const curves: ParamCheck = (path, value, current) => {
  if (!isRecord(value)) fail(path, 'an object { rgb?, r?, g?, b? } of point lists', value);
  rejectExtraKeys(path, value, CHANNELS);
  const next: Record<string, unknown> = { ...(current.curves as Curves) };
  for (const channel of CHANNELS) {
    if (value[channel] !== undefined) next[channel] = curvePoints(`${path}.${channel}`, value[channel]);
  }
  return next;
};

const LEVELS_RANGES: Record<keyof LevelsChannel, [number, number]> = {
  inputBlack: [0, 1],
  inputWhite: [0, 1],
  gamma: [0.1, 10],
  outputBlack: [0, 1],
  outputWhite: [0, 1],
};

function levelsChannel(path: string, value: unknown, base: LevelsChannel): LevelsChannel {
  if (!isRecord(value)) fail(path, 'an object of inputBlack, inputWhite, gamma, outputBlack, outputWhite', value);
  rejectExtraKeys(path, value, Object.keys(LEVELS_RANGES));
  const next = { ...base };
  for (const [field, [min, max]] of Object.entries(LEVELS_RANGES) as [keyof LevelsChannel, [number, number]][]) {
    if (value[field] !== undefined) next[field] = checkNumber(`${path}.${field}`, value[field], min, max);
  }
  if (next.inputBlack >= next.inputWhite) fail(`${path}.inputBlack`, `below inputWhite (${next.inputWhite})`, next.inputBlack);
  if (next.outputBlack > next.outputWhite) fail(`${path}.outputBlack`, `at most outputWhite (${next.outputWhite})`, next.outputBlack);
  return next;
}

/** Levels: any of rgb, r, g, b, each a partial channel merged into the current one. */
const levels: ParamCheck = (path, value, current) => {
  if (!isRecord(value)) fail(path, 'an object { rgb?, r?, g?, b? } of levels channels', value);
  rejectExtraKeys(path, value, CHANNELS);
  const base = current.levels as Levels;
  const next: Record<string, unknown> = { ...base };
  for (const channel of CHANNELS) {
    if (value[channel] !== undefined) next[channel] = levelsChannel(`${path}.${channel}`, value[channel], base[channel]);
  }
  return next;
};

const HEX6 = /^#[0-9a-f]{6}$/i;

/** Photo Filter's colour input: "#rrggbb", stored as { r, g, b }. */
const rgbHex: ParamCheck = (path, value) => {
  if (typeof value !== 'string' || !HEX6.test(value)) fail(path, 'a colour "#rrggbb"', value);
  return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) };
};

const stops: ParamCheck = (path, value) => parseGradientStops('adjust.set', path, value);

const BW = num(-200, 300);
const MIX = num(-200, 200);
const PM100 = num(-100, 100);

/** Each node type's params in the order the panel shows their controls, with the ranges its controls take. */
export const NODE_PARAMS: Readonly<Record<AdjustmentNodeType, Readonly<Record<string, ParamCheck>>>> = {
  exposure: { exposure: num(-5, 5) },
  contrast: { contrast: PM100 },
  'highlights-shadows': { highlights: PM100, shadows: PM100, whites: PM100, blacks: PM100 },
  saturation: { saturation: num(-100, 200), vibrance: num(-100, 200) },
  vignette: { vignette: num(0, 100) },
  curves: { curves },
  levels: { levels },
  'hue-saturation': { hue: num(-180, 180), saturation: PM100, lightness: PM100 },
  'color-balance': { shadowsCMY: triple, midtonesCMY: triple, highlightsCMY: triple },
  'color-grading': {
    shadows: wheel('shadows'), midtones: wheel('midtones'), highlights: wheel('highlights'), global: wheel('global'),
    blending: num(0, 100), balance: PM100,
  },
  invert: {},
  'black-white': { reds: BW, yellows: BW, greens: BW, cyans: BW, blues: BW, magentas: BW },
  'photo-filter': { color: rgbHex, density: num(0, 100), preserveLuminosity: bool },
  'channel-mixer': { outputChannel: oneOf(['red', 'green', 'blue']), red: MIX, green: MIX, blue: MIX, constant: MIX },
  'gradient-map': { stops },
};

/** The params patch for `node` in the store's shape, in panel order; throws `invalid` for an unknown or bad param. */
export function checkNodeParams(node: AdjustmentNode, params: Record<string, unknown>): [string, unknown][] {
  const table = NODE_PARAMS[node.type];
  const names = Object.keys(table);
  const unknown = Object.keys(params).find((key) => !(key in table));
  if (unknown !== undefined) {
    const valid = names.length > 0 ? `valid params for ${node.type}: ${names.join(', ')}` : `${node.type} has no params`;
    throw new CommandError('invalid', `adjust.set: unknown param ${JSON.stringify(unknown)}; ${valid}`);
  }
  if (Object.keys(params).length === 0) throw new CommandError('invalid', `adjust.set: params is empty; valid params for ${node.type}: ${names.join(', ')}`);
  const current = node as unknown as Readonly<Record<string, unknown>>;
  return names
    .filter((name) => params[name] !== undefined)
    .map((name) => [name, (table[name] as ParamCheck)(`params.${name}`, params[name], current)]);
}

/** A node's params as commands return them: gradient stops and the photo filter colour as hex. */
export function nodeParamsJson(node: AdjustmentNode): Record<string, unknown> {
  const { id: _id, type: _type, enabled: _enabled, ...params } = node as AdjustmentNode & Record<string, unknown>;
  if (node.type === 'gradient-map') return { stops: gradientStopsJson(node.stops) };
  if (node.type === 'photo-filter') {
    const { r, g, b } = node.color;
    return { ...params, color: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` };
  }
  return JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
}
