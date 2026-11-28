/**
 * Lopsy's usage statistics (packages/tracking/README.md): `track.event`
 * for an event, `track.error` for a file Lopsy refused or could not open.
 * In production they go to Cloudflare Zaraz; elsewhere nothing is sent.
 */

import { createTracking } from '@lopsy/tracking/tracking';
import { switchableTracker } from '@lopsy/tracking/tracker';
import { zarazTracker } from '@lopsy/tracking/zaraz';

const tracker = switchableTracker(zarazTracker());

export const track = createTracking(tracker, { app: 'lopsy' });

/** Tests only: sends to `next` until the function returned is called. */
export const setTracker = tracker.set;
