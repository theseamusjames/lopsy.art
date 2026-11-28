/**
 * The interface a usage-statistics service implements, and the two
 * trackers tests use. Application code does not call a tracker itself: it
 * goes through `createTracking` (tracking.ts), which shapes and trims what
 * is sent.
 */

/** A value an event parameter may have: what every analytics service takes. */
export type PropertyValue = string | number | boolean;

export type TrackProperties = Readonly<Record<string, PropertyValue>>;

/** One analytics service. */
export interface Tracker {
  /**
   * Hands `event` with `properties` to the service. True when the service
   * took it (it may still be lost on its way, as any analytics event can
   * be); false when the page has no such service. Never throws.
   */
  track(event: string, properties: TrackProperties): boolean;
}

/** A tracker that sends nothing and says so. */
export const nullTracker: Tracker = {
  track: () => false,
};

export interface SwitchableTracker extends Tracker {
  /** Sends to `next` from now on; the function returned puts the one before back. */
  set(next: Tracker): () => void;
}

/** A tracker that forwards to another, which tests can replace: an app's module keeps the seam out of its call sites. */
export function switchableTracker(initial: Tracker): SwitchableTracker {
  let current = initial;
  return {
    track: (event, properties) => current.track(event, properties),
    set(next) {
      const before = current;
      current = next;
      return () => {
        current = before;
      };
    },
  };
}

export interface TrackedCall {
  readonly event: string;
  readonly properties: TrackProperties;
}

export interface RecordingTracker extends Tracker {
  /** Every call, in order. */
  readonly calls: TrackedCall[];
}

/** A tracker for tests: keeps each call and answers `accepts` (true unless given). */
export function recordingTracker(accepts = true): RecordingTracker {
  const calls: TrackedCall[] = [];
  return {
    calls,
    track(event, properties) {
      calls.push({ event, properties: { ...properties } });
      return accepts;
    },
  };
}
