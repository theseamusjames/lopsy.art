/**
 * Photonamous' usage statistics (packages/tracking/README.md):
 * `track.error` for a file the app refused or could not open. In
 * production it goes to Cloudflare Zaraz; elsewhere nothing is sent. What
 * may be sent is bounded by the Privacy Policy (privacy.html, "Usage
 * statistics").
 */

import { createTracking } from '@lopsy/tracking/tracking';
import { switchableTracker } from '@lopsy/tracking/tracker';
import { zarazTracker } from '@lopsy/tracking/zaraz';

const tracker = switchableTracker(zarazTracker());

export const track = createTracking(tracker, { app: 'photonamous' });

/** Tests only: sends to `next` until the function returned is called. */
export const setTracker = tracker.set;
