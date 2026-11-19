import { describe, expect, it } from 'vitest';
import { CommandError, isCommandError, isValidCommandId } from './command';

describe('CommandError', () => {
  it('carries code, notice and name', () => {
    const error = new CommandError('refused', 'Layer is locked', { notice: 'info' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CommandError');
    expect(error.code).toBe('refused');
    expect(error.notice).toBe('info');
    expect(error.message).toBe('Layer is locked');
  });

  it('defaults notice to null', () => {
    expect(new CommandError('invalid', 'x').notice).toBeNull();
  });

  it('serialises to { name, code, message }', () => {
    const error = new CommandError('unavailable', 'No engine', { notice: 'error' });
    expect(error.toJSON()).toEqual({ name: 'CommandError', code: 'unavailable', message: 'No engine' });
    expect(JSON.parse(JSON.stringify(error))).toEqual(error.toJSON());
  });
});

describe('isCommandError', () => {
  it('accepts instances and JSON round-tripped errors', () => {
    const error = new CommandError('not-found', 'Unknown command');
    expect(isCommandError(error)).toBe(true);
    expect(isCommandError(JSON.parse(JSON.stringify(error)))).toBe(true);
  });

  it('rejects other values', () => {
    expect(isCommandError(new Error('x'))).toBe(false);
    expect(isCommandError({ name: 'CommandError', code: 'nope', message: 'x' })).toBe(false);
    expect(isCommandError({ name: 'CommandError', code: 'invalid' })).toBe(false);
    expect(isCommandError(null)).toBe(false);
    expect(isCommandError('CommandError')).toBe(false);
  });
});

describe('isValidCommandId', () => {
  it('accepts dotted lowercase ids', () => {
    for (const id of ['layer.add', 'filter.gaussian-blur', 'view.zoom.in', 'a1.b2-c3']) {
      expect(isValidCommandId(id)).toBe(true);
    }
  });

  it('rejects malformed ids', () => {
    for (const id of ['layer', 'Layer.add', 'layer.', '.add', 'layer..add', 'layer.add-', 'layer-x.add', '1layer.add', 'layer.add_x']) {
      expect(isValidCommandId(id)).toBe(false);
    }
  });
});
