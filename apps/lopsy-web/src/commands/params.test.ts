import { describe, expect, expectTypeOf, it } from 'vitest';
import { CommandError } from './command';
import {
  checkSchema,
  describeParams,
  validateParams,
  type InferParams,
  type ParamSchema,
  type Point,
} from './params';

function invalidMessage(schema: ParamSchema, input: unknown): string {
  try {
    validateParams('test.cmd', schema, input);
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe('invalid');
    return (error as CommandError).message;
  }
  throw new Error('expected validation to fail');
}

describe('validateParams: number', () => {
  const schema = { radius: { type: 'number', min: 0, max: 100 } } as const;
  const integer = { count: { type: 'number', integer: true } } as const;

  it('accepts a number in range', () => {
    expect(validateParams('test.cmd', schema, { radius: 12.5 })).toEqual({ radius: 12.5 });
  });

  it('rejects strings, NaN and Infinity', () => {
    expect(invalidMessage(schema, { radius: '12' })).toBe(
      'test.cmd: radius must be a finite number from 0 to 100, got "12"',
    );
    expect(invalidMessage(schema, { radius: Number.NaN })).toContain('got NaN');
    expect(invalidMessage(schema, { radius: Infinity })).toContain('got Infinity');
  });

  it('rejects out of range values', () => {
    expect(invalidMessage(schema, { radius: -1 })).toContain('got -1');
    expect(invalidMessage(schema, { radius: 101 })).toContain('got 101');
  });

  it('enforces integer', () => {
    expect(validateParams('test.cmd', integer, { count: 3 })).toEqual({ count: 3 });
    expect(invalidMessage(integer, { count: 1.5 })).toBe(
      'test.cmd: count must be an integer, got 1.5',
    );
  });
});

describe('validateParams: string', () => {
  const schema = {
    mode: { type: 'string', enum: ['normal', 'multiply'] },
    name: { type: 'string', minLength: 1, maxLength: 4, optional: true },
  } as const;

  it('accepts enum members and lengths in range', () => {
    expect(validateParams('test.cmd', schema, { mode: 'multiply', name: 'abcd' })).toEqual({
      mode: 'multiply',
      name: 'abcd',
    });
  });

  it('rejects values outside the enum', () => {
    expect(invalidMessage(schema, { mode: 'screen' })).toBe(
      'test.cmd: mode must be one of "normal", "multiply", got "screen"',
    );
  });

  it('rejects lengths out of range and non-strings', () => {
    expect(invalidMessage(schema, { mode: 'normal', name: '' })).toContain(
      'name must be a string of 1 to 4 characters',
    );
    expect(invalidMessage(schema, { mode: 'normal', name: 'abcde' })).toContain('got "abcde"');
    expect(invalidMessage(schema, { mode: 4 })).toContain('got 4');
  });
});

describe('validateParams: boolean', () => {
  const schema = { visible: { type: 'boolean' } } as const;

  it('accepts booleans and rejects everything else', () => {
    expect(validateParams('test.cmd', schema, { visible: false })).toEqual({ visible: false });
    expect(invalidMessage(schema, { visible: 'true' })).toBe(
      'test.cmd: visible must be a boolean, got "true"',
    );
    expect(invalidMessage(schema, { visible: null })).toContain('got null');
  });
});

describe('validateParams: color', () => {
  const schema = { color: { type: 'color' } } as const;
  const valid = (color: string): unknown => validateParams('test.cmd', schema, { color }).color;

  it('normalises to lowercase 6 or 8 digit form', () => {
    expect(valid('#ABC')).toBe('#aabbcc');
    expect(valid('#FF8800')).toBe('#ff8800');
    expect(valid('#FF880080')).toBe('#ff880080');
  });

  it('rejects other forms', () => {
    for (const bad of ['red', 'ff8800', '#ff88', '#ggg', '#ff88001', 'rgb(0,0,0)']) {
      expect(invalidMessage(schema, { color: bad })).toContain('color must be a colour');
    }
    expect(invalidMessage(schema, { color: 0xff8800 })).toContain('got 16746496');
  });
});

describe('validateParams: point', () => {
  const schema = { at: { type: 'point' } } as const;

  it('accepts finite x and y and copies them', () => {
    const input = { at: { x: 1, y: -2.5 } };
    const output = validateParams('test.cmd', schema, input);
    expect(output).toEqual({ at: { x: 1, y: -2.5 } });
    expect(output.at).not.toBe(input.at);
  });

  it('rejects missing or non-finite coordinates and extra keys', () => {
    expect(invalidMessage(schema, { at: { x: 1 } })).toBe(
      'test.cmd: at.y must be a finite number, got undefined',
    );
    expect(invalidMessage(schema, { at: { x: Number.NaN, y: 0 } })).toContain('at.x');
    expect(invalidMessage(schema, { at: [1, 2] })).toContain('got an array of 2 items');
    expect(invalidMessage(schema, { at: { x: 1, y: 2, z: 3 } })).toContain('at has unknown key "z"');
  });
});

describe('validateParams: array and object', () => {
  const schema = {
    points: { type: 'array', items: { type: 'point' }, minItems: 2, maxItems: 3 },
    options: {
      type: 'object',
      fields: { size: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } } },
    },
  } as const;
  const options = { size: 1, tags: [] };

  it('accepts nested values', () => {
    const input = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], options: { size: 2, tags: ['a'] } };
    expect(validateParams('test.cmd', schema, input)).toEqual(input);
  });

  it('qualifies nested paths in messages', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: '12', y: 0 }];
    expect(invalidMessage(schema, { points, options })).toBe(
      'test.cmd: points[2].x must be a finite number, got "12"',
    );
    expect(
      invalidMessage(schema, { points: points.slice(0, 2), options: { size: 1, tags: [3] } }),
    ).toBe('test.cmd: options.tags[0] must be a string, got 3');
  });

  it('enforces item counts', () => {
    expect(invalidMessage(schema, { points: [{ x: 0, y: 0 }], options })).toBe(
      'test.cmd: points must be an array of 2 to 3 items, got an array of 1 items',
    );
  });

  it('rejects unknown keys in nested objects and missing nested fields', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(invalidMessage(schema, { points, options: { ...options, sise: 1 } })).toBe(
      'test.cmd: options has unknown key "sise"; allowed: size, tags',
    );
    expect(invalidMessage(schema, { points, options: { tags: [] } })).toBe(
      'test.cmd: options.size is required (a finite number)',
    );
  });
});

describe('validateParams: top level', () => {
  const schema = {
    radius: { type: 'number' },
    color: { type: 'color', default: '#FFF' },
    label: { type: 'string', optional: true },
  } as const;

  it('applies and normalises defaults and leaves optional params absent', () => {
    const output = validateParams('test.cmd', schema, { radius: 2 });
    expect(output).toEqual({ radius: 2, color: '#ffffff' });
    expect('label' in output).toBe(false);
  });

  it('treats undefined input as {} and names missing params', () => {
    expect(validateParams('test.cmd', {}, undefined)).toEqual({});
    expect(invalidMessage(schema, undefined)).toBe(
      'test.cmd: radius is required (a finite number)',
    );
  });

  it('treats an explicitly undefined value as missing', () => {
    expect(validateParams('test.cmd', schema, { radius: 1, color: undefined })).toEqual({
      radius: 1,
      color: '#ffffff',
    });
  });

  it('rejects unknown keys and names the allowed ones', () => {
    expect(invalidMessage(schema, { radius: 1, radus: 2 })).toBe(
      'test.cmd: unknown param "radus"; allowed: radius, color, label',
    );
    expect(invalidMessage({}, { a: 1, b: 2 })).toBe(
      'test.cmd: unknown params "a", "b"; it takes none',
    );
  });

  it('rejects non-object input', () => {
    expect(invalidMessage(schema, [1])).toBe(
      'test.cmd: params must be an object, got an array of 1 items',
    );
    expect(invalidMessage(schema, null)).toContain('got null');
  });

  it('never mutates the input and only returns schema keys', () => {
    const nested = { type: 'object', fields: { list: { type: 'array', items: { type: 'color' } } } } as const;
    const input = { radius: 1, color: '#ABC', nested: { list: ['#DEF'] } };
    const frozen = JSON.parse(JSON.stringify(input)) as typeof input;
    const output = validateParams('test.cmd', { ...schema, nested }, input);
    expect(input).toEqual(frozen);
    expect(output.nested.list).not.toBe(input.nested.list);
    expect(Object.keys(output).sort()).toEqual(['color', 'nested', 'radius']);
  });

  it('does not share default arrays between runs', () => {
    const withList = { list: { type: 'array', items: { type: 'number' }, default: [1] } } as const;
    const first = validateParams('test.cmd', withList, {});
    first.list.push(2);
    expect(validateParams('test.cmd', withList, {}).list).toEqual([1]);
  });
});

describe('checkSchema', () => {
  it('throws a plain Error for a default that fails its spec', () => {
    const bad = { mode: { type: 'string', enum: ['a'], default: 'b' } } as const;
    expect(() => checkSchema('test.cmd', bad)).toThrowError(/mode \(default\) must be one of "a"/);
    try {
      checkSchema('test.cmd', bad);
    } catch (error) {
      expect(error).not.toBeInstanceOf(CommandError);
    }
  });

  it('checks nested defaults', () => {
    const bad = {
      o: { type: 'object', fields: { n: { type: 'number', min: 0, default: -1 } } },
    } as const;
    expect(() => checkSchema('test.cmd', bad)).toThrowError(/o\.n \(default\)/);
    expect(() => checkSchema('test.cmd', { n: { type: 'number', default: 0 } })).not.toThrow();
  });
});

describe('describeParams', () => {
  it('produces a JSON round-trippable description', () => {
    const schema = {
      radius: { type: 'number', min: 0, description: 'Blur radius in pixels' },
      mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
      points: { type: 'array', items: { type: 'point' }, minItems: 1 },
      opts: { type: 'object', optional: true, fields: { on: { type: 'boolean' } } },
    } as const;
    const description = describeParams(schema);
    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
    expect(description).toEqual({
      radius: { type: 'number', min: 0, description: 'Blur radius in pixels' },
      mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
      points: { type: 'array', items: { type: 'point' }, minItems: 1 },
      opts: { type: 'object', optional: true, fields: { on: { type: 'boolean' } } },
    });
  });
});

describe('InferParams', () => {
  it('infers value types, optional keys and defaulted keys', () => {
    const schema = {
      radius: { type: 'number' },
      mode: { type: 'string', enum: ['normal', 'multiply'] },
      name: { type: 'string', optional: true },
      color: { type: 'color', optional: true, default: '#000' },
      at: { type: 'point' },
      flags: { type: 'array', items: { type: 'boolean' } },
      nested: { type: 'object', fields: { size: { type: 'number', optional: true } } },
    } as const;
    expectTypeOf<InferParams<typeof schema>>().toEqualTypeOf<{
      radius: number;
      mode: 'normal' | 'multiply';
      name?: string;
      color: string;
      at: Point;
      flags: boolean[];
      nested: { size?: number };
    }>();
    expectTypeOf(validateParams<typeof schema>).returns.toEqualTypeOf<
      InferParams<typeof schema>
    >();
  });

  it('infers an empty object for an empty schema', () => {
    expectTypeOf<InferParams<{}>>().toEqualTypeOf<{}>();
  });
});
