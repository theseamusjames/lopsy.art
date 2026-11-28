import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordingTracker, type RecordingTracker } from '@lopsy/tracking/tracker';
import { ImageTooLargeError } from '../io/image-too-large';
import { useCanvasMessageStore } from './canvas-message-store';
import { useNotificationsStore } from './notifications-store';
import { reportOpenFailure, showIfTooLarge, toastOpenFailure } from './report-open-failure';
import { setTracker } from './track';

let tracker: RecordingTracker;
let restore: () => void;

beforeEach(() => {
  tracker = recordingTracker();
  restore = setTracker(tracker);
  useNotificationsStore.setState({ notifications: [] });
  useCanvasMessageStore.getState().dismiss();
});

afterEach(() => {
  restore();
});

const NAME = 'Ada Lovelace at home.png';

describe('reportOpenFailure', () => {
  it('sends one file_error for an image too large, alongside the message over the canvas, and nothing of the name', () => {
    reportOpenFailure(new ImageTooLargeError(8200, 64, { side: 8192, isDevice: true }), { kind: 'image', name: NAME }, 'unused toast');
    expect(useNotificationsStore.getState().notifications).toEqual([]);
    expect(tracker.calls).toEqual([
      {
        event: 'file_error',
        properties: { app: 'lopsy', kind: 'too-large', reason: 'Image width exceeded 8192', format: 'png', count: 1, limit: 8192 },
      },
    ]);
    expect(JSON.stringify(tracker.calls)).not.toMatch(/Ada|Lovelace|home|8200/);
  });

  it('sends one file_error with the toast of any other failure, built apart from the toast’s words', () => {
    reportOpenFailure(new Error(`Failed to open image: ${NAME}`), { kind: 'image', name: NAME }, `Failed to open file: ${NAME}`);
    expect(useNotificationsStore.getState().notifications.map((n) => n.message)).toEqual([`Failed to open file: ${NAME}`]);
    expect(tracker.calls).toEqual([
      { event: 'file_error', properties: { app: 'lopsy', kind: 'decode-failed', reason: 'Image could not be decoded', format: 'png', count: 1 } },
    ]);
    expect(JSON.stringify(tracker.calls)).not.toMatch(/Ada|Lovelace|home/);
  });

  it('sends nothing when a failure was not about size and the caller toasts nothing (showIfTooLarge alone)', () => {
    expect(showIfTooLarge(new Error('no image on the clipboard'), { kind: 'paste', name: null })).toBe(false);
    expect(tracker.calls).toEqual([]);
  });

  it('toastOpenFailure toasts and tracks once', () => {
    toastOpenFailure(new Error('x'), { kind: 'image', name: 'photo.heic' }, 'Failed');
    expect(tracker.calls.map((c) => c.properties.kind)).toEqual(['unsupported-type']);
    expect(useNotificationsStore.getState().notifications).toHaveLength(1);
  });
});
