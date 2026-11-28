import { describe, expect, it } from 'vitest';
import { createTracking } from './tracking';
import { nullTracker, recordingTracker, switchableTracker, type Tracker } from './tracker';
import { FILE_ERROR_EVENT } from './file-error';

describe('createTracking', () => {
  it('sends an event with its properties, undefined values left out', () => {
    const tracker = recordingTracker();
    const track = createTracking(tracker, { app: 'lopsy' });
    expect(track.event('guestbook', { name: 'Ada', region: undefined, count: 3, isNew: false })).toBe(true);
    expect(track.event('empty')).toBe(true);
    expect(tracker.calls).toEqual([
      { event: 'guestbook', properties: { name: 'Ada', count: 3, isNew: false } },
      { event: 'empty', properties: {} },
    ]);
  });

  it('does not add the app to a general event', () => {
    const tracker = recordingTracker();
    createTracking(tracker, { app: 'photonamous' }).event('guestbook', { message: 'hi' });
    expect(tracker.calls[0]?.properties).toEqual({ message: 'hi' });
  });

  it('trims every string to the 100 characters Google Analytics keeps, at a word', () => {
    const tracker = recordingTracker();
    const long = `${'word '.repeat(30)}end`;
    createTracking(tracker, { app: 'lopsy' }).event('e', { long, unbroken: 'x'.repeat(150), exact: 'y'.repeat(100) });
    const properties = tracker.calls[0]!.properties;
    expect(String(properties.long).length).toBeLessThanOrEqual(100);
    expect(properties.long).toMatch(/^(word )+word…$/);
    expect(properties.unbroken).toBe(`${'x'.repeat(99)}…`);
    expect(properties.exact).toBe('y'.repeat(100));
  });

  it('answers the tracker’s answer: false where the page has no analytics', () => {
    expect(createTracking(nullTracker, { app: 'lopsy' }).event('guestbook', {})).toBe(false);
    expect(createTracking(recordingTracker(false), { app: 'lopsy' }).error({ kind: 'too-large', reason: 'r', format: 'png' })).toBe(false);
  });

  it('never throws into the caller, whatever the tracker does', () => {
    const throwing: Tracker = {
      track: () => {
        throw new Error('broken');
      },
    };
    const track = createTracking(throwing, { app: 'lopsy' });
    expect(track.event('guestbook', { a: 'b' })).toBe(false);
    expect(track.error({ kind: 'decode-failed', reason: 'Image could not be decoded', format: 'jpeg' })).toBe(false);
  });
});

describe('track.error', () => {
  it('sends one file_error event with the app, the kind, the reason, the format and a count of 1', () => {
    const tracker = recordingTracker();
    createTracking(tracker, { app: 'photonamous' }).error({ kind: 'unsupported-type', reason: 'File type not supported', format: 'heic' });
    expect(tracker.calls).toEqual([
      {
        event: FILE_ERROR_EVENT,
        properties: { app: 'photonamous', kind: 'unsupported-type', reason: 'File type not supported', format: 'heic', count: 1 },
      },
    ]);
    expect(FILE_ERROR_EVENT).toBe('file_error');
  });

  it('carries the limit of a size failure and the count of files one action refused', () => {
    const tracker = recordingTracker();
    const track = createTracking(tracker, { app: 'lopsy' });
    track.error({ kind: 'too-large', reason: 'Image width exceeded 8192', format: 'png', limit: 8192 });
    track.error({ kind: 'unsupported-type', reason: 'File type not supported', format: 'nef', count: 12 });
    expect(tracker.calls.map((c) => c.properties)).toEqual([
      { app: 'lopsy', kind: 'too-large', reason: 'Image width exceeded 8192', format: 'png', count: 1, limit: 8192 },
      { app: 'lopsy', kind: 'unsupported-type', reason: 'File type not supported', format: 'nef', count: 12 },
    ]);
  });

  it('shortens a long reason to 100 characters by its meaning, not mid-word', () => {
    const tracker = recordingTracker();
    const reason =
      'This camera\'s compressed RAW format isn\'t supported yet (the decoded data has no signal). Set the camera to "Uncompressed" RAW, or convert it to DNG.';
    createTracking(tracker, { app: 'lopsy' }).error({ kind: 'raw-refused', reason, format: 'raf' });
    expect(tracker.calls[0]?.properties.reason).toBe("This camera's compressed RAW format isn't supported yet.");
  });

  it('sends only its own fields: anything else on the object is left out', () => {
    const tracker = recordingTracker();
    const withExtra = { kind: 'decode-failed', reason: 'Image could not be decoded', format: 'jpeg', fileName: 'Holiday.jpg' } as const;
    createTracking(tracker, { app: 'lopsy' }).error(withExtra);
    expect(tracker.calls[0]?.properties).toEqual({ app: 'lopsy', kind: 'decode-failed', reason: 'Image could not be decoded', format: 'jpeg', count: 1 });
  });
});

describe('recordingTracker and switchableTracker', () => {
  it('records each call in order, a copy of its properties', () => {
    const tracker = recordingTracker();
    const properties = { a: 1 };
    expect(tracker.track('one', properties)).toBe(true);
    properties.a = 2;
    tracker.track('two', {});
    expect(tracker.calls).toEqual([
      { event: 'one', properties: { a: 1 } },
      { event: 'two', properties: {} },
    ]);
  });

  it('forwards to the tracker set, and puts the one before back', () => {
    const first = recordingTracker();
    const second = recordingTracker();
    const tracker = switchableTracker(first);
    tracker.track('a', {});
    const restore = tracker.set(second);
    tracker.track('b', {});
    restore();
    tracker.track('c', {});
    expect(first.calls.map((c) => c.event)).toEqual(['a', 'c']);
    expect(second.calls.map((c) => c.event)).toEqual(['b']);
  });
});
