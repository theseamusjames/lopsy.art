import { describe, expect, it } from 'vitest';
import type { LibrarySession } from '@lopsy/photos-core/library/types';
import { LibraryLockLostError, LOCK_LOST_MESSAGE } from '@lopsy/photos-core/library/lock';
import { LibraryReadOnlyError } from '@lopsy/photos-core/library/session';
import { NEWER_PIPELINE_MESSAGE, NewerPipelineError } from '@lopsy/photos-core/library/pipeline';
import { FakeSession } from './fake/fake-session';
import { guardSession, READ_ONLY_MESSAGE } from './guard-session';

function throwing(error: Error): LibrarySession {
  const session = new FakeSession('memory', 'Test');
  void session.close();
  session.setMarks = () => {
    throw error;
  };
  return session;
}

describe('guardSession', () => {
  it('turns a lost lock into a message', () => {
    const messages: string[] = [];
    const guarded = guardSession(throwing(new LibraryLockLostError()), (m) => messages.push(m));
    expect(() => guarded.setMarks(['a'], { rating: 1 })).not.toThrow();
    expect(messages).toEqual([LOCK_LOST_MESSAGE]);
  });

  it('turns a read-only library into a message', () => {
    const messages: string[] = [];
    const guarded = guardSession(throwing(new LibraryReadOnlyError()), (m) => messages.push(m));
    guarded.setMarks(['a'], { rating: 1 });
    expect(messages).toEqual([READ_ONLY_MESSAGE]);
  });

  it('turns a version from a newer pipeline into a message', () => {
    const messages: string[] = [];
    const guarded = guardSession(throwing(new NewerPipelineError()), (m) => messages.push(m));
    expect(() => guarded.setMarks(['a'], { rating: 1 })).not.toThrow();
    expect(messages).toEqual([NEWER_PIPELINE_MESSAGE]);
  });

  it('lets other errors through and leaves reads alone', () => {
    const guarded = guardSession(throwing(new Error('boom')), () => {});
    expect(() => guarded.setMarks(['a'], { rating: 1 })).toThrow('boom');
    expect(guarded.getView().assets.size).toBe(0);
    expect(guarded.libraryId).toMatch(/^library-/);
  });
});
