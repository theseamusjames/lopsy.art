# Photonamous: the start screen's film

The start screen (`apps/photonamous/src/components/StartScreen/`) plays a
silent trailer of about 24 seconds in its left two thirds. This is how it
is made, what every file is, and how to record or change it, so the next
cut does not start from nothing. Running the app and its tests is in
`photonamous-setup.md`.

## What it is

Nothing in the film is drawn by hand or edited in a video tool. A
Playwright script, `apps/photonamous/e2e/demo-reel.record.ts`, **directs
the real app**: it signs in, fills a library, moves the camera, lays the
titles over the page, replays an edit, and captures each shot as Chromium
draws it. ffmpeg then cuts the shots together and encodes them. To change
the film, change the script and record again: about two minutes.

The cut, as recorded on 2026-11-21 (24.1 s, 30 fps, 1440 × 1200):

| # | Shot | Seconds | What happens |
|---|---|---|---|
| 1 | library | 2.3 | The grid of a 45-photo Drive library drifts in under **Your photos.** Its first frame is the poster. |
| 2 | pick | 1.3 | Close on one tile: clicked, then given five stars. |
| 3 | timelapse | 5.6 | The Edit view on `DSCF8078.RAF`. **Professional editing.**, a cut to **In your web browser.**, and a real edit replayed step by step: 40 steps, the History list filling as the photo changes. The camera moves in and comes to rest on the whole photograph, and the pointer arrives at its left edge. |
| 4 | before-after | 2.7 | Split view, cut in on the framing shot 3 ended on, with the divider at the left edge: nothing moves at the cut. The pointer drags the divider across the photograph and back. |
| 5 | no-servers | 1.1 | **No servers.** over the darkened editor. |
| 6 | own-cloud | 1.2 | **Your own cloud storage.**, a cut from the last with the dark held between them. |
| 7 | drive | 4.3 | drive.google.com, clicked through: the pointer opens Originals in the library's folder, then 2026, then 2026-10-25, and the camera pulls back over that day's four RAW files. |
| 8 | free-end | 5.6 | **Completely free.** in the dark over a photograph edited in the app, held longer than the other titles (1.8 s); then a dissolve: the dark lifts as the title goes, and only when it has gone do the wordmark and, close under it, **Your photos on your own cloud storage.** come up. |

## The files

Committed, in `apps/photonamous/`:

| File | What it is |
|---|---|
| `src/components/DemoReel/demo-reel.av1.mp4` | The film, AV1 (1.4 MB). What most browsers play. |
| `src/components/DemoReel/demo-reel.h264.mp4` | The same, H.264 (1.7 MB), for browsers without AV1. |
| `src/components/DemoReel/demo-reel-poster.jpg` | The film's first frame (121 KB), shown before it plays and in place of it. |
| `src/components/DemoReel/DemoReel.tsx` | The player: autoplay, the Pause button, reduced motion and Save-Data, and the film's text alternative. **Its hidden paragraph repeats the titles: change it when they change.** |
| `e2e/demo-reel.record.ts` | The director: every shot, title, camera move and timing. |
| `e2e/demo-reel.config.ts` | Its Playwright config: the 1440 × 1200 frame captured at 2×, Chromium with the GPU, a dev server of its own on port 5194. |
| `e2e/demo-reel-edit.json` | The edit shot 3 replays: the 41 History steps of a real edit of `DSCF8078.RAF`, each as `[label, changes]`. Its crop is applied before the shot (gotcha 14). |
| `e2e/demo-reel-end.jpg` | The photograph behind the last shot: `DSCF8517`, edited and exported from the app, 2880 px wide. |
| `e2e/demo-reel-drive-1.png` to `-4.png` | Shot 7's pictures: captures of drive.google.com (2238 × 932 each), one for each folder from `Photonamous` down to `Originals/2026/2026-10-25`. |
| `scripts/demo-reel-library.mjs` | Builds the folder of JPEGs the library is filled with, from a folder of photos. |

Not committed (too large, and not the repository's):

| What | Where it was on 2026-11-21 |
|---|---|
| The master: the same cut at visually lossless quality (H.264, CRF 14, 19 MB), to encode from again without recording | `samples/photonamous-demo-reel/demo-reel-master.mp4` in the main checkout (`/samples` is git-ignored) |
| The 45 sample photos (30 JPEG, 15 named `.RAF`) the library was built from | `apps/photonamous/public/samples/` in the main checkout. **They should not stay under `public/`**: a production build would ship and precache all 1.2 GB. `samples/photonamous-demo-reel/photos/` is the place for them. |
| `DSCF8078.RAF`, the photo the timelapse edits | https://github.com/theseamusjames/sample-raf-images |

## Recording it again

From the repository root, with the engine built (`npm run wasm:build`):

```bash
# 1. The library's photos: JPEGs only (step 3 of "Why it is built this way")
node apps/photonamous/scripts/demo-reel-library.mjs <your photos> /tmp/reel-library

# 2. Record. Writes the three files in src/components/DemoReel/.
cd apps/photonamous
REEL_PHOTOS=/tmp/reel-library \
REEL_HERO=<path to>/DSCF8078.RAF \
REEL_MASTER=<somewhere git-ignored>/demo-reel-master.mp4 \
  npx playwright test -c e2e/demo-reel.config.ts

# 3. Delete /tmp/reel-library.
```

It needs macOS (`sips` scales the end photograph), ffmpeg with `libsvtav1`
and `libx264`, and Playwright's full Chromium (`npx playwright install
chromium`). A run prints each shot's frame count and how much it was sped
up, then the three files' sizes. `REEL_END` names another photograph for
the end card (default `e2e/demo-reel-end.jpg`).

**Look at the result before keeping it.** Pull frames and tile them:

```bash
for t in 0.1 3 5 8 11 13 15 18; do
  ffmpeg -y -loglevel error -ss $t -i src/components/DemoReel/demo-reel.av1.mp4 \
    -frames:v 1 -vf scale=660:550 /tmp/reel-$t.jpg
done
```

## Changing it

| To change | Edit |
|---|---|
| A title's words | The `title(...)` calls in `demo-reel.record.ts`; then the hidden paragraph in `DemoReel.tsx` and the film's entry in `FEATURES.md`. |
| The end card's line | `TAGLINE` in `demo-reel.record.ts`; then the same two places. |
| The titles' look | `#reel-title` in `stageScript` (Inter 900, 136 px, upper case, tight). The last title is not on the app's page: it is `.title` in `END_CARD_CSS`, set the same way. |
| The last title, its hold and the dissolve | The last shot in the script: the words are passed to `endPage`, the hold is the wait before `end` is added, and the dissolve is the `.end` rules in `END_CARD_CSS`. The wordmark waits `END_TITLE_OUT_MS` for the title to go; the space between the wordmark and the line is `.card`'s `gap`. |
| The photograph behind the last shot | Replace `e2e/demo-reel-end.jpg`, or name another with `REEL_END`. |
| A shot's length | The number passed to `shot(page, id, seconds, ...)`. |
| The order, or a shot | The numbered blocks in the `test` at the foot of the script. Each `clips.push(await shot(...))` is one shot; cuts are hard, in that order. |
| The edit in the timelapse | `demo-reel-edit.json`. To take another photo's edit from a real library: open its IndexedDB database (`photonamous:google-drive:<account>` or `photonamous:browser:opfs`), read the row of the `state` store, and take `state.history`'s entry for the version: its `entries` are `[seq, { label }, changes]`. Then set `REEL_HERO` to that photo. |
| The folders in the Drive shot | Capture drive.google.com again (below) and replace the pictures; `DRIVE_LEVELS` in `demo-reel.record.ts` names them and says which row is opened in each, and `DRIVE_ROWS` says where the rows are. The pacing and the pull-back are in `realDrivePage`. |
| File size | `REEL_AV1_CRF` (default 44) and `REEL_H264_CRF` (default 30): higher is smaller. A photograph that moves (the end card's drift, the library's) costs the most. |

**The Drive pictures** were taken by hand from a signed-in browser, in
list view, with the pointer parked away from the list: the folders
`Photonamous`, `Originals`, `2026` and `2026-10-25`, each captured in two
halves at about 2.4× (the same region every time, from the breadcrumb to
under the fifth row, 471 × 392 CSS pixels a half) and joined side by side
with `ffmpeg -i left.png -i right.png -filter_complex hstack`. Because
the region is the same, a row is in the same place in all four. The
captures are unaltered; the grey under the pointer and the blue of the
click are drawn over them in Drive's own colours (`#ededed`, `#c2e7ff`).
A capture taken while hovering a row has the real pointer and a tooltip
in it, so don't. If a picture is missing, the script draws the fake
Drive's folder tree instead (`drivePage`).

## Why it is built this way

Things found the hard way. Each is the reason for something in the script
that looks odd.

1. **Camera moves are done in the page, not in ffmpeg.** `camera()` sets a
   transform on the app's root. The browser redraws type and controls at
   the new size, so a close-up is sharp; a crop in ffmpeg would only
   enlarge pixels. The titles and the pointer sit outside the root, so the
   camera does not move them.
2. **Headless Chromium draws no mouse pointer**, so the script draws one
   and moves it with the real mouse events. The page hears nothing of a
   mouse outside the window, so moving the mouse out does not take the
   drawn pointer away: `pointerAway()` does.
3. **The Drive library cannot hold RAW files in a recording.** The fake
   Drive answers through Playwright's request routing, and Chromium exits
   when a routed response is as large as an 85 MB RAF (the app reads each
   original back after importing it). So the library is JPEGs, and the
   timelapse's photo is opened in a second page with a library in this
   browser. The Edit view is the same in both.
4. **The GPU matters.** The config uses `channel: 'chromium'` with
   `--use-angle=metal`: the full browser's new headless mode draws on the
   machine's GPU. The headless shell the tests use draws on SwiftShader,
   where one render takes seconds.
5. **A shot whose actions run long is played faster, not cut.** `shot()`
   measures how long the actions took and scales the frames' durations to
   the shot's length. The log says "played at 1.53x" when it does.
6. **A control the camera has moved out of the window cannot be
   clicked.** Playwright waits for it to come into view, for ever.
   `press()` clicks such a control from the page instead.
7. **Focus on a field out of view scrolls the page**, which shifts every
   framing after it. Nothing in the film types into a field any more; if
   something does again, scroll back to the top after it.
8. **The grid only keeps the tiles in view in the page.** Counting tiles
   does not count photos, and clicking one out of view scrolls the grid.
   The script works out which tiles are in view by where they are, and
   touches only those.
9. **The timelapse sends its steps the way the Edit view does**
   (`LibrarySession.editRecipe`, reached through the dev server's own
   `/src/app/store.ts`), so the sliders, History and the photo all follow.
   Curves and the crop could not be replayed through the controls at that
   pace.
10. **The photograph's place on screen comes from the split view**, whose
    divider carries the image's box as CSS variables. The largest canvas
    is the whole stage, not the photo.
11. **A drag under the camera needs two sets of coordinates.** The split
    divider works its place out from lengths as laid out, and the camera
    has scaled the page. Shot 4 sends the mouse where the divider *reads*
    the fraction wanted and draws the pointer where that *shows*
    (`__reelPointerMap`). A mouse aimed at the layout's coordinates
    misses the divider and drags the photograph instead; the shot fails
    if the divider does not end where it was sent.
12. **The drawn pointer follows `pointermove`.** A control that cancels
    its `pointerdown`, as the divider does, gets no `mousemove` while it
    is held.
13. **Captured frames are large.** A run writes one to two gigabytes under
    `test-results/demo-reel` and deletes it when it finishes; a run that is
    stopped leaves it. `REEL_KEEP_FRAMES=1` keeps it on purpose.
14. **Nothing may change the photograph's size on screen while the camera
    moves.** A crop does: the Edit view fits the cropped photograph to the
    stage again, which in the middle of a camera move reads as a jump. So
    the edit's `framing.*` steps go on before shot 3 starts, and its other
    steps are the ones filmed.
15. **Shots 3 and 4 are one framing.** It is measured once, before shot 3,
    from the split view. The timelapse's camera eases in to it and is
    still before the shot ends; the split view is then switched on off
    camera with its divider already at the left edge, where the whole
    photograph is the edit. The cut adds the divider and the Before and
    After labels and moves nothing. A cut between two framings of the
    same photograph a few percent apart looks like a mistake.

## What the page does with it

- The film is imported by `DemoReel.tsx`, so the build gives each file a
  hashed name under `/assets/`, cached for a year.
- The service worker does not precache the two `.mp4` files (the poster,
  yes): `scripts/vite-plugin-service-worker.ts`.
- It starts by itself, muted. With reduced motion or Save-Data it shows
  the poster and a Play button, and downloads nothing until asked.
- Its shape is 6:5, two thirds of a 16:9 window, and it covers its box, so
  on other shapes its edges are cropped. Titles are set in the middle for
  that reason.
