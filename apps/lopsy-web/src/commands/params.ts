import { CommandError } from './command';

export interface Point {
  x: number;
  y: number;
}

interface BaseSpec<T> {
  readonly optional?: boolean;
  readonly default?: T;
  readonly description?: string;
}

export interface NumberSpec extends BaseSpec<number> {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export interface StringSpec extends BaseSpec<string> {
  readonly type: 'string';
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface BooleanSpec extends BaseSpec<boolean> {
  readonly type: 'boolean';
}

export interface ColorSpec extends BaseSpec<string> {
  readonly type: 'color';
}

export interface PointSpec extends BaseSpec<Readonly<Point>> {
  readonly type: 'point';
  /** Bounds each coordinate. */
  readonly min?: number;
  readonly max?: number;
}

export interface ArraySpec extends BaseSpec<readonly unknown[]> {
  readonly type: 'array';
  readonly items: ParamSpec;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ObjectSpec extends BaseSpec<Readonly<Record<string, unknown>>> {
  readonly type: 'object';
  readonly fields: ParamSchema;
}

/** A JSON object whose keys and values the command checks itself, against a table it can describe. */
export interface RecordSpec extends BaseSpec<Readonly<Record<string, unknown>>> {
  readonly type: 'record';
}

export type ParamSpec =
  | NumberSpec
  | StringSpec
  | BooleanSpec
  | ColorSpec
  | PointSpec
  | ArraySpec
  | ObjectSpec
  | RecordSpec;

export type ParamSchema = Readonly<Record<string, ParamSpec>>;

export type ParamValue<S> = S extends { type: 'number' }
  ? number
  : S extends { type: 'string'; enum: readonly (infer E)[] }
    ? E
    : S extends { type: 'string' | 'color' }
      ? string
      : S extends { type: 'boolean' }
        ? boolean
        : S extends { type: 'point' }
          ? Point
          : S extends { type: 'array'; items: infer I }
            ? ParamValue<I>[]
            : S extends { type: 'object'; fields: infer F }
              ? InferParams<F>
              : S extends { type: 'record' }
                ? Record<string, unknown>
                : never;

type OmittableKeys<S> = {
  [K in keyof S]: S[K] extends { optional: true }
    ? S[K] extends { default: unknown }
      ? never
      : K
    : never;
}[keyof S];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type InferParams<S> = Simplify<
  { -readonly [K in Exclude<keyof S, OmittableKeys<S>>]: ParamValue<S[K]> } & {
    -readonly [K in OmittableKeys<S>]?: ParamValue<S[K]>;
  }
>;

export interface ParamDescription {
  type: ParamSpec['type'];
  optional?: boolean;
  default?: unknown;
  description?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  items?: ParamDescription;
  minItems?: number;
  maxItems?: number;
  fields?: Record<string, ParamDescription>;
}

interface Context {
  readonly commandId: string;
}

/** Whether `key` is `object`'s own property: a caller's key must not find what Object.prototype has. */
export function hasOwnKey(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function received(value: unknown): string {
  if (value === undefined || value === null) return String(value);
  if (typeof value === 'string') {
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `an array of ${value.length} items`;
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

function rangeText(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return ` from ${min} to ${max}`;
  if (min !== undefined) return ` >= ${min}`;
  if (max !== undefined) return ` <= ${max}`;
  return '';
}

function countText(min: number | undefined, max: number | undefined, unit: string): string {
  if (min !== undefined && max !== undefined) return ` of ${min} to ${max} ${unit}`;
  if (min !== undefined) return ` of at least ${min} ${unit}`;
  if (max !== undefined) return ` of at most ${max} ${unit}`;
  return '';
}

export function expectedText(spec: ParamSpec): string {
  switch (spec.type) {
    case 'number':
      return `${spec.integer ? 'an integer' : 'a finite number'}${rangeText(spec.min, spec.max)}`;
    case 'string':
      if (spec.enum) return `one of ${spec.enum.map((v) => JSON.stringify(v)).join(', ')}`;
      return `a string${countText(spec.minLength, spec.maxLength, 'characters')}`;
    case 'boolean':
      return 'a boolean';
    case 'color':
      return 'a colour "#rgb", "#rrggbb" or "#rrggbbaa"';
    case 'point':
      return `a point {x, y} of finite numbers${rangeText(spec.min, spec.max)}`;
    case 'array':
      return `an array${countText(spec.minItems, spec.maxItems, 'items')}`;
    case 'object':
    case 'record':
      return 'an object';
  }
}

function fail(ctx: Context, path: string, spec: ParamSpec, value: unknown): never {
  throw new CommandError(
    'invalid',
    `${ctx.commandId}: ${path} must be ${expectedText(spec)}, got ${received(value)}`,
  );
}

function outOfRange(value: number, min: number | undefined, max: number | undefined): boolean {
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

function validateNumber(ctx: Context, spec: NumberSpec, value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(ctx, path, spec, value);
  if (spec.integer && !Number.isInteger(value)) fail(ctx, path, spec, value);
  if (outOfRange(value, spec.min, spec.max)) fail(ctx, path, spec, value);
  return value;
}

function validateString(ctx: Context, spec: StringSpec, value: unknown, path: string): string {
  if (typeof value !== 'string') fail(ctx, path, spec, value);
  if (spec.enum && !spec.enum.includes(value)) fail(ctx, path, spec, value);
  if (outOfRange(value.length, spec.minLength, spec.maxLength)) fail(ctx, path, spec, value);
  return value;
}

const COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function validateColor(ctx: Context, spec: ColorSpec, value: unknown, path: string): string {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) fail(ctx, path, spec, value);
  const hex = value.slice(1).toLowerCase();
  if (hex.length !== 3) return `#${hex}`;
  return `#${[...hex].map((digit) => digit + digit).join('')}`;
}

function rejectUnknownKeys(
  ctx: Context,
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  const names = unknown.map((key) => JSON.stringify(key)).join(', ');
  const where = path ? `${path} has unknown key${unknown.length > 1 ? 's' : ''}` : `unknown param${unknown.length > 1 ? 's' : ''}`;
  const permitted = allowed.length > 0 ? `allowed: ${allowed.join(', ')}` : 'it takes none';
  throw new CommandError('invalid', `${ctx.commandId}: ${where} ${names}; ${permitted}`);
}

function validatePoint(ctx: Context, spec: PointSpec, value: unknown, path: string): Point {
  if (!isPlainObject(value)) fail(ctx, path, spec, value);
  rejectUnknownKeys(ctx, value, ['x', 'y'], path);
  for (const axis of ['x', 'y'] as const) {
    const coordinate = value[axis];
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || outOfRange(coordinate, spec.min, spec.max)) {
      fail(ctx, `${path}.${axis}`, { type: 'number', min: spec.min, max: spec.max }, coordinate);
    }
  }
  return { x: value.x as number, y: value.y as number };
}

function validateArray(ctx: Context, spec: ArraySpec, value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(ctx, path, spec, value);
  if (outOfRange(value.length, spec.minItems, spec.maxItems)) fail(ctx, path, spec, value);
  return value.map((item, index) => validateSpec(ctx, spec.items, item, `${path}[${index}]`));
}

function validateSpec(ctx: Context, spec: ParamSpec, value: unknown, path: string): unknown {
  switch (spec.type) {
    case 'number':
      return validateNumber(ctx, spec, value, path);
    case 'string':
      return validateString(ctx, spec, value, path);
    case 'boolean':
      if (typeof value !== 'boolean') fail(ctx, path, spec, value);
      return value;
    case 'color':
      return validateColor(ctx, spec, value, path);
    case 'point':
      return validatePoint(ctx, spec, value, path);
    case 'array':
      return validateArray(ctx, spec, value, path);
    case 'object':
      if (!isPlainObject(value)) fail(ctx, path, spec, value);
      return validateFields(ctx, spec.fields, value, path);
    case 'record':
      if (!isPlainObject(value)) fail(ctx, path, spec, value);
      return { ...value };
  }
}

function validateFields(
  ctx: Context,
  fields: ParamSchema,
  value: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  rejectUnknownKeys(ctx, value, Object.keys(fields), path);
  const output: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(fields)) {
    const fieldPath = path ? `${path}.${key}` : key;
    const fieldValue = hasOwnKey(value, key) ? value[key] : undefined;
    if (fieldValue !== undefined) {
      output[key] = validateSpec(ctx, spec, fieldValue, fieldPath);
    } else if (spec.default !== undefined) {
      output[key] = validateSpec(ctx, spec, spec.default, fieldPath);
    } else if (!spec.optional) {
      throw new CommandError(
        'invalid',
        `${ctx.commandId}: ${fieldPath} is required (${expectedText(spec)})`,
      );
    }
  }
  return output;
}

export function validateParams<S extends ParamSchema>(
  commandId: string,
  schema: S,
  input: unknown,
): InferParams<S> {
  const ctx: Context = { commandId };
  const value = input === undefined ? {} : input;
  if (!isPlainObject(value)) {
    throw new CommandError(
      'invalid',
      `${commandId}: params must be an object, got ${received(value)}`,
    );
  }
  // The schema is what makes this cast sound: every key it lists was validated against its spec.
  return validateFields(ctx, schema, value, '') as InferParams<S>;
}

function checkSpec(commandId: string, spec: ParamSpec, path: string): void {
  if (spec.default !== undefined) {
    try {
      validateSpec({ commandId }, spec, spec.default, `${path} (default)`);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }
  if (spec.type === 'array') checkSpec(commandId, spec.items, `${path}[]`);
  if (spec.type === 'object') checkSchema(commandId, spec.fields, path);
}

/** Catches a bad default at definition time, where it is a programmer error, not at run time. */
export function checkSchema(commandId: string, schema: ParamSchema, path = ''): void {
  for (const [key, spec] of Object.entries(schema)) {
    checkSpec(commandId, spec, path ? `${path}.${key}` : key);
  }
}

function withoutUndefined(description: ParamDescription): ParamDescription {
  const entries = Object.entries(description).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as unknown as ParamDescription;
}

function describeSpec(spec: ParamSpec): ParamDescription {
  const base: ParamDescription = {
    type: spec.type,
    optional: spec.optional,
    default: spec.default === undefined ? undefined : structuredClone(spec.default),
    description: spec.description,
  };
  switch (spec.type) {
    case 'number':
      return withoutUndefined({ ...base, min: spec.min, max: spec.max, integer: spec.integer });
    case 'point':
      return withoutUndefined({ ...base, min: spec.min, max: spec.max });
    case 'string':
      return withoutUndefined({
        ...base,
        enum: spec.enum ? [...spec.enum] : undefined,
        minLength: spec.minLength,
        maxLength: spec.maxLength,
      });
    case 'array':
      return withoutUndefined({
        ...base,
        items: describeSpec(spec.items),
        minItems: spec.minItems,
        maxItems: spec.maxItems,
      });
    case 'object':
      return withoutUndefined({ ...base, fields: describeParams(spec.fields) });
    default:
      return withoutUndefined(base);
  }
}

export function describeParams(schema: ParamSchema): Record<string, ParamDescription> {
  const output: Record<string, ParamDescription> = {};
  for (const [key, spec] of Object.entries(schema)) output[key] = describeSpec(spec);
  return output;
}
