import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginSystemClipboardWrite,
  completeSystemClipboardWrite,
  invalidateInternalClipboardPriority,
  isInternalClipboardNewer,
  isSystemClipboardWriteCurrent,
} from './system-clipboard-sync';

describe('system-clipboard-sync', () => {
  beforeEach(() => {
    invalidateInternalClipboardPriority();
  });

  it('prefers the internal clipboard while a write is in flight', () => {
    expect(isInternalClipboardNewer()).toBe(false);
    const seq = beginSystemClipboardWrite();
    expect(isInternalClipboardNewer()).toBe(true);
    completeSystemClipboardWrite(seq);
    expect(isInternalClipboardNewer()).toBe(false);
  });

  it('an earlier write resolving does not clear a later pending copy', () => {
    const first = beginSystemClipboardWrite();
    const second = beginSystemClipboardWrite();
    expect(isSystemClipboardWriteCurrent(first)).toBe(false);
    expect(isSystemClipboardWriteCurrent(second)).toBe(true);

    completeSystemClipboardWrite(first);
    expect(isInternalClipboardNewer()).toBe(true);

    completeSystemClipboardWrite(second);
    expect(isInternalClipboardNewer()).toBe(false);
  });

  it('a failed write keeps the internal clipboard preferred until focus leaves', () => {
    beginSystemClipboardWrite();
    expect(isInternalClipboardNewer()).toBe(true);
    invalidateInternalClipboardPriority();
    expect(isInternalClipboardNewer()).toBe(false);
  });
});
