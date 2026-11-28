# @lopsy/tracking

Usage statistics for Lopsy and Photonamous, kept apart from the service
that carries them. Application code says what happened (`track.event`,
`track.error`); a `Tracker` hands it to a service. In production that
service is Cloudflare Zaraz, which runs the Google Analytics tag at the
edge, so the pages have `window.zaraz` and no gtag. Plain TypeScript, no
React; its tests run in Node.

| Module | What |
|---|---|
| `tracker.ts` | `Tracker`, the interface a service implements; `nullTracker`; `recordingTracker()` for tests; `switchableTracker()`, which an app's module uses so tests can swap the tracker |
| `zaraz.ts` | `zarazTracker()`, and the `Window.zaraz` type |
| `tracking.ts` | `createTracking(tracker, { app })`: `event(name, properties)` and `error(fileError)` |
| `file-error.ts` | The `file_error` event: its kinds, the list of formats it may name, and the helpers that build a reason |

## Using it

Each app has one module, `src/app/track.ts`, with its name baked in:

```ts
import { createTracking } from '@lopsy/tracking/tracking';
import { switchableTracker } from '@lopsy/tracking/tracker';
import { zarazTracker } from '@lopsy/tracking/zaraz';

const tracker = switchableTracker(zarazTracker());
export const track = createTracking(tracker, { app: 'lopsy' });
/** Tests only: send to `next` until the function returned is called. */
export const setTracker = tracker.set;
```

and code writes:

```ts
track.error({ kind: 'too-large', reason: sideExceeded('Image', width, limit), format: formatFromName(file.name), limit });
track.event('guestbook', { name, region, model, message });
```

`event` leaves out undefined values and trims every string to the 100
characters Google Analytics keeps (at a word, with an ellipsis). `error`
sends one `file_error` event with exactly these parameters:

| Parameter | Value |
|---|---|
| `app` | `lopsy` or `photonamous` |
| `kind` | `unsupported-type`, `raw-refused`, `too-large` or `decode-failed` |
| `reason` | One general sentence, at most 100 characters (`shortenReason`) |
| `format` | One of `FILE_FORMATS`, or `other` |
| `count` | How many files one action refused for this reason; 1 for one |
| `limit` | With `too-large`: the limit that was exceeded |

The event is `file_error`, not `error`: Google Analytics reserves `error`
as an event name. Neither call throws into its caller, and each answers
whether the service took the event (false where the page has none: in
development, in tests, behind a blocker).

## What may never be sent

Nothing that identifies the person or the file: no file name or path, no
title, no folder or album name, no storage or Drive id, no account id, no
text from the file's metadata (camera serial, owner, lens serial, GPS), no
text the person typed, and no message shown to the person that contains
any of those. The image's own dimensions are not sent either.

So a reason is built separately from the sentence shown to the person,
from fixed words (`sideExceeded`, "File type not supported") or the
engine's own refusal sentences (`engineReason`, which drops the format
wrapper, shortens the sentence, and gives the fallback when the sentence
mentions the file's name). A format comes from `formatFromName`,
`formatFromExtension` or `formatFromMime`, never from the extension
itself: an extension is whatever a person typed. Photonamous' Privacy
Policy (`apps/photonamous/privacy.html`, "Usage statistics") promises this.

## Another service

Implement `Tracker` and pass it to `createTracking` in the app's
`track.ts`:

```ts
export function plausibleTracker(): Tracker {
  return {
    track(event, properties) {
      const plausible = window.plausible;
      if (!plausible) return false;
      try {
        plausible(event, { props: properties });
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

A tracker looks its service up at each call (it can load after the page's
script starts), answers false when the service is not there, and never
throws or lets a rejected promise escape. A service whose page tag needs a
new host also changes the app's Content-Security-Policy and Privacy
Policy.

## Commands

```bash
npm run test:tracking        # from the repository root; also typecheck:tracking, lint:tracking
```
