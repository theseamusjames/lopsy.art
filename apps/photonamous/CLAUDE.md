# Photonamous — development rules

A photo library and RAW editor that keeps originals in the user's Google
Drive (or a local folder) and renders edits with the Lopsy engine. This is
a proof of concept of `docs/photonamous-spec.md`; read the spec before
changing the design. The repository's map and the rules that apply
everywhere are in the root `CLAUDE.md`. Running, Google setup, deploying
and testing: `docs/photonamous-setup.md`. What the app does today, feature
by feature: `FEATURES.md` (current behaviour only; keep it up to date when
you change what users see).

## Where things are

| Path | What |
|---|---|
| `apps/photonamous/` | The app: React, TypeScript, Vite |
| `packages/photos-core/` | Storage adapters, the library database, import, export, caches, search, XMP. Plain TypeScript, no React; its tests run in Node |
| `packages/photos-core/README.md` | The maintainer's guide: module map, on-storage format, invariants, undo, untrusted input, testing |
| `packages/photos-core/src/storage/types.ts` | The storage contract every backend implements |
| `packages/photos-core/src/library/types.ts` | The data model and `LibrarySession`, the only way the UI changes the library |
| `packages/photos-core/src/library/recipe.ts` | The edit recipe |
| `packages/photos-core/src/import/types.ts` | Import contracts |
| `packages/ui/` | `@lopsy/ui`, shared with Lopsy: tokens, reset and fonts, the Slider, the Menu, the status bar, and the keyboard and focus helpers (`a11y/`) |

The engine is the wasm package `npm run wasm:build` (or `wasm:build:dev`)
writes into `apps/lopsy-web/src/engine-wasm/pkg/` (WebGL) and
`pkg-wgpu/` (WebGPU); this app imports it as `@lopsy/engine-pkg/…`. It
moves to a shared package in Phase 0 of the spec; until then, read it
where it is.

**Two builds, one page.** As in Lopsy, `@lopsy/engine-pkg/lopsy_wasm`
resolves to a generated module that forwards each call to the build this
page load chose: Lopsy's `scripts/vite-plugin-renderer.ts`, given this
app's choice module, `src/engine/renderer-choice.ts` (`?renderer=`, else
`PHOTONAMOUS_RENDERER`, else WebGPU where the browser offers an adapter;
a wgpu engine that fails to start changes the page to WebGL at once). On
the wgpu build `createEngine` returns a Promise and readbacks answer
later, and the glue's declarations are the WebGL build's: import
`createEngine`, `rendererName` and the readbacks from `src/engine/wasm.ts`,
which types them for both builds and orders reads as Lopsy's
`asyncReadback` does (`apps/lopsy-web/src/engine-wasm/readback-order.ts`).
ESLint refuses them from the glue. A new readback the app uses goes in
`wasm.ts` and in that ESLint list. The RAW workers load the glue by its
`.js` name, past the selector, for the build the page runs.

**Three engines.** The e2e suite runs in Chromium by default, and in
Playwright's Firefox or WebKit with `PHOTONAMOUS_BROWSER=firefox|webkit`
(`e2e/gpu-args.ts`; neither offers a WebGPU adapter there, so both run
WebGL). Specs import `test` and `expect` from `e2e/test.ts`, not from
`@playwright/test`: in WebKit it gives each test a persistent context,
without which the browser's private file system does not open (the specs
with configs of their own, site, offline and roundtrip, run in Chromium
only and keep Playwright's). A spec
that needs Chromium (its flags, CDP) skips itself elsewhere with the
reason (`isChromium`). `docs/photonamous-setup.md` has the details.

**Colour.** Every engine is made by `createDevelopEngine`
(`src/engine/develop-engine.ts`), which turns on the engine's linear
Rec. 2020 working space where the GPU renders to float targets (not on the
8-bit fallback) and tells it what the canvas is (`setScreenOutput`): Display
P3 where the display has it (`@lopsy/engine-wasm/display`, watched), else
sRGB. Anything copied out of the canvas (previews, 8-bit exports) sets the
canvas to its file's space first; nothing relies on the browser converting
it. Browser-encoded PNG and JPEG files are tagged with Lopsy's inserters
(`@lopsy/image-metadata`). The status bar's engine and display state is
`src/engine/engine-status.ts`.

**HDR.** One edit, two ways out (plan decision 1), at one peak,
`HDR_PEAK` (4, two stops above SDR white) in `develop-engine.ts`. Only
the Edit view's engine (`createDevelopEngine(canvas, { isScreen: true })`)
asks for an HDR canvas (`setScreenOutput(…, true)`: wgpu, the working
space and `(dynamic-range: high)`), learns the truth from `screenIsHdr`,
and keeps the SDR canvas when the request fails; the export and preview
engines never ask, and a copy out of the canvas is always taken from an
SDR configuration. `engine-status.ts` holds whether the canvas is HDR and
the status bar's HDR switch (`setDevelopHdr`; in memory, never stored),
and the histogram reads `readHdrHistogram` only while both are on. Auto
tone and every other statistic read the SDR rendering. HDR files
(`hdr-png`, `hdr-jpeg` in photos-core's `ExportFormat`) are made by
`encodeHdr` at the document's full size or smaller, never larger: the
HDR picture is read once, `readHdrOutputF32` at full size or
`readHdrOutputF32Sized` smaller, then `encodePqPng`; or for the gain-map
JPEG `compositeForExport` (or `compositeForExportSized` at the same size)
and `computeGainMap`, the ordinary sRGB JPEG export at that size as the
base, the gain map's grey PNG encoded by the browser, then
`assembleGainMapJpeg`. The sized reads re-composite, so they wait their
turn (`wasm.ts`).

**Recipe to engine.** `src/engine/develop-stages.ts` is the one place
that maps the recipe's tone, colour and curves onto the engine, and it
has two paths, chosen once per engine with the working space
(`developPathFor`). With it ('linear'): `setDevelopTone`,
`setDevelopLook` and `setDevelopCurves` (4096-entry float tables sampled
from the app's curve splines, `buildCurveTable`), per mask
`setDevelopAreaLook` and `setDevelopAreaCurves`, and Auto tone from
`readSceneStatistics` + `autoToneScene`. Without it ('legacy', the 8-bit
fallback): Lopsy's image adjustments (`recipe-to-adjustments.ts`), the
256-entry curves LUT, `setImageColorMixer`, `setImageColorGrading`, the
`setImageArea…` look setters and the histogram's `autoTone`; with the
working space on these change nothing. Keep the two apart
(`applyLinearStages` and `applyLegacyStages` in `develop-engine.ts`) so
the fallback can be deleted in one cut. Detail, local contrast, haze, the
finish, the masks' built-in sliders and the RAW develop stage take the
same calls on both. A RAW photo's exposure and white balance stay in
`setRawDevelop`; `setDevelopTone` carries them only for other photos.

**The RAW path.** RAF, DNG and Sony ARW open through the engine's
format-neutral RAW interface (`raw…` exports), and nothing in
`src/engine` or `src/edit` names a format: what differs comes from the
file's description (`src/engine/raw/raw-format.ts`, `RawDescription`).
`rawPrepare` runs in a worker (`raw/raw-worker.ts`), bands are planned
with `rawPlanBands` and rendered by every worker (`raw/raw-decode.ts`; a
plane row is `planeWidth × samplesPerPixel` values). The white balance
follows the description's model (`raw/raw-white-balance.ts`): a fixed
matrix takes `wbRatioFor` and the profile's matrix; one that follows the
white asks `rawWhiteBalance` for each white's gains and matrix; Kelvin is
fitted, measured or absent. The Profile menu is the description's
profiles by their roles (`profiles.ts`; the camera's entry is the
recipe's `standard`). The baked decode (`decodeAndUploadRawBaked`) is
only a fallback: a file `rawPrepare` refuses, and a format that renders
no finished bands (`rawRendersFinishedBands`) on a GPU without float
targets. `e2e/raw-parity.spec.ts` pins every format's render exactly.

**Photos larger than the GPU.** One threshold, in `src/engine/full-size.ts`:
a photo whose own long edge is larger than `editableLimit(textureLimit)`
opens at the largest size the GPU can edit (the held image), and the
export renderer's engine, created with `tiledExports`, makes its exports
larger than that at its own size in tiles (`src/engine/tile-plan.ts`,
`develop-engine.ts` `encodeTiled`; plan section 10). A photo that fits
takes today's path, the same calls in the same order: keep the tile code
behind that decision, and keep the Edit view's engine off it. A tile's
pixels come from the RAW frame (`raw-decode.ts` `openRawFrame`) or the
browser's decode, never cropped in TypeScript; its reads go into the
engine's whole-picture assembly (`assembleExportTile`) or a 2D canvas,
never through JavaScript. Development builds take `?texture-limit=N` to
act as a GPU of that limit (`develop-override.ts`), which is how
`e2e/export-tiles.spec.ts` reaches tiles on any machine; it compares
tiled exports with whole ones, the same bytes on a hardware GPU
(`PHOTONAMOUS_GPU=hardware`) and SwiftShader's measured rounding
otherwise.

The UI this app shares with Lopsy is `packages/ui` (`@lopsy/ui`, see its
`README.md`): the design tokens, reset and fonts (`src/styles/index.css`
imports them), the Slider, the Menu, the StatusBar, and the keyboard and focus helpers
(`@lopsy/ui/a11y/…`). It is Lopsy's as much as this app's: don't restyle
it here, and don't change it for this app's sake alone. A component Lopsy
could use too goes there; one only this app uses stays here.

## Rules

- Everything in `apps/lopsy-web/CLAUDE.md` under Language & Types,
  Styling, Components, Icons and Code Style applies here too: strict
  TypeScript with no `any`, CSS Modules on the shared tokens, named
  exports, one component per directory, no new dependencies.
- **Storage only through `StorageAdapter`.** Only `storage/google-drive/`
  and `auth/` know about Google. Everything else must work unchanged on
  the local-folder and memory adapters.
- **The library only through `LibrarySession`.** UI code never writes
  journal files or IndexedDB itself.
- **Pixels stay out of TypeScript** (root `AGENTS.md`). Decode and encode
  through browser APIs (`createImageBitmap`, `OffscreenCanvas.convertToBlob`)
  or the engine; no `ImageData` and no per-pixel loops.
- **Originals are never modified or permanently deleted.** Delete means
  the adapter's `trash`.
- **Tests never talk to Google.** Unit tests use the memory adapter or
  the fake Drive in `packages/photos-core`. E2E tests use the local
  adapter in the browser.
- **Production is Google Drive only.** The libraries on this computer
  (This browser, A folder) are offered by development builds, and by a
  production build made with `VITE_LOCAL_LIBRARIES=true` for the site
  tests (`storageEnv` in `src/app/backend.ts`). Don't build a feature that
  needs one of them in production.
- **The Privacy Policy is kept true.** `privacy.html` (served at
  `/privacy`) says what the app asks Google for, what it stores on the
  device and in Drive, and every party the page talks to. A change to any
  of those (a scope, a host in `public/_headers`, something new kept or
  sent) changes that page in the same commit. `terms.html` is `/terms`.
  Both are plain HTML with no script, listed as `DOCUMENT_PAGES` in
  `vite.config.ts`; the service worker leaves them to the network.
- **Accessibility: WCAG 2.2 AA.** `e2e/accessibility.spec.ts` runs
  axe-core on every view and must pass; add the states a new view or
  dialog brings to it. What it can't see is a rule too:
  - every function works from the keyboard, and anything done by dragging
    also has a field, slider or button (crop edges, curve points and areas
    show how);
  - text uses the `--ph-*` tokens in `src/styles/index.css` (4.5:1), not
    `--color-text-disabled`; a filled button uses `@lopsy/ui`'s
    `--color-primary-*` or `--color-danger-*`, as Lopsy's does; and every
    control is at least 24 × 24 px;
  - every focusable element shows the `--ph-focus-ring` ring; never set
    `outline: none` without one;
  - dialogs use `Modal`, menus `@lopsy/ui/Menu` or `use-menu-keys`,
    radio groups `radio-keys` (both `@lopsy/ui/a11y/…`), toggles
    `IconButton`'s `pressed`; status and errors go through `showToast` /
    `showErrorToast` or a live region, not colour alone;
  - sliders are `@lopsy/ui/Slider`, in the Edit view through
    `edit/EditSlider` (this app's readouts, one commit per change);
  - new single-character shortcuts go in `src/shortcuts/registry.ts`, so
    the help lists them and Settings > Keyboard can turn them off.
- **A click pays for one popup.** The Google token is renewed from the
  user's clicks (`src/app/real/gesture-refresh.ts`): once it is 45 minutes
  old, a click anywhere opens Google's window for a moment. A control
  that opens a popup, a file dialog or writes to the clipboard *after
  waiting for something* would lose its click to that, so it sits inside
  a menu or a dialog (both are left alone) or carries
  `data-keeps-gesture`. One that does so at once in its handler needs
  nothing.

## Storybook

Every component has a `.stories.tsx` beside it (`apps/lopsy-web/CLAUDE.md`).
Components that read the library use `src/stories/fake-library.tsx`: the
`?backend=fake` library, seeded and opened in the store, never real
storage. Known gap: `LibraryScreen` (the whole screen, made of storied
parts). `DocumentList`, `DropZone` and `ImportStrip` render nothing until
there is a document, a drag or an import.

## Commands

```bash
npm run wasm:build:dev     # the engine, once (or after engine changes)
npm run dev:photonamous    # http://localhost:5174; npm run dev starts Lopsy with it
npm run test:photos        # Vitest: packages/ui, photos-core, then the app
npm run typecheck:photos
npm run lint:photos
npm run storybook:photos        # Storybook on port 6007
npm run build-storybook:photos  # static build (storybook-static/; delete it after)
npm run test:e2e:photos    # Playwright, on WebGPU (the app's default)
PHOTONAMOUS_RENDERER=webgl npm run test:e2e:photos   # Playwright on WebGL
PHOTONAMOUS_BROWSER=firefox npm run test:e2e:photos  # in Playwright's Firefox (or webkit); both run WebGL

# The production build, as photonamous.com serves it (spec 6.3)
npm run build:photos       # apps/photonamous/dist; the engine must be built first
npm run serve:photos       # that dist/ the way Cloudflare Pages serves it (_redirects, _headers), port 4180
npm run test:e2e:site      # builds, runs site.spec.ts and offline.spec.ts against it (playwright.site.config.ts), cleans up

# The start screen's video, recorded from the app: docs/photonamous-demo-reel.md has the whole recipe
REEL_PHOTOS=<library folder> REEL_HERO=<DSCF8078.RAF> npm exec -w photonamous -- playwright test -c e2e/demo-reel.config.ts

# The link preview, public/og-image.jpg, made from the app (docs/photonamous-setup.md, section 3)
OG_RAW=<DSCF8078.RAF> npm exec -w photonamous -- playwright test -c e2e/og-image.config.ts
```

The service worker (`src/sw/`, emitted as `/sw.js` by
`scripts/vite-plugin-service-worker.ts`) runs only in production builds.
It precaches the app shell and never handles Google hosts or Drive content.

Photonamous is served at `/` on its own origin, photonamous.com, by its own
Cloudflare Pages project; Lopsy is on lopsy.art, and the two talk only
through handoff messages. Pages serves `public/_redirects` and
`public/_headers` as written. The Content-Security-Policy is there: a new
Google host or script source goes in `public/_headers`, and
`test:e2e:site` fails on any CSP violation. Production deploys
Photonamous, and Lopsy hands off to it, only when the repository variable
`DEPLOY_PHOTONAMOUS` is `true` (`.github/workflows/deploy.yml`, setup
guide §4).
