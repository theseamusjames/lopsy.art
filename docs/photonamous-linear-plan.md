# Photonamous: linear editing, correct colour and HDR

Goal: make Photonamous edit a photo the way a serious RAW editor does.
The photo stays in linear light, in a wide colour space, with nothing
clipped, until the last step turns it into what a screen or a file
needs. The screen shows it through WebGPU, in HDR where the display has
it. Exports carry the right colours and the right labels, HDR included.

Photonamous has not launched, so this plan changes how every edit
renders and keeps no old look.

This plan follows `docs/photonamous-spec.md` section 6.10, which already
describes the pipeline to arrive at. What exists today is listed in
`engine/src/develop/mod.rs` under "Deviations from spec 6.10". The plan
is the route from one to the other, in pieces that each leave the app
working.

Status: not started. Written 2026-11-24. Decisions 1, 2 and 6 were
answered the same day and are recorded in section 5.

| Phase | What | State |
|---|---|---|
| 0 | Fix what is wrong today, and build the test bed | Not started |
| 1 | WebGPU by default, and the status bar | Not started |
| 2 | The working space and the output step | Not started |
| 3 | Tone in linear light, and masks with it | Not started |
| 4 | Highlight reconstruction | Not started |
| 5 | Local contrast in linear light | Not started |
| 6 | Camera colour | Not started; deliberately last |
| 7 | HDR on screen and in files | Not started |

Phases 0 and 1 depend on nothing and can start at once, side by side.
Phase 2 is the spine: 3, 4, 5 and 7 need it.

**Workflow first, accuracy after.** The order of work is 0, 1, 2, 3, 4,
5, 7, and then 6. Phase 6 (measured camera colour) waits until the
editing workflow is right, although nothing technical stops it running
earlier.

**The best the browser offers, and less where it must.** Every display
and file feature in this plan is used where it exists and falls back
quietly where it does not: WebGPU then WebGL, HDR then Display P3 then
sRGB.

---

## 1. What "done" means

1. **Working space.** From the RAW step to the output step the image is
   linear Rec. 2020 (D65), 16-bit float, and nothing clamps it. This is
   the spec's working space.
2. **Tone works on linear light.** Exposure, Contrast, Highlights,
   Shadows, Whites and Blacks act before the image is rendered for a
   display, so Highlights can bring back what is above white.
3. **Highlights are rebuilt, not greyed.** A channel the sensor clipped
   is reconstructed from the ones that did not clip.
4. **One pipeline for every photo.** A JPEG, a PNG, a DNG and a Lopsy
   layer are brought into the same working space, so a slider means the
   same thing on all of them.
5. **The screen.** WebGPU when the browser has it, WebGL when it does
   not. On a display with HDR the canvas is 16-bit float and shows
   values brighter than white. The bottom status bar says which
   renderer and which display type are in use, as Lopsy's does.
6. **Files.** An export in Display P3 or Rec. 2020 holds pixels in that
   space and says so. An HDR export is at least 10 bits with a standard
   HDR label, in a form other software opens.
7. **It can be proved.** Every stage has a CPU reference the GPU is
   compared with, and a set of real RAW files is rendered and checked
   on every change.

Not in this plan: a new noise reduction algorithm (it keeps today's and
is revisited when there is a neural one), lens corrections, spot
removal, user camera profiles (DCP), and HDR editing in Lopsy.

---

## 2. Where we start

Read from the code on this branch. Each item names the file to look in.

### The pipeline

- **Only white balance and exposure are linear.** The RAW step
  (`engine/src/gpu/shaders/develop/raw_develop.wgsl`) applies white
  balance, the camera matrix, exposure, the profile's saturation and
  base curve, then encodes to sRGB. Every later stage works on that
  encoded image (`engine/src/develop/mod.rs`, stage table).
- **The working primaries are sRGB.** The camera matrix goes straight to
  linear sRGB (`engine/core/src/raf/mod.rs`, `cam_to_srgb`). Colours a
  camera recorded outside sRGB are gone at the second step.
- **Highlight data is thrown away at decode.** The RAF mosaic is
  clamped to 0..1 before white balance
  (`engine/core/src/raf/mod.rs`, `to_unit`), the white level is taken
  from the bit depth and not from the file, and no clip level is
  recorded. A clipped pixel ends up at a fixed, unequal ceiling per
  channel.
- **Anything brighter than white is flattened by the base curve.** Its
  lookup clamps luminance to 1 (`raw_develop.wgsl`, `curveLookup`).
- **The tone and colour pass clamps to 0..1.** Photonamous sends its
  tone sliders to the document's image adjustments, which always clip
  (`engine/src/document/compositor.rs`, `apply_image_adjustments`,
  `OverWhite::Clipped`). That shader is Lopsy's
  (`engine/src/gpu/shaders/filters/adjustments.wgsl`) and is written for
  0..1 throughout.
- **Curves are 8-bit.** A curve is a 256-entry table of 8-bit values,
  built at `i/255` and read at `i/256`
  (`apps/photonamous/src/engine/curves.ts`, `adjustments.wgsl`).
- **DNG never reaches the RAW step.** Its decoder bakes white balance,
  the matrix, the tone curve, gamma and auto-levels into the layer
  (`engine/core/src/dng/mod.rs`), so a DNG is edited as a JPEG is.
- **Masks.** A mask's Exposure and Temperature are done in linear light,
  but on the already-rendered image, and with different strengths from
  the photo's own (`engine/core/src/areas.rs`).

### Camera colour

- **One matrix per sensor generation**, in a table in the engine, for
  one light source, with no adaptation between white points
  (`color_matrix_for_model`, `engine/core/src/dng/color.rs`).
- **Kelvin is a readout only.** It is a line fitted through the camera's
  presets (`engine/core/src/raf/wb_presets.rs`); the matrix does not
  follow white balance.
- **A two-illuminant profile reader exists and is unused**
  (`engine/core/src/raf/dcp.rs`).
- **Bayer RAF files are always read as RGGB**, whatever the file says,
  and per-site black levels are averaged into one.

### The screen

- **WebGL only, 8-bit, sRGB.** Photonamous imports only the WebGL build
  of the engine (`apps/photonamous/vite.config.ts`) and never sets the
  canvas colour space.
- **Six things stop it running on the WebGPU build today:**
  1. `createEngine` is not awaited (`develop-engine.ts`); on WebGPU it
     returns a promise.
  2. The pixel readout (`sampleAt`) is synchronous; on WebGPU a read
     answers later, so it is always empty.
  3. The histogram read is not awaited, so the histogram never fills and
     Auto tone does nothing.
  4. Lopsy's build plugin that chooses a renderer matches only Lopsy's
     own import (`apps/lopsy-web/scripts/vite-plugin-renderer.ts`).
  5. Nothing would show brighter than white even on an HDR canvas,
     because of the clamp above.
  6. CI caches and passes on only the WebGL package
     (`.github/workflows/pr.yml`).
- Smaller: previews and exports are grabbed from a WebGL context and
  would fall back to a slow full-size PNG read on WebGPU; nothing
  handles a lost GPU device; the RAF workers always load the WebGL
  wasm.

### Files

- **A "Display P3" export is sRGB pixels with a P3 label.** The export
  only chooses which profile to embed
  (`engine/src/document/compositor.rs`, `export_png_16`,
  `export_tiff_16`); nothing converts the pixels. This is wrong today,
  whatever else changes.
- **Rec. 2020 has no profile.** `build_icc_profile` returns the sRGB one
  for it (`engine/core/src/export.rs`). The app hides the choice.
- **The sRGB profile we write uses a plain 2.2 gamma**, not the sRGB
  curve.
- **Every read from the GPU clamps to 0..1**, so no export can hold a
  value brighter than white. The 16-bit exports carry half-float
  precision, about 11 bits a stop.

### Versions and tests

- **The pipeline version is never saved.** `PIPELINE_VERSION` is 1 and a
  version stores only the settings that differ from the default, so no
  recipe has a `pipeline` field in storage
  (`packages/photos-core/src/library/session.ts`). Changing the number
  would relabel every edit ever made. Previews do not record it either.
- **No golden images.** The browser tests compare means and channel
  differences. In the engine, only the RAW step, colour by hue and the
  mask layer are compared with their CPU references on the GPU; noise
  reduction, local contrast, sharpening, the built-in mask adjustments
  and Finish are only checked for "changes something, and clears back".
  The corpus of real files the spec asks for (section 10) does not
  exist.
- **Two engine GPU tests fail on a machine with no screen**
  (`screen_only_views_never_reach_exports`,
  `the_develop_histogram_counts_the_displayed_pixels`), and take the
  rest down with them through a shared error log.

### Browsers, as of November 2026

Chrome and Edge 158, Safari 27.2, Firefox 160. Sources are in the
research notes of the session that wrote this plan; the points that
matter:

- **HDR on screen means WebGPU.** A WebGPU canvas configured as
  `rgba16float` with `toneMapping: { mode: 'extended' }` shows values
  above 1.0 brighter than white. Chrome and Edge have shipped it since
  129. Safari says it has since 26, on macOS 26 and iOS 26, but a
  WebKit bug report says macOS did not actually display it; this needs
  checking on a real display. Firefox has no HDR for canvases or
  images.
- **WebGL cannot show HDR in any browser.** It can show Display P3 in
  all three.
- **WebGPU is on by default** in Chrome and Edge, in Safari on OS 26 and
  later, and in Firefox on Windows and Apple-silicon Macs. Not in
  Firefox on Linux, Android or Intel Macs.
- **A page cannot ask how bright the display can go.** There is only
  `(dynamic-range: high)`, a yes or no. 1.0 is the display's own white.
- **No browser can encode an HDR image.** A canvas writes PNG, JPEG and
  WebP only. Every HDR file format needs our own writer or a WASM
  encoder.
- **HDR files other software opens:** a JPEG with a gain map opens
  everywhere (as an ordinary photo where HDR is not supported, in HDR in
  Chrome, Edge and Safari 26). AVIF in 10-bit PQ shows in HDR in
  Chrome, Edge and Safari 26. A 16-bit PNG with a `cICP` chunk is read
  by all three for colour; HDR display is confirmed in Safari 26 only.
- **Untagged images are not sRGB everywhere.** Firefox does not colour
  manage them on every platform, so every export must be tagged.

---

## 3. The pipeline to arrive at

The spec's table (6.10), with what this plan leaves out removed. "Scene"
means linear light with no upper limit, where 0.18 is middle grey.
"Rendered" means after the tone step: still linear, still float, but
shaped for viewing, where 1.0 is white and anything above it is HDR
headroom.

| # | Stage | Works on |
|---|---|---|
| 1 | Decode: black and white levels from the file, no clamping, clip levels recorded | sensor |
| 2 | Demosaic at the as-shot white balance | camera RGB |
| 3 | White balance correction, highlight reconstruction | camera RGB |
| 4 | Camera profile | to linear Rec. 2020, scene |
| 5 | Noise reduction (today's, wrapped: see Phase 5) | scene |
| 6 | Exposure, haze | scene |
| 7 | Masks' own Exposure, Temperature, Tint | scene |
| 8 | Tone: the profile's curve, Contrast, Highlights, Shadows, Whites, Blacks; masks' own Contrast, Highlights, Shadows | scene to rendered |
| 9 | Local contrast | rendered |
| 10 | Colour: Vibrance, Saturation, Color by hue, Color grading | rendered, in OkLab |
| 11 | Curves | rendered, through a display-like encoding |
| 12 | Each mask's layer (its further adjustments) | rendered |
| 13 | Sharpening | rendered, luminance |
| 14 | Finish: vignette, grain | rendered |
| 15 | Output: gamut mapping, HDR or SDR roll-off, transfer curve, dither | to the screen's or the file's space |

Decisions built into this table:

- **Photonamous gets its own tone and colour stages.** Lopsy's
  adjustment shader assumes 0..1 and Lopsy's own files depend on it
  rendering exactly as it does. It is not touched. The two apps'
  Exposure and Contrast will be different maths; they already are for a
  RAW file.
- **Lopsy's RAF import is untouched.** It uses the engine's baked decode
  (`render_rgb`), which a test holds to its current output. The new
  decode is a separate path, as the linear one is today.
- **One image, two ways out.** The edit produces one rendered image.
  The output step is what differs: for an ordinary screen or file it
  rolls highlights off to white; for HDR it lets them run up to a
  headroom. HDR is therefore a way of viewing and exporting, not a
  second edit (decision 1 below).
- **A photo that is not RAW is brought in as scene data**: decoded from
  sRGB or P3 to linear Rec. 2020. With no edits it must come out within
  1/255 of how it went in, which a test already checks
  (`e2e/grade-alpha.spec.ts`).
- **The engine needs float render targets.** On a GPU without them the
  WebGL pool is 8-bit and linear data bands. Today the app quietly uses
  a baked look there. That stays as the fallback and the status bar
  says so.

---

## 4. The phases

Each phase lists what changes, what it depends on, and how we know it is
done. Sizes are relative: S is a day or two of work, M about a week, L
more.

### Phase 0. Fix what is wrong today, and build the test bed (M)

Depends on nothing. Worth doing even if nothing else in this plan
happened.

1. **Display P3 exports convert the pixels.** Until Phase 2 the
   conversion is from sRGB (`SRGB_TO_P3_MATRIX` exists in
   `engine/core/src/color.rs` and is unused); after it, the output step
   does it.
2. **Profiles.** The sRGB profile gets the real sRGB curve. Rec. 2020
   gets a real profile, and the export dialog offers it for 16-bit
   formats, as the spec says. Compact public-domain profiles keep them
   small.
3. **Every export is tagged**, sRGB included. PNG gets `cICP` beside
   `iCCP` for P3 and Rec. 2020.
4. **The pipeline version stays 1 and is not tracked yet.** Nothing is
   launched and no existing edit is supported, so the new pipeline is
   version 1 and the old maths is deleted as it is replaced. Before the
   site launches, and not before, every version must write its
   `pipeline` field and every preview must record the version it was
   rendered with: that is the day versions start to matter. It is
   listed under "Before launch" at the end of this section.
5. **A corpus and golden renders.** A folder of real RAF files (from
   `theseamusjames/sample-raf-images`) times a set of recipes, rendered
   by the command-line host (`engine/hosts/cli`) and compared with
   stored results within a tolerance. A change that moves them fails
   unless the pipeline version moved too. This is the spec's section
   10.
6. **GPU against CPU for every stage.** Add the missing comparisons:
   noise reduction, local contrast, sharpening, the built-in mask
   adjustments, Finish.
7. **The two screen-less test failures are fixed**, and one test's
   error no longer fails the others.
8. **Decode fixes that are plain bugs:** the Bayer pattern is read from
   the file; black level is per site; DNG uses every black level value.

Done when: a P3 export of a saturated test image measures as P3; the
golden suite runs in CI; `npm run wasm:test:wgpu` passes with no
skipped tests on a machine without a screen.

Before launch, whenever that is: save the pipeline version with every
edit and every preview (item 4), so that the first change to rendering
after launch can be told apart from the edits made before it.

### Phase 1. WebGPU by default, and the status bar (M)

Depends on nothing. No change to how a photo renders.

1. **Choosing a renderer.** Move Lopsy's selector (the build plugin,
   `renderer-choice.ts`, `renderer-selector.ts`) to where both apps can
   use it, and make it take the importing app as a setting. Photonamous
   asks for WebGPU first: `navigator.gpu`, then a real adapter request.
   No adapter means WebGL in the same page load. A device that fails to
   start means WebGL on the next load, as in Lopsy. A `?renderer=`
   query overrides either, for tests and for support.
2. **Make the app correct on WebGPU.**
   - Await `createEngine`.
   - The pixel readout becomes asynchronous, and reads with the screen
     overlays off.
   - The histogram read is awaited; Auto tone works again.
   - Reads are queued in turn, as Lopsy's `asyncReadback` does.
   - Previews and exports stop depending on a WebGL context: the engine
     resizes and the app encodes from a read.
   - A lost GPU device rebuilds the engine and reloads the photo.
   - The RAF workers load the wasm that matches the page, so one build
     is downloaded, not two.
3. **The status bar.** A presentational `StatusBar` (items, dividers,
   the 24 px bar and its styles) moves to `packages/ui`; Lopsy's keeps
   its contents and uses it. Photonamous gets one along the bottom of
   the window, in the library and the Edit view alike. At the right, as
   in Lopsy: the renderer (WebGPU or WebGL) and the display type (sRGB,
   Display P3, with HDR after it when the canvas is HDR). At the left:
   decision 7.
4. **Display type is detected honestly.** `(color-gamut: p3)` and
   `(dynamic-range: high)`, watched for changes so moving the window to
   another display updates it. Lopsy today only checks that the browser
   accepts a P3 canvas, not that the display has the gamut.
5. **Tests on both renderers.** The Playwright configs take a renderer
   setting and the WebGPU flags; the suite runs on each. CI builds,
   caches and passes on both packages.

The canvas stays sRGB in this phase. Labelling it P3 before Phase 2
would show sRGB numbers as P3, the same mistake the exports make.

Done when: the whole browser suite passes on WebGPU and on WebGL; the
status bar reads "WebGPU" or "WebGL" correctly in each; a browser with
no WebGPU opens the app with no error.

### Phase 2. The working space and the output step (L)

Depends on Phase 0 (version, golden renders). This is the change
everything else stands on, and it is done so that the picture barely
moves: the stages keep their maths and only the ends change.

1. **The RAW step stops at scene data.** It applies white balance, the
   camera matrix (now to linear Rec. 2020) and exposure, and nothing
   else. The profile's saturation and base curve move out of it.
2. **A tone step**, for now holding only the profile's curve and
   saturation, takes scene data to rendered data. The curve's table is
   extended so luminance above 1 rolls off along a shoulder and is not
   clamped.
3. **An output step** at the end of the chain converts rendered linear
   Rec. 2020 to the target: gamut mapping that compresses out-of-range
   colour smoothly, the transfer curve, and dither for 8-bit targets.
   The live frame uses it for the canvas; every export uses it for its
   file. P3 and Rec. 2020 exports now come straight from the working
   space.
4. **The stages in between run in a display encoding for now.** Each
   one that still assumes encoded values is wrapped: encode, run,
   decode. This keeps noise reduction, local contrast, Lopsy's
   adjustment pass, colour by hue, masks, sharpening and Finish exactly
   as they are while the ends change. Later phases remove the wrappers
   one stage at a time.
5. **Other photos enter the same way.** JPEG, PNG, WebP and Lopsy
   layers are decoded to linear Rec. 2020 on load, with an identity
   profile.
6. **The canvas is Display P3** where the display has it, on both
   renderers.
7. **The histogram, clipping warnings, pixel readout and Auto tone**
   read the image after the output step, as an ordinary screen would
   show it, so their numbers mean what they do today.
8. **Reads from the GPU can be unclamped float**, for the HDR exports in
   Phase 7.

Done when: the golden renders move by no more than a small, stated
tolerance for sRGB output; a saturated RAW colour that clipped in sRGB
now survives into a P3 export; an unedited JPEG round-trips within
1/255.

### Phase 3. Tone in linear light, and masks with it (L)

Depends on Phase 2. This is where the picture changes. The pipeline
version stays 1: see Phase 0, item 4.

1. **New tone maths**, with a CPU reference in `engine/core` and a
   shader of its own:
   - Exposure is already linear.
   - Contrast pivots on middle grey, in stops, so it does not shift
     colour.
   - Highlights and Shadows act on ranges of scene luminance measured
     in stops. The first version is a smooth curve per range, which
     cannot make halos. The spec's edge-aware version is a later
     refinement.
   - Whites and Blacks set the two ends of the scene range that the
     profile's curve maps to white and black.
   - Colour is preserved by scaling all three channels together.
2. **Highlights recovers.** Because nothing clamps before this stage,
   pulling Highlights down brings back whatever the file holds above
   white.
3. **Lopsy's adjustment pass leaves the chain.** Vibrance and Saturation
   move to the colour stage beside Color by hue (OkLab). Color grading
   gets a version on rendered linear data. Curves get their own stage:
   a 4096-entry float table read the way the base curve is, through a
   display-like encoding so a curve still feels as it does now.
4. **Masks.** A mask's Exposure, Temperature and Tint move to scene data
   (stage 7), with the same strengths as the photo's own. Its Contrast,
   Highlights and Shadows use the new tone maths. A mask's layer (its
   further adjustments) uses the new stages too.
5. **Auto tone** is rewritten on linear statistics.
6. **The wrappers from Phase 2 come off** the stages that have moved.
7. **Tests.** The golden renders are re-made. The browser tests that
   pin a number are re-based: the list is in section 6.

Done when: a RAW file with blown-looking sky shows detail when
Highlights is pulled down, in the preview and in the export; the
tone stage matches its CPU reference on the GPU; the whole suite passes
on both renderers.

### Phase 4. Highlight reconstruction (M)

Depends on Phase 2. Can run beside Phase 3.

1. **Decode keeps everything.** No clamp at white. The white level is
   read from the file where it has one. The level at which each channel
   clips, after white balance, is recorded with the photo.
2. **Reconstruction in camera RGB**, before the camera profile, from a
   published method. The recommendation is the "opposed" inpainting
   darktable uses by default: cheap, and good on the common case of one
   or two clipped channels. It is implemented from the method's
   description, not from darktable's code, which is GPL and cannot be
   copied into this repository (decision 5).
3. **The grey-out goes.** The RAW step's highlight desaturation is
   removed; reconstruction and the tone curve's shoulder do its job.
4. **The white balance picker and Auto white balance** stop treating
   reconstructed pixels as measurements.

Done when: a file with a clipped channel in a coloured highlight (a
sunset, a lamp) keeps its hue into the highlight where today it turns
grey or magenta; the reference and the shader agree.

### Phase 5. Local contrast in linear light (M)

Depends on Phase 3.

1. **Large and Small details** act on luminance in stops, after tone,
   with blurs made from the image at that point. This is also what a
   mask's local contrast needs, so the mask and the photo share it.
2. **Haze** moves to scene data (stage 6), where its dark-channel
   estimate means what it claims.
3. **GPU against CPU** for both, which does not exist today.
4. **Noise reduction keeps today's algorithm.** It stays wrapped in a
   display encoding at stage 5, so it behaves as it does now, and moves
   earlier in the chain where the spec puts it. Replacing it is for
   later.

Done when: Large details at +50 on a sky gradient makes no halo around
a dark horizon that today's does; references agree.

### Phase 6. Camera colour (L)

Depends on Phase 2. Done last, by decision: the workflow comes before
measured accuracy. Until then the photo is rendered with the one
daylight matrix per sensor generation the engine has now, converted to
the wider working space.

1. **Two light sources per camera.** The camera profile blends two
   calibration matrices by the white balance, adapts the white point
   (Bradford) and goes to Rec. 2020: the method the DNG specification
   describes. The reader for it exists in `raf/dcp.rs`.
2. **Kelvin becomes real.** Temperature and Tint are the scene's, in
   kelvin, and the profile follows them.
3. **Baseline exposure per camera** replaces the constant 1.3.
4. **DNG joins the pipeline.** Its decode is split as RAF's is: linear
   camera RGB out, its own matrices and baseline exposure as data, and
   the same stages after. A DNG stops being edited as a JPEG.
5. **Measured, not judged by eye.** A ColorChecker shot under daylight
   and tungsten is rendered with a neutral profile and compared with
   the chart's published values. This needs the files (decision 6) and
   the data (decision 4).

Done when: the chart's patches are within a stated error under both
lights; changing Temperature by 1000 K matches a reference raw
converter's change to within a stated tolerance.

### Phase 7. HDR on screen and in files (L)

Depends on Phases 1, 2 and 3.

1. **The canvas is HDR** on WebGPU when the display reports high dynamic
   range: `rgba16float`, extended tone mapping, Display P3. The output
   step lets highlights run above white up to a headroom. On WebGL, and
   on a display without HDR, it rolls them off to white as before.
2. **Headroom.** A page cannot learn the display's, so the output step
   renders to a fixed headroom and the browser limits what the display
   cannot show. The starting value is decision 8.
3. **Seeing both.** A control beside the display type in the status bar
   switches the view between HDR and how an ordinary screen will show
   the photo, since most people who receive it will see that.
4. **The histogram** grows a region to the right of white for the HDR
   range, and the highlight warning marks what clips at the headroom,
   not at white.
5. **HDR exports**, in this order:
   1. **16-bit PNG with `cICP`** for BT.2100 PQ, with the mastering and
      light-level chunks. Our PNG writer already exists; this adds
      chunks and a transfer curve. It is the 10-bit-or-better file.
   2. **JPEG with a gain map** (ISO 21496-1, with the Ultra HDR
      metadata Android reads). It is an ordinary JPEG everywhere and
      HDR where supported, which makes it the one to send to people.
      Whether we write the container ourselves from two browser-encoded
      JPEGs or bring in an encoder is decision 3.
   3. **AVIF, 10-bit PQ.** Needs an encoder the browser does not have
      (decision 3).
6. **The export dialog** gains an HDR choice with those formats, and
   says which programs open each.

Done when: on an HDR display in Chrome, a specular highlight in a RAW
file is visibly brighter than the page's white, and the status bar says
HDR; the PQ PNG opens in HDR in Safari 26 and in Lightroom; the
gain-map JPEG shows as an ordinary photo in Firefox and in HDR in
Chrome.

---

## 5. Decisions needed

Each has a recommendation. None blocks Phases 0 and 1.

1. **Is HDR a way of viewing and exporting one edit, or a second edit?**
   **Decided: one edit, two ways out**, with the view switch in Phase
   7. A per-photo SDR adjustment can be added later if the roll-off
   alone is not enough.
2. **Old edits. Decided: not supported.** The new pipeline replaces the
   old one and the old maths is deleted. The version number stays 1 and
   is tracked for real from launch (Phase 0, item 4). The spec's rule
   (keep every released version's code, offer "update to the latest")
   starts then.
3. **Encoders.** The repository's rule is few dependencies. Recommended:
   write the PQ PNG and the gain-map JPEG container ourselves, and
   decide on AVIF (libavif, BSD) only once those two are in use.
4. **Where the two-illuminant camera data comes from.** The values in
   Adobe's DNG profiles are measurements, but how they may be copied
   and credited needs your decision. RawTherapee and darktable carry
   their own tables under GPL. This decides how much of Phase 6 is
   possible.
5. **Highlight reconstruction method.** Recommended: "opposed"
   inpainting, written from its description.
6. **Files and hardware only you have.** A ColorChecker shot in RAF
   under daylight and tungsten; and someone looking at an HDR display
   in Safari on macOS, where the reports conflict. **Decided: later.**
   The chart is needed for Phase 6 only, which is last.
7. **What the status bar shows at the left.** Lopsy shows zoom, cursor
   and size. Recommended for Photonamous: in the Edit view, the photo's
   pixel size and the working size; in the library, the count of
   photos shown and selected.
8. **Starting HDR headroom.** Recommended: two stops (4 times white),
   which most HDR laptops and phones reach, adjustable in Settings.
9. **A GPU with no float render targets.** Recommended: keep today's
   baked fallback, and say "8-bit" in the status bar.

---

## 6. What will have to be re-based

Tests that hold a rendered number and will move when the maths does.
They are re-based in the phase that moves them, not before.

- Engine: `engine/core/tests/raf_develop.rs` (the linear path must match
  the baked one: this stays true for Lopsy's path and is dropped for
  Photonamous's in Phase 3); `engine/tests/render.rs` (RAW step
  tolerance; area layer); `engine/core/src/raf/develop.rs` unit tests
  (0.18 encodes to 0.4613).
- Photonamous browser tests: `edit-raf.spec.ts` (exposure and white
  balance deltas), `white-balance-raf.spec.ts` (as-shot about 4970 K:
  changes in Phase 6), `white-balance.spec.ts`, `edit-view.spec.ts`,
  `edit-areas.spec.ts` (pixel readout of a flat colour within 8),
  `edit-finish.spec.ts`, `edit-clipping.spec.ts`,
  `export-tiff.spec.ts`.
- Must not move: `grade-alpha.spec.ts` (an unedited photo returns
  within 1/255), and every Lopsy test.
- Unit tests: `raw-develop.test.ts`, `recipe-to-adjustments.test.ts`.
  `recipe.test.ts` pins the default recipe's hash, which does not
  change while the version stays 1.

---

## 7. Risks

- **Speed.** More passes, all in float. Each phase measures a frame at
  working size and a full-size export against today's, on WebGL and
  WebGPU. A mask's layer already costs a pass per mask.
- **Half-float precision.** About 11 bits within each stop. That is
  enough for linear data, but a long chain of copies can accumulate
  error; the golden renders catch drift.
- **Safari's HDR canvas** may not light up on macOS. The plan does not
  depend on it: Safari falls back to Display P3 SDR and still gets
  correct colour and HDR files.
- **Firefox** shows no HDR at all and has gaps in WebGPU. It gets the
  WebGL path and correct, tagged SDR.
- **The size of Phase 2.** It touches both ends of every path. The
  wrappers exist so it can land without changing any stage's maths, and
  be checked against the golden renders before anything creative
  changes.
- **Two tone systems in one engine.** Lopsy's and Photonamous's sliders
  with the same names will differ. That is deliberate; the engine's
  develop notes must say so.

---

## 8. Progress, and decisions taken while building

Kept as the work goes. "Decided" means a choice made without asking, for
Seamus to review; each says what was chosen and what the other course
was.

### Done

- **Phase 0, items 5 to 7** (the test bed): golden renders of the eight
  sample RAF files times four sets of settings
  (`engine/tests/golden.rs`, fingerprints in `engine/tests/golden/`);
  every develop stage compared with its CPU reference on the GPU; the
  two screen-less failures fixed.

- **Phase 0, items 1 to 3 and 8**: files tagged P3 or Rec. 2020 hold
  pixels in that space; real sRGB (v4, piecewise curve) and Rec. 2020
  profiles; `cICP` in PNG; black levels per colour site; the Bayer
  pattern read from the file.
- **Phase 2, engine**: the linear Rec. 2020 working space
  (`setDevelopWorkingSpace`), the tone step, the input step for photos
  that are not RAW, the display-encoded block for the stages that have
  not moved, the output step, statistics on an sRGB rendering, and the
  float read (`readRenderedF32`).
- **Phase 7, item 5 (the encoders only)**: 16-bit PQ PNG
  (`encodePqPng`), gain maps (`computeGainMap`) and the gain-map JPEG
  container (`assembleGainMapJpeg`) in `lopsy-core`. Not yet wired to
  the export dialog.

- **Phase 1, items 1, 2 and 5**: WebGPU by default with WebGL in the
  same page load when no adapter is offered or the wgpu engine fails
  to start; every read awaited; lost-device recovery; one wasm
  downloaded, not two; the browser suite runs on either renderer
  (`PHOTONAMOUS_RENDERER=webgl` for WebGL).
- **Phase 3, engine**: tone on scene data in stops
  (`engine/core/src/scene_tone.rs`), colour in OkLab, Color by hue,
  colour grading and curves on linear data in one look pass, masks on
  the new maths, Auto tone from scene statistics.

### Decided

1. **The work that was uncommitted when the run began was committed
   first**, as eleven local commits, so each later step has a clean
   base. Nothing is pushed.
2. **A headless engine presents nothing** (rather than being given a
   nominal screen). The histogram and the screen-only views read the
   composite texture, which is what the two failing tests needed.
3. **The golden harness drives the engine crate directly**, not the
   command-line host the plan named: the same code path with less
   plumbing. Its tolerance is 256 of 65535 a cell; that figure is
   reasoned for other GPUs, measured only on this machine's.
4. **Rec. 2020 files use the BT.709/BT.2020 curve** (not gamma 2.4),
   declared exactly by a parametric ICC curve and by `cICP` transfer 1.
5. **Display P3's profile keeps its existing bytes**, and Lopsy's sRGB
   PSD keeps the old gamma-2.2 profile, so no Lopsy export changes. The
   one visible change to Lopsy: its Display P3 16-bit PNG gains a
   `cICP` chunk describing the same space as its profile.
6. **An sRGB PNG carries the `sRGB` chunk only** (no `iCCP` beside it,
   which PNG forbids, and no `cICP`).
7. **A Bayer RAF's pattern is read from the file but is unverified**:
   every sample is X-Trans. A file without the tag decodes as before.
8. **Phase 2 moved some pixels a long way, on purpose.** Typical cells
   of the golden renders moved by under 256 of 65535, but the worst
   moved by up to 12,000: colours above white or outside sRGB, which
   the old chain clipped channel by channel (turning an orange drink
   yellow, banding a sky cyan) and the new one rolls off keeping hue.
   The plan asked that the picture "barely move"; it holds for
   everything except those colours. **Worth a look by eye.**
9. **Gamut compression starts at 95% of the way to the edge** (ACES
   uses about 80%, which visibly paled saturated photos here). Colours
   inside that are untouched.
10. **The SDR roll-off is a hard knee at white** (knee = peak = 1), so
    nothing below white moves. HDR output will set a knee below the
    headroom.
11. **Dither on 8-bit exports only for RAW photos**, one value per
    pixel for all three channels, fixed per position. An 8-bit photo
    passed through unedited is not noised.
12. **The histogram, pixel readout and Auto tone read an sRGB
    rendering** whatever the display, so an edit made with Auto does
    not depend on the screen. The clipping warning marks what the
    screen shows.
13. **HDR PNG carries no ICC fallback** (no small standard profile
    describes PQ). Its mastering luminance is the picture's own peak.
14. **Gain maps are single-channel, on luminance, half size by
    default.** Luminance is exact; a saturated colour pushed far into
    HDR is up to about 10% low in its weaker channels. A three-channel
    map would fix that and can be added.
15. **The ISO 21496-1 byte layout and the MPF index were written from
    memory of the standards** (ISO's is paywalled). Apple's ImageIO
    reads every field back under the right name and rebuilds the HDR
    picture; Chrome and Android are untested. **Needs a person with an
    HDR display.**
16. **A wgpu engine that fails to start falls back to WebGL in the
    same page**, without a reload (the plan said next load, as Lopsy
    does). The tab remembers it in sessionStorage; the Privacy Policy
    says so.
17. **The renderer selector is shared by options on Lopsy's plugin**,
    not by a new workspace package (which would have meant an npm
    install). Photonamous reaches it through an alias into
    `lopsy-web`.
18. **The tone map is six knots in stops** (blacks −5.5, shadows −2.5,
    middle grey, highlights +1.5, white, white + 3) joined by a
    monotone cubic. Slider strengths are first guesses, named at the
    top of `scene_tone.rs`: Highlights −100 pulls white down 1.2 stops
    and three stops above white down 3.2; Shadows +100 lifts shadows
    1.2; Whites and Blacks move their ends by 1 to 2 stops; Contrast
    ±100 changes the slope by ×1.32 or ×0.76. **To be tuned by eye.**
19. **Temperature and Tint on a photo that is not RAW, and on a
    mask, now have the RAW step's strengths** (0.6 and 0.4 stops at
    ±100). Masks were weaker before (0.3 and 0.25).
20. **A mask's sliders add to the photo's own with no cap**; the tone
    map stays monotonic whatever the total.
21. **Vibrance at +100 doubles a grey-ish colour's chroma** and fades
    out by OkLab chroma 0.2; Saturation −100 is exactly grey.
22. **Color by hue no longer stops at the sRGB gamut edge**; the
    output step maps the gamut. This is most of why the golden set
    with colour edits moved (median cell 458 to 2191 of 65535).
23. **8-bit exports and Flatten now include tone and colour.** They
    used to skip Lopsy's adjustment pass; for Photonamous those
    adjustments are now part of the develop chain proper.
24. **Auto tone sets Exposure, Whites, Highlights, Blacks and
    Shadows, and leaves Contrast alone.** Pressing it twice converges.
