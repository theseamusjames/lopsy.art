// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { setRecorder, recordStep } from './recording-hook';

describe('recording-hook', () => {
  it('recordStep calls the registered recorder with the step', () => {
    const spy = vi.fn();
    setRecorder(spy);
    recordStep({ type: 'filter', filter: 'invert', params: {} });
    expect(spy).toHaveBeenCalledWith({ type: 'filter', filter: 'invert', params: {} });
  });

  it('recordStep is a no-op when no recorder is set', () => {
    setRecorder(null);
    expect(() => {
      recordStep({ type: 'filter', filter: 'invert', params: {} });
    }).not.toThrow();
  });

  it('setRecorder replaces the previous recorder', () => {
    const spy1 = vi.fn();
    const spy2 = vi.fn();
    setRecorder(spy1);
    setRecorder(spy2);
    recordStep({ type: 'filter', filter: 'desaturate', params: {} });
    expect(spy1).not.toHaveBeenCalled();
    expect(spy2).toHaveBeenCalledOnce();
  });
});
