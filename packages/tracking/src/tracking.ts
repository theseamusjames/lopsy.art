/**
 * What application code uses to send usage statistics: `event` for any
 * event, `error` for the `file_error` event. Each app makes one, with its
 * name and the tracker for its service (`src/app/track.ts`).
 */

import { FILE_ERROR_EVENT, fitValue, shortenReason, type AppName, type FileError, type FileErrorProperties } from './file-error';
import type { PropertyValue, TrackProperties, Tracker } from './tracker';

export type EventProperties = Readonly<Record<string, PropertyValue | undefined>>;

export interface Tracking {
  /** Sends `name` with `properties`: undefined values left out, strings trimmed to what Google Analytics keeps. True when the service took it. */
  event(name: string, properties?: EventProperties): boolean;
  /** Sends one `file_error` event for `error`, with the app's name. True when the service took it. */
  error(error: FileError): boolean;
}

export interface TrackingOptions {
  readonly app: AppName;
}

function shaped(properties: EventProperties): TrackProperties {
  const out: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (typeof value === 'string') out[key] = fitValue(value);
    else if (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** The `file_error` event's parameters for `error` in `app`. */
export function fileErrorProperties(app: AppName, error: FileError): FileErrorProperties {
  const count = error.count !== undefined && Number.isFinite(error.count) && error.count >= 1 ? Math.floor(error.count) : 1;
  return {
    app,
    kind: error.kind,
    reason: shortenReason(error.reason),
    format: error.format,
    count,
    ...(error.limit !== undefined && Number.isFinite(error.limit) ? { limit: error.limit } : {}),
  };
}

/** Tracking for one app on `tracker`. Nothing it does throws into the caller. */
export function createTracking(tracker: Tracker, options: TrackingOptions): Tracking {
  const send = (name: string, properties: EventProperties): boolean => {
    try {
      return tracker.track(name, shaped(properties));
    } catch {
      return false;
    }
  };
  return {
    event: (name, properties = {}) => send(name, properties),
    error: (error) => {
      try {
        return send(FILE_ERROR_EVENT, { ...fileErrorProperties(options.app, error) });
      } catch {
        return false;
      }
    },
  };
}
