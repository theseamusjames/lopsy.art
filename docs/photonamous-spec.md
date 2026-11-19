# Photonamous: spec

Status: proposal, written 2026-11-18. A proof of concept was built the
same day; Appendix B says what exists and where it departs from this
design. The app is served from its own domain, photonamous.com (6.3).

Photonamous is a photo library and RAW editor that runs in the browser.
It keeps every original in the user's own Google Drive and renders every
edit with the Lopsy engine. It covers the workflow of a desktop photo
library and RAW developer: bring photos in, sort out the keepers, develop RAW files without
touching the originals, and export. It uses its own interface and
vocabulary. When a photo needs layers, text or compositing it goes to
Lopsy and comes back.

How to read this: sections 1 to 3 are the product decisions; 4 is what
the repository already has; 5 is the product as a user sees it; 6 to 9
are the design; 10 to 15 are the plan. Facts about Google's and the
browsers' behaviour that the design leans on are listed, with sources, in
Appendix A. Re-check them before building on them.

## Contents

1. [Decisions at a glance](#1-decisions-at-a-glance)
2. [Principles](#2-principles)
3. [Scope](#3-scope)
4. [What exists today](#4-what-exists-today)
5. [The product](#5-the-product)
6. [Architecture](#6-architecture)
7. [Data model](#7-data-model)
8. [Engine work](#8-engine-work)
9. [Changes to Lopsy](#9-changes-to-lopsy)
10. [Testing](#10-testing)
11. [Performance budgets](#11-performance-budgets)
12. [Phases](#12-phases)
13. [Risks](#13-risks)
14. [Open questions](#14-open-questions)
15. [Setup checklist](#15-setup-checklist)
- [Appendix A. Facts to re-check](#appendix-a-facts-to-re-check)
- [Appendix B. Proof-of-concept status](#appendix-b-proof-of-concept-status)

---

## 1. Decisions at a glance

| Topic | Decision | Why |
|---|---|---|
| Where it runs | A static app on Cloudflare Pages at `photonamous.com`, built from this monorepo and deployed by the same job as Lopsy. | Serving it needs no server code. Its own origin keeps a script-injection bug in either app away from the other's storage and token (6.3, 6.13). |
| Code | `apps/photonamous/`, with shared code moved into `packages/`: the engine bridge, the UI kit, the handoff protocol, and the Drive and library code | Matches the migration plan's direction (an engine with several consumers). Each app keeps its own rules and tests. |
| Sign-in | Google Identity Services, token model, entirely in the browser | No server. Tokens last about an hour and there is no refresh token. The app works around this (6.4); an optional stateless sign-in helper removes it (open question 2). |
| Drive access | The `drive.file` scope only | Google's recommended, non-sensitive Drive scope. No restricted-scope review or yearly security assessment. The app sees only files it created or the user picked. |
| Drive layout | `Photonamous/` holding `Originals/`, `Lopsy documents/`, `Exports/` and `Library data/` | The user can see and understand it; nothing is hidden in app-only storage. |
| Database | An append-only change journal per device, plus snapshots, in `Library data/`; an IndexedDB mirror on each device | Drive has no transactions, locks or conditional writes. Files that only one device ever writes cannot conflict. |
| Edits | Recipes (JSON parameters) rendered by the engine. Originals are never modified. | Non-destructive by construction. Recipes are small and merge field by field. |
| Rendering | A new scene-referred develop pipeline in the engine (`engine/src/develop/`), shared by both apps and the CLI host | One engine, one look. It also starts Phase 7 of `docs/engine-migration-plan.md`. |
| Handoff to Lopsy | `window.postMessage` between the two tabs. Photonamous sends the developed photo as 16-bit pixels. Lopsy sends back a `.lopsy` and a flattened 16-bit render, and Photonamous stores them in Drive. | Works the same whether or not the apps share an origin. Lopsy needs no Google sign-in and no Drive code, so it stays an app with no account. |
| Formats at launch | RAF, DNG (CFA and Linear, including Apple ProRAW), JPEG, PNG, WebP | What the engine and browsers decode today. |

## 2. Principles

1. **The photos stay the user's.** Originals, edits and the library
   database live in a folder in the user's Google Drive that they can
   see, back up and take elsewhere. No Lopsy server ever receives a photo
   or its metadata; the only network peer is Google.
2. **Originals are never changed.** Edits are recipes. The app never
   permanently deletes a file: "Delete" moves it to Drive's trash, where
   Drive keeps it for 30 days.
3. **Local first.** The UI reads and writes local state, and Drive sync
   runs behind it. The only thing that waits on the network is opening
   an original that is not on this device yet.
4. **One engine, one look.** The grid, the editor, exports, Lopsy and the
   command-line host all render a recipe with the same code, so a recipe
   gives the same pixels everywhere.
5. **Lopsy's own design.** `AGENTS.md`: Lopsy does not copy the UI,
   terminology or feature design of other programs. This app replaces a
   workflow, not an interface. It uses plain names and is designed for
   someone who has never used a RAW editor (5.8 lists the words).
6. **Nothing is lost.** Every change is appended to a journal, no device
   overwrites another device's data, and an edit made offline waits on
   the device until it syncs.

## 3. Scope

### Goals for 1.0

- Sign in with Google. The app creates one library folder in My Drive and
  manages it.
- Import from the computer (files, folders, memory cards) and from Drive.
  Skip duplicates. Keep RAW+JPEG pairs together.
- Browse, cull, rate, label, add keywords, make albums, and search and
  filter by metadata.
- Develop RAF, DNG, JPEG, PNG and WebP non-destructively: profile, white
  balance, tone, curves, colour, colour grading, sharpness and noise,
  lens corrections, framing, finish, local adjustments ("areas") and
  spot fixes. Versions, history, presets, and copy and paste of edits.
- Export JPEG, PNG and 16-bit TIFF to Drive or to the computer, with
  presets.
- Use the same library from several devices; keep working offline and
  sync later.
- Round trip with Lopsy at 16 bits: "Edit in Lopsy" and back, with the
  result stored next to its source photo.

### Not in 1.0

- Any server that stores or processes photos. The optional sign-in helper
  (6.4) stores nothing and never sees Drive data.
- Libraries on shared drives; sharing a library with other people; any
  collaboration beyond a view-only share link to an export.
- Watching a Drive folder for files added outside the app. That needs a
  restricted Drive scope (open question 4).
- Video and audio. Files that are not images are skipped at import, with
  a count.
- RAW formats other than RAF and DNG, and HEIC (open question 3). Users
  with other cameras can convert to DNG first.
- A phone layout (tablet comes after 1.0), printing, tethered capture,
  face recognition and plug-ins.
- HDR editing and HDR export. The pipeline is built so they can come
  later without a rewrite (Phase 6).

## 4. What exists today

The engine and app already hold much of what this needs. The table says
what each piece is and what it lacks for this app.

| Need | In the repository | Missing for Photonamous |
|---|---|---|
| Fujifilm RAF decode | `engine/core/src/raf/`: X-Trans Markesteijn demosaic, Fujifilm 14-bit lossless decompression, CFA-phase detection, as-shot white balance. A worker pool renders row bands bit-identically (`apps/lopsy-web/src/io/raf-decode.ts`). | The decode bakes a final look and clamps it to 0..1: film-simulation saturation, a 1.3× exposure boost, highlight desaturation, base curve, sRGB gamma, capture sharpening. Develop needs it to stop at linear, unclamped camera RGB. Lossy and 12-bit compressed RAF are unsupported. |
| DNG decode | `engine/core/src/dng/`: CFA and Linear DNG (Apple ProRAW), lossless JPEG, deflate, LinearizationTable, ForwardMatrix and ColorMatrix paths | Bilinear Bayer demosaic only. Opcode lists (lens correction data) are not applied. Only iPhone ProRAW has been tested. Lossy JPEG and JPEG XL DNGs are unsupported. Also clamps to 0..1. |
| White-balance presets | `engine/core/src/raf/wb_presets.rs`: 341 measured presets across 49 Fujifilm bodies | Compiled in but nothing calls it. It becomes the White balance presets. |
| Camera profiles | `engine/core/src/raf/dcp.rs`: a complete DCP reader (matrices, tone curve, hue/sat maps, look table) | Parse-only, with no consumer. It becomes the Profile control. |
| Camera looks | `engine/core/src/raf/base_curves.rs`: film-simulation tone curves and saturation | Baked into decode. They become profiles. |
| Colour matrices | One ColorMatrix per Fujifilm sensor generation (`color_matrix_for_model`) | Temperature and tint in kelvin need two illuminants per camera (8: E9). |
| Adjustments | `engine/src/imaging/adjustments.rs` and `gpu/shaders/filters/adjustments.wgsl`: exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation, curves, levels, hue/saturation, colour balance, black & white, channel mixer, colour grading, vignette | Display-referred: 0..1, gamma-encoded, 256-entry LUTs, clamped (`apps/lopsy-web/docs/hdr-support.md`). Useful as reference math; develop needs float versions without clamping. |
| GPU plumbing | The pass layer, typed uniforms, WGSL shaders, a wgpu (WebGPU) backend with a WebGL fallback, async readbacks, an HDR canvas on wgpu | One document and one canvas per engine instance; `createEngine` takes only an `HtmlCanvasElement`. Background rendering needs a worker-hosted or headless engine (E1). |
| Encoders | `engine/core/src/export.rs`: 16-bit PNG, ICC profiles (sRGB, Display P3, Rec. 2020, linear). The browser encodes JPEG and WebP, and `apps/lopsy-web/src/utils/image-metadata.ts` adds ICC and comments. | No TIFF writer. No EXIF or XMP writer. |
| Thumbnails | `engine/src/document/thumbnail_gpu.rs`: box-filtered GPU thumbnails | Fine as is. |
| UI components | `Slider`, `NumberInput`, `CurveEditor`, `ColorWheel`, `ColorPicker`, `ContextMenu`, `Toasts`, `ModalHost`, `Button`, `IconButton`, and the keyboard-shortcut customization system | Live inside `apps/lopsy-web/src`; need moving to a shared package. |
| Command-line host | `engine/hosts/cli` runs the engine on a native GPU | No `develop` command yet. Golden-image tests will use one (10). |
| Persistence | `localStorage` only. No IndexedDB, OPFS, Cache API or cookies anywhere in the app. | Photonamous needs IndexedDB and OPFS. Lopsy needs no new storage (6.12). |
| Lopsy's project format | `.lopsy` v2: JSON manifest plus gzipped layer pixels | Stores 8 bits per channel, so a 16-bit round trip would lose precision. Needs v3 (L2). |
| Cloud and accounts | None. Lopsy is "no account". | Everything in 6.4 to 6.8. |

Two facts shape the plan. Lopsy has never stored anything beyond a few
`localStorage` keys, so storage, sync and accounts are all new. And the
engine is one document per instance; the migration plan's Phase 7 ("Started
when a second app is actually being built") is where that changes. This
app is that second app.

## 5. The product

### 5.1 First run

1. The user opens the app at `photonamous.com` and sees a short
   page: what the app does, that photos live in their own Google Drive,
   and a **Sign in with Google** button.
2. Google's consent screen asks for the basic profile and "the specific
   Google Drive files you use with this app". If the user unticks Drive,
   the app explains why it needs it and offers to ask again.
3. The app looks for an existing library: a folder this app created and
   tagged as one (6.5). If there is none, it creates `Photonamous` in My
   Drive with its four subfolders and a `README.txt`.
4. The empty library shows one action: **Import photos**, with a hint
   about dropping a folder or a memory card on the window.

### 5.2 Library

**Views.**
- **Grid**: thumbnails with a size slider and a sort order (capture time,
  import time, file name, rating, last edited).
- **Single**: one photo, fit to the window or zoomed.
- **Compare**: two to four photos side by side, with zoom and pan locked
  together.
- **Cull mode**: Single view, full screen. Rating or setting a photo
  aside moves to the next one, so a shoot can be sorted with one hand.

**Marks.**
- A rating from 0 to 5 stars.
- A colour label, one of five colours.
- **Set aside**, for photos the user does not want. They leave "All
  photos" but stay findable. **Delete set-aside photos** moves them to
  Drive's trash after a confirmation that names the count and total size.

**Organizing.**
- **Albums** are hand-picked and can hold a particular version of a photo.
- **Saved searches** are rules: rating, label, set aside, date range,
  camera, lens, focal length, ISO, file type, keyword, edited or not,
  has a location, in an album.
- **Keywords** are flat in 1.0; `parent/child` paths come later.

**Finding.** The sidebar lists All photos, Recent imports, Imports (one
entry per import), Dates (year, then month, then day), Albums, Saved
searches, Keywords and Set aside. A filter bar takes free text (file
name, title, caption, keywords) and facets (camera, lens, rating, label,
file type, edited).

**Stacks.** A RAW and the JPEG shot with it show as one tile, with the RAW
in front. A Lopsy document made from a photo joins that photo's stack.
Versions show as a count on the tile.

**Info panel.**
- Read from the file: camera, lens, exposure, dimensions, file size,
  capture date and location.
- Editable: title, caption, keywords, rating and label.
- **Show in Drive**, which opens the original in drive.google.com.

**Badges.** Uploading (with progress), on this device or not, edited,
versions, missing (the original is in Drive's trash or gone).

**Keyboard.** Every action has an entry in the shortcut registry and can
be rebound through the customization system Lopsy already has. Ratings
use the number keys, arrows move, Enter opens Edit and Escape goes back.
The other defaults are settled in design review.

### 5.3 Import

**Sources:**
- Drop files or folders anywhere on the window.
- **Import photos** picks files, or a folder (`showDirectoryPicker` in
  Chromium, `<input webkitdirectory>` in other browsers).
- **Add from Google Drive** uses the Google Picker with multi-select.

**Before it starts**, a sheet shows:
- How many photos and their total size, and whether the Drive quota has
  room.
- Duplicates found, which are skipped by default.
- RAW+JPEG pairs found: keep both (default) or RAW only.
- The destination pattern: by capture date by default (6.5).
- Optional: an album to add them to, keywords, and a preset to apply.

**While it runs:**
- Each photo appears in the grid at once, showing the preview its camera
  embedded in the file.
- A progress strip shows uploaded count, data left and an estimate, with
  pause and resume.
- The user can rate and edit photos straight away. Until Drive has a
  photo, its local staged copy serves as the original.
- Closing the tab while uploads are pending asks for confirmation;
  reopening resumes them where they stopped.

**Afterwards:**
- A photo counts as uploaded only when its SHA-256 matches the checksum
  Drive reports.
- Failures are listed with the reason and a retry.

**Adding from Drive:** files picked with the Picker are adopted. They are
moved into `Originals/` (default) or left where they are and only
referenced. The user chooses once and can change it in Settings.

### 5.4 Edit

The Edit view is built for developing RAW files.

**Layout.**
- The image in the middle, with a filmstrip of the current view along
  the bottom.
- On the right: a histogram with shadow and highlight clipping toggles,
  then the control groups.
- On the left, collapsible: Presets, Versions and History.
- A toolbar holds:
  - viewing: before and after (toggle and split), clipping warnings, zoom
    (fit, 100 %, 200 %);
  - tools: Crop, Straighten, Areas, Spot fixes, white-balance picker;
  - actions: Copy edits, Paste edits, Edit in Lopsy, Export.

**Control groups.** The final names come out of design review, but they
must be Lopsy's own and must match Lopsy's existing names where the two
apps share a control (Curves, Color Grading, Black & White). Every group
can be switched off, to see what it does, and reset.

| Group | Controls | Notes |
|---|---|---|
| Profile | Standard, Neutral (flat, for grading), Monochrome; Fujifilm camera looks from the existing base curves; profiles the user added (DCP files); Amount | The Fujifilm looks are named after the in-camera setting they approximate; confirm the wording (open question 9) |
| White balance | As shot, Auto, presets (Daylight, Cloudy, Shade, Tungsten, Fluorescent, Flash), Temperature (K), Tint, a picker that clicks on something neutral | Presets come from `wb_presets.rs` for Fujifilm bodies and from camera data for others. JPEG, PNG and WebP get relative Temperature and Tint. |
| Tone | Exposure (EV), Contrast, Highlights, Shadows, Whites, Blacks, Auto | Auto sets values the user can see and change |
| Curves | Point curves for luminance, red, green and blue | Reuses Lopsy's `CurveEditor` |
| Color | Vibrance, Saturation; Color by hue (eight hues, each with hue, saturation and brightness); Black & White with a per-hue mix | |
| Color Grading | Shadows, midtones, highlights and global wheels; balance; blending | The same name and wheel (`ColorWheel`) as Lopsy's Color Grading |
| Local contrast | Large details, Small details, Haze | |
| Sharpness & noise | Sharpen (amount, radius, edges only); Noise (luminance, colour, keep detail) | |
| Lens | Distortion, Vignetting, Color fringes; automatic when the file carries correction data | Phase 4. DNG opcode lists first; Fujifilm's embedded data if spike S7 finds it usable |
| Framing | Crop (free or fixed aspect), Straighten (angle, auto-level), Rotate, Flip, Perspective (vertical, horizontal, auto) | Crop and straighten in Phase 2, perspective in Phase 4 |
| Finish | Vignette (amount, size, roundness, feather), Grain (amount, size, roughness) | |
| Areas | Brush, Gradient, Circle, Brightness range and Color range, which can be combined and inverted. Each area has its own Tone, White balance, Color, Local contrast and Sharpness & noise sliders. | Phase 4. Subject and sky selection by an on-device model is later (open question 6) |
| Spot fixes | Heal or Clone a circle or a brushed shape. The source is chosen automatically and can be moved. | Phase 4 |

**Sliders.**
- Drag, type a number, or scrub the label.
- Double-click resets.
- Holding Alt/Option while dragging Blacks, Whites or a sharpening
  control shows what is clipping or what is being sharpened.
- The image updates while the slider moves.

**History.**
- Every change is a step ("Exposure +0.30"), with undo and redo.
- Clicking an earlier step goes back to it. Going back adds steps rather
  than deleting any, so the journal stays append-only (6.6).
- History is kept per version and syncs with it.

**Versions.**
- **New version** copies the current edit under a name ("Black & white",
  "Square crop").
- Versions can be compared side by side. Each one can be exported, put
  in an album or sent to Lopsy on its own.

**Presets.**
- Save chosen groups of the current edit as a preset.
- Hovering over a preset previews it on the image.
- Presets can be applied at import, and sync between devices.
- The built-in presets are few and made for Lopsy.

**Copy and paste.** **Copy edits** asks which groups to copy; **Paste
edits** applies them to one photo or many. Framing, Areas and Spot fixes
are unticked by default because they rarely fit another photo.

**Pixel readout.** The value of the rendered output under the pointer, in
the status bar.

**JPEG, PNG and WebP** get the same groups. White balance becomes a
relative shift, and Profile offers Standard and Monochrome only.

### 5.5 Export

**From** the grid selection or the Edit view.

**Settings:**
- Format: JPEG (quality), PNG (8 or 16-bit), TIFF (16-bit, deflate) or
  WebP.
- Size: original, or a limit on the long edge, short edge or megapixels,
  with "don't enlarge".
- Output sharpening: none, for screen, or for print.
- Colour space: sRGB (default), Display P3, or Rec. 2020 (16-bit formats
  only).
- Metadata: all, copyright and contact only, or none. **Remove location**
  is on by default.
- File names from a template: `{name}`, `{date}`, `{seq}`, `{title}`,
  `{version}`, `{camera}`.

**Presets.** Built in: "Full size JPEG", "Web, 2048 px, sRGB" and "16-bit
TIFF, Display P3". The user's own presets sync between devices.

**Destinations:**
- `Exports/<export name>/` in Drive (default).
- A download: one file, or a `.zip` for several.
- A folder on the computer (Chromium only).

**Afterwards:** **Show in Drive**, and **Copy share link**. The share link
makes the export folder viewable by anyone who has the link, and only
after the user confirms exactly that.

Exports run in the background. The queue survives a reload and is shown
in the sync panel.

### 5.6 Round trips with Lopsy

**Edit in Lopsy** (from Edit or from the grid):
- Lopsy opens in a new tab, or in an open Lopsy tab, with the photo as
  the background layer.
- The photo arrives developed with the version's edits, at full
  resolution and in 16-bit. A first-time option sends the original with
  no edits.
- Lopsy shows a bar: "From Photonamous: DSCF1234". It holds **Save to
  Photonamous** and **Back to Photonamous**. While the bar is shown, ⌘S
  means Save to Photonamous.
- Saving sends a `.lopsy` file and a flattened 16-bit render back to
  Photonamous, which stores them in `Lopsy documents/`. If the Photonamous tab was
  closed, saving opens it again to receive them.
- The result joins the source photo's stack as a document, and can be
  rated, put in albums and exported like any photo.
- Opening that document in Lopsy again opens the `.lopsy`, not a fresh
  render. Saving updates the same Drive file, and Drive keeps the earlier
  revisions.

**From Lopsy, Add to Photonamous** (File menu): Lopsy hands the
document to Photonamous, which signs in if needed and adds it to the library.

**Grade a layer** (Phase 5):
- From the Layers panel, Lopsy sends one raster layer to the Photonamous
  editor. The user grades it with the develop controls and clicks
  **Done**.
- The layer comes back graded, as one history step.
- The recipe is saved on the layer so the grade can be reopened.

### 5.7 Devices, offline and storage

**A second device.**
- Signing in finds the library. The grid fills from the database
  snapshot and the stored previews; nothing waits for originals.
- Opening a photo whose original is not on the device downloads it with
  a progress bar. Its stored preview shows meanwhile.

**Offline.**
- Everything in the database is browsable.
- Originals cached on the device are editable, and proxies make other
  photos editable (Phase 5).
- Changes queue and sync on reconnect.
- The app shell itself loads offline once the Phase 5 service worker
  exists.

**This device** (Settings):
- Keep originals: Recent (default; up to 20 GB, least recently used goes
  first), All (for travel) or None.
- Device name, cache usage, and **Remove this device's copy**.

**Sync panel.**
- Uploads and exports in progress.
- Changes not yet synced.
- Last sync time, and errors with retry.
- Drive storage use, warning at 90 % of quota.

### 5.8 Words the UI uses

The UI uses the middle column. The right column helps engineers map
concepts to what other software calls them; those words do not appear in
the product.

| Concept | In Photonamous | Often called elsewhere |
|---|---|---|
| The parameters of a non-destructive edit | Edits (a "recipe" in code) | develop settings, sidecar |
| A second edit of the same original | Version | virtual copy |
| A photo the user does not want | Set aside | rejected, flagged |
| A hand-made group | Album | collection |
| A rule-based group | Saved search | smart collection |
| A reduced copy that can be edited without the original | Proxy; in the UI, "Edit without the original" | smart preview |
| A revision of the rendering maths | Pipeline version; in the UI, "Editing engine version" | process version |
| Local adjustments | Areas | masks, local adjustments |
| The develop controls | The groups in 5.4 | panels |

## 6. Architecture

### 6.1 Overview

```
 Photonamous tab                                     Lopsy tab
 (photonamous.com)                                    (lopsy.art)
 ┌────────────────────────────────────────┐          ┌──────────────────────────┐
 │ React UI: Library, Edit, Export        │          │ Lopsy editor             │
 │ library store (Zustand, compact index) │ post-    │ handoff: takes 16-bit    │
 │ photos-core:                           │ Message  │ pixels, gives back       │
 │   auth (GIS)    Drive client           │◄────────►│ .lopsy + render          │
 │   journal + snapshots ⇄ IndexedDB      │          │ engine (same wasm)       │
 │   import/upload queue ⇄ OPFS staging   │          │ no sign-in, no Drive,    │
 │ engine (wasm): develop pipeline        │          │ no new storage           │
 │   workers: decode, hash, render        │          └──────────────────────────┘
 └───────────────────┬────────────────────┘
                     │ HTTPS (googleapis.com)
                     ▼
     Google Drive, the user's My Drive
     Photonamous/  Originals/  Lopsy documents/  Exports/  Library data/
```

### 6.2 Code layout and build

```
apps/
  lopsy-web/        Lopsy. Gains the handoff and Save to Photonamous (section 9)
  photonamous/     this app: React, TypeScript, Vite; served at '/' on photonamous.com
packages/
  engine-web/       the two wasm builds, the typed bridge, renderer choice and
                    the decode worker pools, moved from apps/lopsy-web/src/engine-wasm/
  ui/               tokens.css, reset.css, fonts, and the shared components (section 4)
  photos-core/      Google sign-in, the Drive client, the library database
                    (journal, snapshots, IndexedDB) and the import and upload
                    queue. Plain TypeScript, no React. Used by Photonamous only.
  handoff/          the message types and channel both apps use for handoffs
                    (6.12). The only Photonamous code Lopsy imports.
engine/             gains develop/, metadata, and the decode split (section 8)
```

**Workspaces and scripts.** The root `package.json` workspaces become
`["apps/*", "packages/*"]`, and root scripts stop forwarding only to
`lopsy-web`:
- `dev` keeps starting Lopsy; `dev:photos` starts this app.
- `test`, `lint` and `typecheck` run in every workspace.
- `build` builds the engine once, then both apps, each into its own
  `dist/`.
- The deploy job publishes each `dist/` to its own Pages project (6.3).
- PR CI gains Photonamous jobs (lint including the pixel-debt check,
  typecheck, unit tests, an e2e subset), and the pre-push hook runs them.

**Rules.** Photonamous follows the same rules as `apps/lopsy-web/CLAUDE.md`:
- strict TypeScript, CSS Modules on the shared tokens, no new UI or CSS
  libraries;
- pure logic modules with unit tests, and a Storybook story per
  component;
- the pixel-data policy: thumbnails are shown as encoded images in
  `<img>`, and any pixel work goes through the engine.

Phase 0 writes `apps/photonamous/CLAUDE.md` and adds the app to the map
in the root `CLAUDE.md`.

**Why a separate app**, not a second page in `lopsy-web`'s Vite config:
- each product keeps its own rules, stores and tests;
- shared code becomes explicit packages;
- it is the layout the migration plan already aims at.

The second-page route would be cheaper to start but would tangle the two
apps' stores and test suites.

**Engine bundle.** Both apps load the same engine wasm, so the develop
code grows Lopsy's bundle too. That is accepted, measured with
`scripts/check-bundle-size.mjs`, and revisited if the engine grows by
more than 15 %. Each app serves its own copy from its own origin, so a
user who opens both downloads it twice. Browsers partition their caches
by site, so one shared URL would not avoid that.

### 6.3 Hosting on Cloudflare

The app is a static build deployed from this monorepo to its own
Cloudflare Pages project, `photonamous`, at `photonamous.com`. Lopsy stays
in its project, `lopsy-art`, at `lopsy.art`. One deploy job builds and
publishes both. Lopsy goes first, so a failing Photonamous step never holds
Lopsy back.

| | Lopsy | Photonamous |
|---|---|---|
| Pages project | `lopsy-art` | `photonamous`, published by Direct Upload |
| Domain | `lopsy.art` | `photonamous.com`; `www.photonamous.com` redirects to it |
| Routing | `/* /index.html 200` | Its own `_redirects`, with `/* /index.html 200` |
| Google sign-in | None | `https://photonamous.com` is the authorized JavaScript origin |
| Handoff | Its build names Photonamous' URL and trusts only that origin | Its build names Lopsy's URL and trusts only that origin |

The handoff is `postMessage` between two origins (6.12). The app works
from one origin only, because Google sign-in and Lopsy trust
`photonamous.com` alone. The `pages.dev` address and preview deployments
load, but cannot sign in or hand off.

- **Headers.** The app's `_headers` sets:
  - a Content-Security-Policy that allows `self`, `wasm-unsafe-eval`, and
    the Google hosts for sign-in, the Picker and the Drive API;
  - no `Cross-Origin-Opener-Policy` (6.4, 6.12). Lopsy sends none either;
  - long cache lifetimes for hashed assets.

  Spike S1 settles the exact policy before Phase 1.
- **PWA.** The app has its own web manifest, and a service worker at its
  root. Lopsy's worker is on another origin and never sees its pages.
- **Search.** The app is open to search engines from its first deploy.
  `robots.txt` allows everything and points at a one-page `sitemap.xml`.
  The page has a description, and names `https://photonamous.com/` as its
  canonical URL, so the `pages.dev` copy is not listed in its place.
  Neither build gains a root `404.html`: Pages treats a site as an SPA only
  while it has none (`MEMORY.md`).
- **No shared storage.** On different origins the two apps share no
  IndexedDB, OPFS, CacheStorage or cookies. Everything between them
  crosses in handoff messages.

**Optional sign-in helper.** If chosen (open question 2), it is a pair of
Pages Functions (`functions/auth/`) in the `photonamous` project. It is
deployed by the same `wrangler pages deploy`; confirm that the functions
directory is picked up from where the deploy runs.

### 6.4 Sign-in

**Client.** Google Identity Services, token model:
`google.accounts.oauth2.initTokenClient`.
- Scopes: `openid email profile https://www.googleapis.com/auth/drive.file`.
- Google lets users untick individual scopes, so after every grant the
  app checks that Drive was included (`hasGrantedAllScopes`).

**Identity.** The user's stable ID is the `sub` from the userinfo
endpoint. Everything stored on the device is partitioned by `sub`, so two
Google accounts on one browser never mix.

**The token.**
- It lives in memory only, never in `localStorage` or IndexedDB.
- One tab, the sync leader (6.6), requests tokens and shares them with
  the app's other tabs over BroadcastChannel, so several tabs do not
  each open a popup.
- The last email is kept in `localStorage` and passed as `login_hint` to
  skip the account chooser.

**Expiry.** Tokens last about an hour, and the token model has no refresh
token.
- The app asks for a new token ahead of expiry, inside the next click or
  key press, so the browser does not block the popup.
- If the token runs out with no user input, for example during an
  unattended import, network work pauses and a **Reconnect Google Drive**
  button appears.
- Nothing is lost while paused: changes stay in the outbox and uploads
  resume from their last confirmed byte. Spike S2 measures how this
  feels in practice.

**Sign out.** Revokes the token and clears it from memory. **Remove this
device's copy** also deletes this account's IndexedDB and OPFS data. If
changes have not synced yet, it says so and asks for confirmation.

**Optional sign-in helper** (open question 2). Two stateless Pages
Functions using Google's authorization-code flow:
- `auth/callback`, on the app's origin, exchanges the code. The refresh
  token goes into an `HttpOnly`, `Secure`, `SameSite=Strict` cookie,
  encrypted with a key only the Worker has.
- `auth/token` uses that cookie to return a fresh access token to the
  page.

It removes the hourly reconnect, and it stores nothing. It is honest to
say it handles tokens that could in principle reach the user's Drive,
even though it never does. Both token sources implement one `TokenSource`
interface, so the helper can be added later without touching callers.

**Header constraint.** The GIS popup talks back to the page, and the
handoff, between two origins, talks to its opener (6.12).
`Cross-Origin-Opener-Policy: same-origin` breaks both, so neither app may
set it. If the engine ever needs `SharedArrayBuffer`, which requires
cross-origin isolation, sign-in and the handoff have to be redesigned
first.

### 6.5 Google Drive

**Scope.** `drive.file` lets the app see and change only the files it
created and the files the user picked with the Google Picker (or opened
with the app from Drive). The consequences:

- Files the user puts into the library folder through drive.google.com or
  Google Drive for desktop are invisible to the app. They show in Drive
  but not in the library. Settings and the `README.txt` say so plainly,
  and **Add from Google Drive** adopts them.
- The Picker must be used to pick files. Picking a folder has granted
  access to the folder, not to the files in it (spike S3 re-checks).
  The Picker needs an API key restricted to the app's origin, and the
  Cloud project number as its app ID.
- An app that watched a folder would need the restricted `drive` or
  `drive.readonly` scope, with Google's review and a yearly security
  assessment. That is open question 4.

**Layout.**

```
Photonamous/                          lp.role=library
├── README.txt                         what this folder is; don't edit Library data
├── Originals/                         lp.role=originals
│   └── 2026/
│       └── 2026-11-14/
│           ├── DSCF1234.RAF           lp.role=original, lp.asset, lp.sha
│           └── DSCF1234.JPG
├── Lopsy documents/                   lp.role=documents
│   ├── DSCF1234.lopsy                 lp.role=document, lp.asset
│   └── DSCF1234.png                   lp.role=render (flattened 16-bit render of the .lopsy)
├── Exports/                           lp.role=exports
│   └── 2026-11-18 Web/
│       └── DSCF1234.jpg               lp.role=export
└── Library data/                      lp.role=data
    ├── library.json                   library ID, schema version, folder IDs
    ├── settings.json                  readable copy of the synced settings (6.6)
    ├── journal/<deviceId>/<firstSeq>-<lastSeq>.jsonl.gz
    ├── snapshots/<hlc>-<deviceId>.json.gz
    ├── previews/<assetId>.<versionId>.<size>.jpg
    ├── proxies/<assetId>.<ext>        Phase 5
    ├── profiles/                      camera profiles the user added (DCP)
    └── devices/<deviceId>.json        device name, app version, last seen
```

**Tags.** Every file the app creates carries private `appProperties`:
- `lp.lib`: the library ID.
- `lp.role`: the file's role.
- `lp.asset`: the asset ID, where there is one.
- `lp.sha`: the SHA-256, for originals.

All of these fit Drive's limits of 30 private properties per app per file
and 124 bytes per key and value. The tags let a new device find its
library with a single query, and they let the app rebuild the library
from Drive alone if the database were ever lost.

**Names.**
- Originals go into folders by capture date, falling back to the file's
  modification date, then the import date. Settings offer "by import" as
  an alternative.
- A different file with the same name in the same folder gets ` (2)`.
- The name at import is kept in the database.
- Files are tracked by ID, so a rename in Drive changes nothing.

**API use.** Every request names its `fields`.

- Uploads use the resumable protocol:
  - chunks of 8 MiB (a multiple of 256 KiB), three files at a time;
  - session URIs are kept in IndexedDB, so an upload resumes after a
    reload by asking Drive how many bytes it holds;
  - spike S1 confirms the browser can read the session URI under CORS.
- Downloads use `alt=media`, streamed into OPFS with progress. A Range
  request resumes a broken download.
- Changes are read with `changes.getStartPageToken` and `changes.list`:
  - every 30 s while the tab is visible, every 5 minutes while hidden;
  - a full check of `Library data/` every 30 minutes catches anything
    missed.
- `about.get` reports storage quota. `permissions.create` runs only when
  the user asks for a share link.
- A client-side token bucket keeps requests well under the per-user
  limit. Rate-limit errors (403 rate limit, 429) and 5xx responses are
  retried with exponential backoff and jitter, honouring `Retry-After`.
  Appendix A has the current limits and their caveats.

**What the user can do in Drive, and what happens.**

| The user… | The app… |
|---|---|
| Renames or moves a file | Keeps working; files are tracked by ID |
| Puts a file in Drive's trash | Badges the photo "In Drive's trash" and offers **Restore** or **Remove from library** |
| Trashes `Library data/` | Stops writing and asks to restore it, which it can do because it made the folder |
| Deletes a file permanently | Marks the photo missing; its database entry and previews stay until removed |
| Replaces an original's content | Notices the checksum change, re-reads metadata and flags the photo |

### 6.6 The library database

**Why a journal.** Drive has no transactions and no locks, and its API
has no conditional update. Two devices rewriting one database file would
silently overwrite each other's changes. So no device ever rewrites a
file another device wrote: each device appends its own changes to its
own files, and every device merges them all the same way.

**Terms.**
- **Op**: one change, such as setting `asset.rating` to 4. Each op is
  stamped with a hybrid logical clock (HLC): wall time, a counter and the
  device ID. The HLC orders changes from different devices consistently
  even when their clocks disagree.
- **Outbox**: ops written locally but not yet on Drive. It is flushed 2 s
  after the last change, at least every 30 s, and when the tab is
  hidden.
- **Segment**: one gzipped JSON-lines file of consecutive ops from one
  device, `journal/<deviceId>/<firstSeq>-<lastSeq>.jsonl.gz`. Each flush
  creates a new file, because Drive cannot append.
- **Roll-up**: a device periodically merges its own small segments into
  one and deletes the small ones. It only ever touches its own.
- **Snapshot**: the complete merged state, plus a version vector (the
  last sequence number included from each device). A snapshot is written
  by whichever device has applied 5,000 ops since the last one, and the
  last three are kept. Once a snapshot is over 10 MB compressed it is
  split by asset ID.
- **Loading on a new device**: the newest snapshot, then every op after
  its vector.

**Merge rules.** The same ops applied in any order give the same state.
That is a property test (10).
- Fields are last-writer-wins by HLC. This covers rating, label, title,
  and every recipe parameter separately, so exposure changed on a laptop
  and contrast changed on a desktop while both were offline both survive.
- Set membership (keywords, album contents) is last-writer-wins per
  element.
- Deletes are tombstones, and Restore is a later write.
- Adds are idempotent by ID.
- Originals never change, so they cannot conflict.
- A `.lopsy` saved on two devices at once is the only file-level
  conflict.
  - The Drive revision an editing session started from travels with the
    document (6.12).
  - Before uploading a save, Photonamous compares it with the file's current
    `headRevisionId`. If they differ, it saves a copy ("DSCF1234
    2.lopsy") and says so.
  - There is a small race window, because Drive has no conditional
    write; that is documented, not hidden.

**Undo and history.** Undo appends the inverse ops. History is the
version's sequence of steps (ops grouped under a step ID and a label).
Snapshots keep the last 200 steps per version and fold older ones away.

**Versions of the schema.**
- `library.json` holds `schemaVersion`, and every op carries `v`.
- A device running an older app than the library's schema opens it
  read-only and asks the user to reload. It never writes ops a newer
  schema cannot read.
- Migrations run forward only.

**On the device.**
- One IndexedDB database per account, `photonamous:<sub>`, mirrors the
  merged state.
- Object stores: assets, versions, albums, searches, presets, export
  presets, outbox, sync state (the snapshot in use, the last sequence
  seen per device, the changes page token), the upload queue, the export
  queue and previews.
- The grid holds a compact in-memory index of every asset: ID, capture
  time, marks and preview key. That is about 100 bytes per asset, so
  50,000 photos is about 5 MB. Full records are read on demand. Per
  `MEMORY.md`, large data never travels as React props; components take
  IDs.

**Tabs.**
- One tab per library is the sync leader, elected with the Web Locks
  API. It alone talks to Drive.
- Every tab writes its ops into the IndexedDB outbox inside a
  transaction and announces them on BroadcastChannel.
- If the leader closes, another tab takes the lock.

**Settings.**
- Synced settings are ops like any other: import defaults, editing
  defaults per camera, export presets, the shortcut map and UI
  preferences.
- The leader also writes `settings.json` so a person (or a repair tool)
  can read them.
- Device-only settings (cache budget, device name) stay in IndexedDB.

**Repair.** **Rebuild library from Drive**, in Settings, does three
things:
- lists every original by its tags and checks their checksums;
- re-reads every snapshot and segment;
- adopts originals that have no database entry, and marks entries whose
  original is gone.

### 6.7 Storage on the device

**IndexedDB** holds the database mirror, the outbox, the upload and
export queues, and small previews as `Blob`s.

**OPFS** holds the large files, under one directory per account:

| Path | What | Budget |
|---|---|---|
| `/<sub>/originals/<sha256>.<ext>` | Originals on this device | Recent: least recently used beyond 20 GB, or 30 % of the quota, is evicted |
| `/<sub>/staging/<uploadId>` | Imports waiting to upload | Until Drive confirms the checksum |
| `/<sub>/previews/` | 2048 px screen previews | 2 GB, least recently used |

**Keeping the data.**
- After the first import the app calls `navigator.storage.persist()`.
- Everything on the device can be rebuilt from Drive except the outbox
  and staging, which are therefore flushed early.
- Closing a tab with unsynced changes or pending uploads asks for
  confirmation.

**Browser differences** (Appendix A):
- Chrome lets one origin use a large share of the disk.
- Firefox asks the user before granting persistence.
- Safari can delete storage a site's scripts wrote after seven days of use
  without a visit, unless the app is installed. So Safari users are
  offered installation, and the outbox never waits.

**Staging.** Import copies each file into OPFS first, so a reload, crash
or sleeping laptop does not lose the queue. If staging fails for lack of
quota, which is likelier on Safari, the import continues from the
original `File` objects and warns that closing the tab will stop it.

### 6.8 Import and upload

Each file moves through these states:

```
queued → reading → staged → uploading → verifying → done
             ↘ duplicate (skipped)          ↘ failed (retryable | permanent)
```

- **reading** runs in a worker:
  - it identifies the format from magic bytes, not the file extension;
  - it computes SHA-256 with WebCrypto over the whole file (originals
    over 1 GB are refused in 1.0);
  - it checks for duplicates against the database's checksum index;
  - the engine (E5) extracts the metadata and the embedded preview.

  The asset enters the database here and appears in the grid.
- **staged**: the file is copied into OPFS.
- **uploading**: a resumable upload into the date folder, with its tags.
  Folder IDs are cached and created on first use.
- **verifying**: Drive's `sha256Checksum` must equal the local hash.
  Then the staged copy moves into the originals cache, to be evicted
  later like any other.
- **RAW+JPEG pairs**: same base name and capture times within 2 s.
- The queue lives in IndexedDB and resumes after a reload.

### 6.9 Thumbnails, previews and proxies

**At import.**
- The engine extracts the preview the camera embedded: RAF's JPEG, a DNG's
  preview image, or the JPEG itself.
- It produces a 512 px thumbnail and a 2048 px screen preview, encoded the
  way Lopsy's export encodes.
- Both are stored on the device and uploaded to `Library data/previews/`,
  so other devices can browse without originals.

**After an edit.**
- The device that made the edit renders new previews from its live edit
  session, with no extra decode, and uploads them when the user moves to
  another photo.
- Pasting edits onto many photos queues background renders. These use
  the fast reduced decode (E7) and the worker-hosted engine (E1).
- Each preview records the recipe hash and pipeline version it was made
  from. A stale one shows a small "updating" mark until it is replaced.

**Proxies** (Phase 5). A proxy lets a device edit without downloading the
original; export always uses the original. Requirements:
- 2560 px on the long edge, scene-linear;
- at most 3 MB for a 26 MP photo;
- decodes in under 300 ms in wasm;
- no visible banding after a ±2 EV push;
- adds at most a stated amount to the engine bundle.

The codec is chosen by an RFC at the start of Phase 5. The fallback that
needs no codec work is an 8-bit JPEG holding log-encoded data, decoded
with `createImageBitmap(blob, { colorSpaceConversion: 'none' })` so the
stored values arrive untouched (`MEMORY.md`).

### 6.10 The develop pipeline

The develop pipeline lives in the engine (`engine/src/develop/`) and is
the heart of the project. The engine owns the recipe evaluation;
TypeScript holds the recipe as data and passes it in.

**Split decode at the linear boundary (E2).** Today's RAF and DNG decode
runs to a finished, clamped sRGB image. It changes to stop at camera-RGB
linear light, after demosaicing at the as-shot white balance, with:
- no clamping;
- per-channel clip levels recorded;
- the metadata develop needs: as-shot multipliers, camera matrices,
  baseline exposure, film mode, orientation.

What decode used to bake in moves to the develop pipeline:
- the base curve and saturation become profiles;
- the 1.3× exposure boost becomes a per-camera baseline exposure;
- highlight desaturation becomes part of highlight handling;
- capture sharpening becomes the default sharpening.

Lopsy's own RAF and DNG import then becomes "decode, then develop with the
default recipe", and is regression-tested to stay within one 8-bit step of
today's output on the sample corpus (L6).

**Working space.** Linear Rec. 2020 (D65), stored as RGBA16F, with no
clamping until the output transform. Because nothing clips in the middle,
HDR output can come later (Phase 6).

**Fixed stage order.** The order is fixed for a pipeline version. The
engine RFC may refine it before 1.0 ships.

| # | Stage | Space | Driven by | Runs |
|---|---|---|---|---|
| 1 | Decode, black and white levels, linearization | sensor | file | CPU workers, cached per photo |
| 2 | Demosaic at as-shot white balance | camera RGB | file | CPU workers, cached per photo |
| 3 | White-balance correction, highlight reconstruction | camera RGB | White balance | GPU |
| 4 | Camera profile (matrices, hue/sat map, look table) | to linear Rec. 2020 | Profile | GPU |
| 5 | Spot fixes, in source coordinates | linear | Spot fixes | GPU |
| 6 | Lens corrections and geometry (distortion, colour fringes, vignetting, perspective, rotation, crop) | linear | Lens, Framing | GPU, one resample |
| 7 | Noise reduction | linear | Sharpness & noise | GPU |
| 8 | Exposure, haze | linear | Tone, Local contrast | GPU |
| 9 | Tone: profile tone curve, contrast, highlights, shadows, whites, blacks (edge-aware local tone mapping) | linear to rendered (still float) | Tone | GPU |
| 10 | Local contrast (large and small details) | rendered | Local contrast | GPU |
| 11 | Colour: vibrance, saturation, colour by hue, black & white, colour grading | OkLab/OkLCh | Color, Color Grading | GPU |
| 12 | Curves | rendered, display-like encoding | Curves | GPU |
| 13 | Areas: each area's mask times its own stage 3 to 12 changes | as above | Areas | GPU |
| 14 | Sharpening | luminance | Sharpness & noise | GPU |
| 15 | Finish: vignette after crop, grain | rendered | Finish | GPU |
| 16 | Output transform: gamut mapping, transfer function, dither | display or export space | the view or the export | GPU |

**Resolution and speed.**
- **The working image** is sized to the view and capped at 4096 px on
  the long edge. It drives the interactive preview.
- **Zooming** to 50 % or closer renders the visible region from the full
  image, with enough surrounding pixels for blur-like stages.
- **Export** renders at full resolution. In 1.0 that is one texture up to
  the GPU's texture limit; tiled rendering for larger files comes later.
- **Caching.** Stage outputs are cached at boundaries (after 4, 7, 9 and
  11), so moving a slider re-runs only the stages after it.
- **While dragging**, the preview renders at half the working resolution
  and settles at full resolution on release.
- **Neighbours.** The next and previous photos in the filmstrip are
  decoded ahead in the workers.

**Determinism.**
- Every recipe records its `pipeline` version.
- The engine keeps every released version's code paths, so an old edit
  renders exactly as it did. Golden-image tests guard this (10).
- New edits use the newest version. **Update to the latest editing
  engine** is offered per photo or in bulk. It shows the before and
  after, and is itself a history step.

**Colour science** (details in the engine RFC):
- Camera to working space follows the DNG specification's method. The
  camera neutral from white balance gives a correlated colour temperature
  and tint, which interpolate between the camera's two calibration
  illuminants. Then camera to XYZ, Bradford adaptation, and Rec. 2020.
  This is what lets Temperature and Tint read in kelvin, and it needs
  dual-illuminant data per camera (E9).
- Tone and colour operations avoid hue shifts: tone curves are applied
  with a hue-preserving norm, and colour edits work in OkLCh.
- Highlight reconstruction rebuilds clipped channels from unclipped ones
  before the profile. It is implemented from a published method, not
  ported from GPL code (13).
- Output gamut mapping compresses out-of-gamut chroma smoothly rather
  than clipping.

**Commands** (the shape; the engine RFC fixes the signatures):
- `develop_open`
- `develop_upload_base_band`
- `develop_set_recipe`, which returns which stages are dirty
- `develop_render(view)`
- `develop_histogram`, a `Read<…>`
- `develop_sample(x, y)`
- `develop_render_full(scale, region)` for export
- `develop_auto_tone` and `develop_auto_white_balance`, which return
  recipe patches
- the mask and spot commands for Areas and Spot fixes

Each is a function in `engine/src/commands/` with a one-line export in
`engine/hosts/wasm/src/api/`, per `engine/CLAUDE.md`. The CLI host gains
`lopsy develop --recipe r.json in.RAF out.png`.

**Where it runs.**
- The Edit view hosts the engine on its canvas, as Lopsy does.
- Background renders (previews after a paste, exports) use a second
  engine instance in a dedicated worker. On wgpu that is a headless
  device; on WebGL it is an `OffscreenCanvas` (E1).
- Until E1 lands, background work runs on the Edit view's engine while
  the user is idle.

### 6.11 Export

**Rendering.** The engine renders the version at the requested size
(stages 1 to 16, with output sharpening and the chosen colour space and
transfer function) in the worker-hosted engine.

**Encoding.**
- JPEG and WebP: `OffscreenCanvas.convertToBlob` in a worker, as Lopsy's
  export does. Chromium already tags those with an ICC profile, which the
  metadata step must detect and not duplicate (`MEMORY.md`).
- PNG: the engine's 16-bit encoder, and 8-bit PNG as Lopsy does it.
- TIFF: a new 16-bit writer in `lopsy-core` (E10).

**Metadata.**
- An EXIF and XMP writer (E10) copies the chosen subset: camera and
  exposure, copyright and contact, title, caption, keywords, and location
  only when the user keeps it.
- It extends `apps/lopsy-web/src/utils/image-metadata.ts`, which already
  inserts ICC profiles and comments.

**Packaging and queue.**
- A `.zip` for multi-file downloads is written by a small stored (no
  compression) zip writer in `photos-core`. JPEGs don't compress, and it
  avoids a dependency.
- The export queue lives in IndexedDB. A job survives a reload and
  resumes at the next unfinished file.

### 6.12 Handoff protocol

The two apps talk only through `window.postMessage` between a Photonamous tab
and a Lopsy tab. In production they are on different origins (6.3); the
same code runs on one.
Lopsy never touches Google: Photonamous does every Drive read and write.

**The channel.**
- Photonamous opens Lopsy from a click, so popup blockers allow it, with
  `window.open('<Lopsy URL>/?photos-handoff=<id>', 'lopsy-editor')`. The
  named target reuses an open Lopsy tab.
- Lopsy sees the parameter and posts `{ type: 'lopsy:ready', id }` to
  `window.opener`. Photonamous answers with the payload.
- Origin checks:
  - neither side acts on a message whose `event.origin` is not on its
    build-time allowlist;
  - every `postMessage` names its target origin, never `*`.
- Messages carry `protocol: 1` and are schema-checked. Their types live
  in `packages/handoff/`, the only Photonamous code Lopsy imports.

**Photonamous to Lopsy.**
1. Photonamous renders the version at full resolution through its export path
   (6.11), as RGBA half-float pixels in the colour space chosen in the
   handoff options.
2. It sends a header, then the pixels.
   - The header holds the name, size and colour space, the source
     (library, asset, version, recipe hash), and a summary of the camera
     metadata.
   - The pixels go in row bands of at most 64 MB, each a transferred
     `ArrayBuffer`.
3. Lopsy creates a document and uploads each band straight into the
   background layer's texture. The RAF import already does this with its
   bands (`uploadLayerPixelsF32Rect`, plus a half-float variant), so the
   whole image never sits in one buffer.
4. Re-opening a document sends the `.lopsy` file's bytes instead, with
   the Drive revision they came from. Lopsy opens them as a project and
   returns that revision with the save (6.6).

**Lopsy back to Photonamous.**
1. **Save to Photonamous** posts two transferred files to the Photonamous tab:
   - `.lopsy` v3: 16-bit, carrying the source block;
   - a flattened 16-bit PNG.
2. Photonamous does the Drive side:
   - uploads both to `Lopsy documents/`;
   - journals the ops (`asset.add` with `kind: "document"`, or a new
     revision of an existing document);
   - renders a preview;
   - answers `{ type: 'photos:saved' }`, and Lopsy shows "Saved to
     Photonamous".
3. If Lopsy has no Photonamous tab to talk to because the user closed it, Save
   to Photonamous opens one with `?receive=<id>`, and the same handshake
   runs the other way.
4. The source block inside the `.lopsy` tells Photonamous where a document
   belongs, so Photonamous keeps no record of handoffs in flight.

**Add to Photonamous** sends the document like a save, without a source
block, and Photonamous files it as a new document.

**Grade a layer** (Phase 5) runs the same channel the other way:
1. Lopsy sends one layer's pixels.
2. Photonamous opens its Edit view in layer mode.
3. **Done** sends the graded pixels and the recipe back.
4. Lopsy replaces the layer's pixels as one history step and stores the
   recipe on the layer.

**Size.** A 26 MP photo is 208 MB of half-float pixels. Bands keep each
message bounded. Across origins the browser may copy a transferred
buffer between processes; the handoff budget (11) includes that.

### 6.13 Security and privacy

**What leaves the browser.**
- Only Google sees photos, metadata and tokens. There is no analytics or
  telemetry. Error reports stay on the device; **Copy diagnostics**
  produces a JSON report with no tokens and no file names.
- With the optional helper, Cloudflare also handles the refresh token
  (encrypted) and access tokens.

**Limiting what a token can reach.**
- `drive.file` limits any leak to the files this app made or the user
  picked.
- Tokens are kept in memory and shared only over a same-origin
  BroadcastChannel.

**Against script injection.**
- The CSP allows scripts from this origin and Google's sign-in and Picker
  hosts only.
- No HTML from Drive is ever rendered: file names and captions are
  text.
- Handoff messages are accepted only from the other app's origin, sent
  only to it, and schema-checked (6.12).
- Photonamous has its own origin, so a script-injection bug in Lopsy
  cannot reach Photonamous' storage, token or pages, nor one in
  Photonamous reach Lopsy's.
- The service worker checks every cached file against the SHA-256 the
  build wrote into `sw.js` before serving it, and drops it on a mismatch.
  A cache poisoned by an injection bug does not outlive the bug.

**Untrusted input.**
- Everything read from Drive is schema-checked, with size limits, before
  it is applied. Journal segments and snapshots count as untrusted input.
- Strings in Drive `q` queries are escaped.

**Safe by default.**
- Exports remove location unless the user keeps it.
- Share links are created only by an explicit action, with wording that
  says "anyone with the link".

**Google's requirements.** A privacy policy page (needed for the consent
screen), and the consent screen's "In production" status before the
public launch (15).

## 7. Data model

The shapes below sketch the database. Field names are final when Phase 1
lands, and every ID is a UUIDv7 generated on the device.

```ts
interface Asset {
  id: string;
  kind: 'original' | 'document';
  driveFileId: string;
  sha256: string;
  fileName: string;              // as imported
  byteSize: number;
  format: 'raf' | 'dng' | 'jpeg' | 'png' | 'webp' | 'lopsy';
  capturedAt: string | null;     // EXIF DateTimeOriginal, with offset when known
  importedAt: string;
  importId: string;
  width: number;
  height: number;
  orientation: number;
  camera: { make: string; model: string; serial?: string } | null;
  lens: string | null;
  exposure: { iso?: number; shutter?: string; aperture?: number; focalLength?: number } | null;
  gps: { lat: number; lon: number; alt?: number } | null;
  pairedWith: string | null;     // the other half of a RAW+JPEG pair
  source: { assetId: string; versionId: string; recipeHash: string } | null; // documents
  renderFileId: string | null;   // documents: the flattened 16-bit render
  // Marks: last-writer-wins fields
  rating: 0 | 1 | 2 | 3 | 4 | 5;
  label: 'red' | 'yellow' | 'green' | 'blue' | 'purple' | null;
  setAside: boolean;
  title: string;
  caption: string;
  keywords: readonly string[];   // a set: last-writer-wins per element
  deleted: boolean;              // tombstone
}

interface Version {
  id: string;
  assetId: string;
  name: string;
  recipe: Recipe;                // every leaf is its own last-writer-wins field
  createdAt: string;
  deleted: boolean;
}

interface Recipe {
  pipeline: number;
  profile: { id: string; amount: number };
  whiteBalance: { mode: 'asShot' | 'auto' | 'preset' | 'custom'; preset?: string; temperature?: number; tint?: number };
  tone: { exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number };
  curves: { luminance: Point[]; red: Point[]; green: Point[]; blue: Point[] };
  color: { vibrance: number; saturation: number; byHue: Record<Hue, HueShift>; blackWhite: BlackWhite | null };
  colorGrading: ColorGrading;
  localContrast: { large: number; small: number; haze: number };
  sharpness: { amount: number; radius: number; edges: number };
  noise: { luminance: number; color: number; detail: number };
  lens: { distortion: number; vignetting: number; fringes: 'auto' | 'off'; useFileData: boolean };
  framing: { crop: CropRect | null; angle: number; rotate: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean; perspective: Perspective };
  finish: { vignette: Vignette; grain: Grain };
  areas: Record<string, Area>;   // keyed by ID so concurrent edits merge
  spots: Record<string, Spot>;
}

interface Album { id: string; name: string; members: readonly AlbumMember[]; deleted: boolean }
interface AlbumMember { assetId: string; versionId: string | null }
interface SavedSearch { id: string; name: string; rules: SearchRule[]; deleted: boolean }

interface OpEnvelope {
  id: string;                    // `${deviceId}:${seq}`
  hlc: string;                   // sortable: wall time, counter, device ID
  v: number;                     // schema version
  step?: { id: string; label: string };  // groups ops into one history step
  op: Op;
}

type Op =
  | { t: 'asset.add'; asset: AssetFacts }                       // idempotent by ID
  | { t: 'version.add'; version: Omit<Version, 'deleted'> }
  | { t: 'set'; entity: EntityRef; field: string; value: Json } // e.g. field 'recipe.tone.exposure'
  | { t: 'member'; entity: EntityRef; set: string; member: string; present: boolean }
  | { t: 'album.add' | 'search.add' | 'preset.add' | 'exportPreset.add'; record: Json }
  | { t: 'preview.set'; versionId: string; size: 512 | 2048; driveFileId: string; recipeHash: string; pipeline: number }
  | { t: 'import.add'; importId: string; startedAt: string; deviceId: string; count: number };
```

`library.json`:
```json
{
  "libraryId": "…",
  "schemaVersion": 1,
  "createdAt": "…",
  "folders": { "originals": "…", "documents": "…", "exports": "…", "data": "…", "journal": "…", "snapshots": "…", "previews": "…" }
}
```

## 8. Engine work

Sizes: S is days, M is one to two weeks, L is three to six weeks, XL is
more. "Phase" is when it is needed (12).

| ID | Work | Phase | Size |
|---|---|---|---|
| E1 | Run an engine instance in a dedicated worker: accept an `OffscreenCanvas` on WebGL and a headless device on wgpu (`GpuContext::headless()` exists for native). This is the first step of the migration plan's Phase 7. A full `Document`/`Surface` split can follow once a second document is needed in the same instance. | 2 | L |
| E2 | Split RAF and DNG decode at the linear boundary (6.10). Return unclamped camera RGB, clip levels and develop metadata. Move the baked look into profiles and defaults. Lopsy's import keeps its look (L6). | 2 | L |
| E3 | `engine/src/develop/`: the recipe evaluator, stages 3, 4, 8 to 12 and 14 to 16, stage caching, interactive and full-resolution rendering, histogram, sampling, auto tone and auto white balance | 2 | XL |
| E4 | Framing: crop, straighten and rotate in stage 6 (perspective comes with E11) | 2 | M |
| E5 | `lopsy-core::metadata`: EXIF, TIFF, GPS and XMP reader; Fujifilm makernote (film mode, dynamic range, lens); embedded-preview extraction for RAF, DNG and JPEG; one normalized JSON output | 1 | M |
| E6 | Profiles: wire the DCP reader into stage 4; Standard, Neutral and Monochrome; Fujifilm looks from the base curves; user DCPs | 2 | M |
| E7 | Fast reduced decode for previews: bin the mosaic (2×2 Bayer, 3×3 or 6×6 X-Trans) without demosaicing, for previews and thumbnails in around 100 ms | 2 | M |
| E8 | Noise reduction (luminance and colour) and sharpening with an edge mask | 2 | M |
| E9 | Camera colour data v2: two calibration illuminants per model, with the source of every number recorded, as `base_curves.rs` does ("facts, not code"); temperature and tint to and from the camera neutral per the DNG specification | 2 | M |
| E10 | Writers: 16-bit TIFF, and EXIF and XMP blocks for JPEG, PNG and TIFF | 2 | M |
| E11 | Lens corrections (manual, plus DNG opcode lists), perspective, auto-level and auto perspective | 4 | L |
| E12 | Areas: brush strokes stored as resolution-independent vector paths and rasterized at render resolution; analytic gradients and circles; brightness and colour range masks; combine and invert; per-area stage parameters | 4 | XL |
| E13 | Spot fixes: parametric heal and clone, re-rendered every time from the stored spots (Lopsy's healing math is a reference) | 4 | L |
| E14 | Better Bayer demosaic for DNG and future formats, implemented from a published paper and measured against reference renders | 4 | M |
| E15 | Highlight reconstruction, local contrast and haze | 2 to 4 | L |
| E16 | Proxy codec, chosen by RFC (6.9) | 5 | M |
| E17 | Tiled full-resolution rendering for files beyond one texture | 5 | M |
| E18 | Later: more RAW formats, HDR output (Rec. 2100, gain-map JPEG or AVIF), merges, segmentation models | 6 | XL |

Rules that carry over from `engine/CLAUDE.md` and `MEMORY.md`:
- feature code draws only through the pass layer;
- every shader is WGSL and passes `npm run wgsl:check`;
- uniform structs are typed;
- readbacks are futures;
- writers mark their output dirty.

The develop stages are new shader families under
`gpu/shaders/develop/`, with their uniform structs in
`gpu/params/develop.rs`.

## 9. Changes to Lopsy

| ID | Change | Phase |
|---|---|---|
| L1 | Receive a handoff (6.12): the `?photos-handoff=` parameter, the handshake with the opener, band uploads into a new document, and the "From Photonamous" bar with **Save to Photonamous** and **Back to Photonamous** | 3 |
| L2 | `.lopsy` v3: 16-bit layer pixels, reusing the engine's u16 compressed-blob format (RLE or LZ4, `apps/lopsy-web/CLAUDE.md`), plus an optional `photos` source block. v2 files still open; older builds refuse v3 through the existing "newer version" guard. This also fixes today's loss of precision when a RAW import is saved. | 3 |
| L3 | **Save to Photonamous**: post the `.lopsy` v3 and the flattened 16-bit render to Photonamous, opening a Photonamous tab if there is none, and show the result | 3 |
| L4 | **Add to Photonamous** in the File menu: hand the document to Photonamous, which signs in if needed | 3 |
| L5 | **Grade in Photonamous** for a raster layer (6.12) | 5 |
| L6 | RAF and DNG import go through E2 and the default recipe. Their look stays within one 8-bit step on the sample corpus. | 2 |
| L7 | Documentation: `FEATURES.md` (the handoff, the new menu items, `.lopsy` v3), `SKILL.md` if any selector it uses changes, and `SPEC.md` | 3 |

Lopsy gains no Google sign-in, no Drive code and no new storage: it
stays an app with no account. Apart from the **Add to Photonamous** menu
item, nothing changes for someone who never uses Photonamous.

## 10. Testing

**A fake Google.** No test talks to Google.
- `packages/photos-core/test/fake-drive.ts` implements the Drive v3
  subset the app uses:
  - files: create, list with `q` and `appProperties`, get, update, trash;
  - resumable upload, including status queries and partial chunks;
  - `alt=media` with Range;
  - the changes feed, `about.get` and permissions.
- It can inject failures (429, 403 rate limit, 5xx, a connection dropped
  mid-chunk, eventual-consistency delays) and throttle bandwidth.
- Vitest uses it directly. Playwright serves it with `page.route` on the
  Google API hosts, and stubs `google.accounts.oauth2` and the Picker with
  `page.addInitScript`.
- Before each release, a manual checklist runs against a real Google
  account.

**Unit tests (Vitest):**
- Journal merging: random op sequences applied in random orders must
  produce identical state. This is property-based, with a seeded
  generator and no new dependency.
- HLC ordering under skewed clocks, roll-up and snapshot equivalence,
  schema migrations.
- Import planning (pairs, duplicates, folder names), file-name templates.
- The rate limiter and backoff, and building Drive requests.

**Engine tests (`cargo test`):**
- Decode-split equivalence for L6.
- Uniform layouts.
- Determinism of each develop stage on fixed inputs.

**Golden renders.**
- A corpus of real sample RAWs times recipes, with the expected output
  per pipeline version, rendered by `lopsy develop` on a native GPU in a
  nightly job, and on SwiftShader in e2e for a small subset.
- Any change outside tolerance fails, unless the pipeline version was
  bumped.

**E2E (Playwright):** driven through the UI, per
`apps/lopsy-web/e2e/GUIDE.md`.
- Import, cull, edit, export.
- Reload in the middle of an import.
- Two devices: two browser contexts with separate storage against one
  fake Drive, editing at the same time and offline, then converging.
- The Lopsy round trip between two origins: two ports locally, as
  lopsy.art and photonamous.com are in production. It includes a save
  made after the Photonamous tab was closed.
- Token expiry during an upload.

**RAW fixtures.**
- Real files only, per the root `CLAUDE.md`: Fujifilm samples from the
  sample-raf-images repository and DNG samples, downloaded into a cache
  directory, never committed and never synthesized. The engine's
  synthetic RAF stays a unit-test tool for band maths.
- JPEG fixtures may come from placecats.com, as the root `CLAUDE.md`
  suggests.

**Benchmarks.**
- Every budget in section 11 is an e2e benchmark in the style of
  `e2e/brush-perf-6k.spec.ts`. It runs on a real GPU with
  `LOPSY_GPU=hardware`.
- The 50,000-photo library is generated in the fake Drive.

## 11. Performance budgets

Reference machines:
- an Apple M1 MacBook Air with 8 GB, on stable Chrome with WebGPU;
- a 2021 Windows laptop with Intel Iris Xe, on stable Chrome, where every
  budget is doubled.

| What | Budget |
|---|---|
| Grid interactive after the app shell loads, 10,000 photos, all local | < 1 s |
| First screen of thumbnails on a new device, 10,000 photos, 50 Mbit/s | < 5 s; whole library usable in < 20 s |
| Grid scrolling, 50,000 photos | 60 fps, only visible thumbnails decoded |
| Local import work (hash, metadata, preview, staging), 30 MB RAF | ≥ 5 files/s; uploads are bandwidth-bound |
| Embedded preview on screen after opening a photo | < 150 ms |
| First full-quality render of a 26 MP RAF | < 2.5 s; < 0.5 s for a prefetched neighbour |
| Slider drag, global groups, working resolution | 60 fps target, 30 fps floor |
| Slider drag with 10 areas | ≥ 30 fps |
| Export, 26 MP RAF to full-size JPEG | < 4 s each; 100 photos in < 5 min |
| Memory in the Edit view, ≤ 50 MP | ≤ 1.5 GB JS and wasm heap, ≤ 1 GB GPU |
| Handoff, click to the developed layer in Lopsy, 26 MP, photo open in Edit | < 4 s |

## 12. Phases

Each phase ends in a working product that someone uses for real, starting
with the owner's own photos. A phase merges in reviewable PRs, one
logical change per commit. Lopsy changes only by the items in section 9.
1.0 is the end of Phase 5; Phase 6 comes after it.

### Phase 0: foundations

Nothing user-visible ships in this phase.

**Repository.**
- Move the engine bridge and UI kit into `packages/`. Make no behaviour
  change; the Lopsy e2e suite and the bundle budget must hold.
- Scaffold `apps/photonamous`, `packages/photos-core` and
  `packages/handoff`.
- Add the site assembly, the deploy change, the `_redirects` and
  `_headers` entries, and the CI jobs.
- Write `apps/photonamous/CLAUDE.md` and update the root map.

**Test tooling.** The fake Drive, and the sign-in and Picker stubs.

**Google and the site.**
- The Google Cloud project with the consent screen in Testing (15).
- A placeholder, deployed at `photonamous.com`.
- The privacy policy page.

**Spikes.** Results are appended to this document.

| Spike | Question |
|---|---|
| S1 | Resumable upload from the browser: is `Location` readable under CORS, and how do chunks resume? The CSP that allows sign-in, the Picker and the Drive API. |
| S2 | The token model in practice: does a gesture-time refresh flash a popup, and how often does an import stall? This decides open question 2. |
| S3 | `drive.file` with the Picker: what do picked files and picked folders grant, and does a picked file move into the library folder? |
| S4 | An engine instance in a worker, on both backends (E1) |
| S5 | E2 on the sample corpus: is the old look reproducible within one 8-bit step? |
| S6 | OPFS throughput and quota behaviour on Chrome, Safari and Firefox with 20 GB of originals |
| S7 | Is Fujifilm's embedded lens-correction data documented well enough to use? |

**Exit criteria.**
- Lopsy is unchanged: e2e green, bundle within budget.
- The placeholder is deployed.
- Every spike is answered.

### Phase 1: the library on Drive

**Features.**
- Sign-in, and creating or finding the library.
- Import from files, folders and the Picker: duplicates, pairs, embedded
  previews, staging, resumable uploads, checksum verification.
- Grid, Single, Compare and Cull mode. Ratings, labels, set aside,
  keywords, albums, the Info panel.
- Journal, snapshots and multi-device sync. Delete to trash and restore.
- The sync panel and the storage display.

**Engine and Lopsy work:** E5.

**Exit criteria.**
- 1,000 RAFs import across a reload without loss.
- Two devices converge after offline edits.
- The budgets for grid and import are met.
- The owner uses it for a real shoot.

### Phase 2: develop

**Features.**
- The Edit view: Profile, White balance, Tone, Curves, Color, Color
  Grading, Sharpness & noise, Framing (crop, straighten, rotate, flip),
  Finish and basic Local contrast.
- History, versions, presets, copy and paste, before and after.
- Previews after edits.
- Export to JPEG, PNG and 16-bit TIFF, to Drive or the computer, with
  presets.

**Engine and Lopsy work:** E1, E2, E3, E4, E6, E7, E8, E9, E10 and the
first part of E15; L6.

**Exit criteria.**
- The golden corpus is stable.
- The Edit and export budgets are met.
- A shoot is edited and delivered entirely in the app.
- Private alpha: the owner and invited testers, still with the consent
  screen in Testing.

### Phase 3: Lopsy round trip

**Features.**
- Edit in Lopsy and Save to Photonamous.
- Documents in stacks, re-opening a document, conflict copies.
- Add to Photonamous from Lopsy.

**Engine and Lopsy work:** L1 to L4 and L7.

**Exit criteria.**
- The round trip works end to end and keeps 16 bits (checked on a
  gradient).
- **Public beta** begins: the consent screen goes to production after
  brand verification, and a landing page is linked from Lopsy.

### Phase 4: areas and repair

**Features:** Areas, Spot fixes, Lens, Perspective, the rest of Local
contrast, and better noise reduction.

**Engine work:** E11 to E15.

**Exit criteria:** the slider budget with 10 areas is met, and the golden
corpus covers local edits.

### Phase 5: scale, offline and polish

**Features.**
- Proxies, offline start through the service worker, and the "All
  originals" device setting.
- Saved searches, keyword paths, facets, and grouping bursts of similar
  shots.
- Tuning for 50,000 photos.
- XMP import and export: ratings, labels and keywords, plus a mapping of
  basic edits, for people moving from other software.
- Share links, a watermark on export, and Grade in Photonamous (L5).
- The sign-in helper, if chosen.
- "Open with Photonamous" from Drive's own UI, through Drive UI
  integration, which also grants `drive.file` access to the file opened.

**Engine work:** E16 and E17.

**Exit criteria:** the 50,000-photo budgets are met, and the app is
usable offline for a day.

### Phase 6: later

More RAW formats (open question 3), HDR editing and export, merges (HDR
brackets, panoramas), subject and sky selection (open question 6), a
tablet layout, and print.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Camera coverage. A RAW editor that reads only RAF and DNG covers few cameras. | Say so at sign-up; document converting to DNG; make formats a Phase 6 priority (open question 3). |
| Licences. Lopsy is MIT with the Commons Clause, which adds a restriction the GPL forbids, so GPL code, which includes the main open-source RAW developers, cannot be used. LGPL decoders need a review before use. | Implement from papers and specifications; record the source of camera data as `base_curves.rs` does. |
| Google changes quotas, scopes or the token model; verification takes time | Keep everything behind `photos-core`; start brand verification in Phase 2; re-check Appendix A at each phase. |
| A sync bug loses or corrupts edits | An append-only journal; property tests; never deleting another device's files; snapshots kept three deep; Rebuild from Drive. |
| Users run out of Drive space; RAWs are 25 to 60 MB each | Show quota before import; warn at 90 %; pause uploads cleanly on `storageQuotaExceeded`. |
| Browser memory and GPU limits (wasm32's 4 GB address space; integrated GPUs) | Banded decode; a working image sized to the view; tiled export (E17); budgets measured on the Iris Xe machine. |
| Safari storage eviction | Flush the outbox promptly; offer installation; caches are rebuildable. |
| The hourly token expiry makes long imports stall | Resumable everything; reconnect without losing state; the helper (open question 2). |
| A script-injection bug reaches the user's Drive token | A strict CSP; no third-party scripts but Google's; no HTML from Drive; an origin of its own, so a bug in Lopsy cannot reach it |
| A page that is not the other app sends handoff messages | Origin allowlists on both sides, explicit target origins, schema checks (6.12) |
| A tab is closed in the middle of a handoff | Nothing is written until Save; a save with no Photonamous tab open reopens one (6.12) |
| Scope: this is a large product next to a large editor | The phases each ship something usable; the Not in 1.0 list stands. |

## 14. Open questions

Each question has a recommendation; the decision is the owner's.

1. **Name and URL.** Placeholders. Nothing depends on them; moving to
   another domain is configuration (6.3).
2. **The sign-in helper.** The token model needs no server, but tokens
   expire hourly, so unattended imports stall until the user clicks
   Reconnect. A stateless Pages Function pair removes that, at the cost of
   a client secret, a little server code and tokens passing through
   Cloudflare. Recommendation: ship Phase 1 without it, measure in S2 and
   the alpha, and add it before the public beta if imports stall in real
   use.
3. **Camera formats after RAF and DNG.** Which cameras matter (Sony ARW,
   Canon CR3, Nikon NEF?), and should an LGPL decoder be considered after
   a licence review, or every format written in-house?
   Recommendation: in-house, by measured demand, starting with whichever
   format the beta's users bring most.
4. **Watching a Drive folder.** Auto-importing files dropped into Drive
   from elsewhere needs a restricted scope, Google's review and a yearly
   security assessment. Recommendation: not for 1.0; "Add from Google
   Drive" covers it.
5. **Folder layout for originals.** By capture date (proposed) or by
   import? Recommendation: by capture date, with "by import" as a setting.
6. **On-device segmentation** for subject and sky areas: model size,
   licence, and WebGPU-only? Recommendation: decide in Phase 4; not
   before Areas works by hand.
7. **Export metadata default.** "Remove location" on by default
   (proposed). Recommendation: keep it on.
8. **Should Lopsy save to Drive on its own** (Save, Open recent), rather
   than through Add to Photonamous? It would bring Google sign-in into
   Lopsy, which today has no account. Recommendation: no; Add to
   Photonamous covers it.
9. **Fujifilm look names.** Profiles named after the in-camera film
   simulations they approximate. Recommendation: use descriptive names
   that say "approximates", and confirm the wording before the public
   beta.

## 15. Setup checklist

The step-by-step version for the proof of concept is `photonamous-setup.md`.

**Google Cloud** (Phase 0):
- [ ] A project for Photonamous, with the Drive API and Google Picker
      API enabled.
- [ ] OAuth consent screen: External, app name, logo, support email,
      `photonamous.com` as the authorized domain, verified in Search
      Console; a privacy policy
      page; a terms page. Scopes `openid`, `email`, `profile`,
      `drive.file`. Status: Testing, with test users.
- [ ] OAuth client, Web application, with JavaScript origins
      `https://photonamous.com` and `http://localhost:<dev port>`. With the helper, also the redirect
      URI `<app URL>/auth/callback`.
- [ ] A Picker API key restricted to the app's origin and the Drive and
      Picker APIs. The project number serves as the Picker app ID.
- [ ] Before the public beta: brand verification, and the publishing
      status set to In production.
- [ ] Later: Drive UI integration ("Open with") configuration.

**Cloudflare:**
- [ ] The Pages project `photonamous`, with the custom domain
      `photonamous.com` and `www.` redirected to it (6.3).
- [ ] `_redirects` and `_headers` in the app's `public/`.
- [ ] Each app's build lists the other's origin for the handoff.
- [ ] With the helper: secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
      and `COOKIE_KEY` in the Pages project. Functions deploy with the
      site.

**Repository:** see Phase 0.

## Appendix A. Facts to re-check

These were checked on 2026-11-18 through search results, not by reading
Google's pages directly (this environment could not reach them). Check
each against the primary source before the phase that depends on it.

| Fact the design uses | Where it matters | Source |
|---|---|---|
| `drive.file` is Google's recommended, non-sensitive Drive scope. Apps that use it skip restricted-scope verification and the security assessment, which restricted scopes need yearly. | 6.5 | [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth); [Workspace blog on Drive third-party app controls](https://workspace.google.com/blog/product-announcements/enhancing-security-controls-for-google-drive-third-party-apps) |
| With `drive.file`, picking a folder in the Picker has granted the folder, not its contents | 6.5, S3 | [Apps Script community thread](https://groups.google.com/g/google-apps-script-community/c/_W-NKbttfbo); [drive.file and folders](https://groups.google.com/g/google-apps-script-community/c/3aPYQeoWWSY) |
| The GIS token model issues no refresh token; a new token comes from `requestAccessToken()`, at page load or from a user gesture. Tokens last about an hour. Refresh tokens need the code model and a backend. | 6.4 | [Using the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model); [Choose a user authorization model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model) |
| Drive file resources expose `md5Checksum`, `sha1Checksum` and `sha256Checksum` for binary content | 6.8 | [Drive v3 files resource](https://developers.google.com/drive/v3/reference/files) |
| `appProperties`: 30 per app per file; 124 bytes per key plus value | 6.5 | [Add custom file properties](https://developers.google.com/drive/properties) |
| 12,000 queries per minute per user for existing projects. A quota-unit model reportedly rolled out in May 2026, with older projects keeping request counts. Check the project's quotas in the Cloud console. | 6.5 | [Drive API usage limits](https://developers.google.com/workspace/drive/api/guides/limits); [third-party summary of the 2026 change](https://fast.io/resources/google-drive-connector-rate-limit/) |
| Resumable uploads work from the browser under CORS; the session URI is in the `Location` header | 6.5, S1 | [googledrive/cors-upload-sample](https://github.com/googledrive/cors-upload-sample). 2026-11-18: a live preflight from `https://lopsy.art` allows `authorization, content-type, x-upload-content-type, x-upload-content-length`; that a successful initiation exposes `Location` (and a 308 `Range`) still needs a signed-in check |
| Drive v3 parameters and fields the adapter uses (`fields`, `q`, `generateIds`, `changes.list` up to 1000 per page, `permissions`, `sha256Checksum`, `headRevisionId`, `webViewLink`, `trashed` from a trashed parent) | 6.5 | Checked 2026-11-18 against the live [Drive v3 discovery document](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest) |
| The Picker runs in an iframe on docs.google.com, so its API key's referrers must include `https://docs.google.com/*`; with `drive.file`, `setAppId` (the project number) is required | 5.3, 6.5 | Google's [web Picker guide](https://developers.google.com/workspace/drive/picker/guides/web-picker), seen through search results 2026-11-18; `@types/google.picker` 0.0.52 |
| CSP for sign-in and the Picker: `accounts.google.com/gsi/` (script, frame, connect), `accounts.google.com/gsi/style`, `apis.google.com`, frames on `docs.google.com` and `drive.google.com`, `fonts.gstatic.com`, `*.googleusercontent.com` images, `'unsafe-inline'` styles for the Picker | 6.3, 6.13, S1 | GIS setup guide (search results 2026-11-18); the live `gsi/client` script; the CSP example in Google Workspace's [drive-picker-element](https://www.npmjs.com/package/@googleworkspace/drive-picker-element) README |
| In Testing status, authorizations (and refresh tokens) expire after seven days, and there is a cap of 100 test users | 6.4, 15 | [Manage app audience](https://support.google.com/cloud/answer/15549945); [Nango's Google OAuth notes](https://nango.dev/docs/api-integrations/google/how-to-register-your-own-google-oauth-app) |
| WebGPU ships in Chrome and Edge, Safari 26 and Firefox (Windows from 141, Apple-silicon macOS later). Linux Firefox and Firefox for Android are pending, so the WebGL fallback stays. | 6.10 | [web.dev: WebGPU supported in major browsers](https://web.dev/blog/webgpu-supported-major-browsers) |
| `showDirectoryPicker` is Chromium-only; Firefox and Safari oppose it | 5.3 | [caniuse](https://caniuse.com/mdn-api_window_showdirectorypicker); [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/file-system-access) |
| Storage: Chrome gives an origin a large share of disk; Firefox prompts for persistence; Safari may clear script-written storage after seven days without a visit unless the app is installed | 6.7 | [MDN: storage quotas and eviction](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [web.dev: storage for the web](https://web.dev/articles/storage-for-the-web); [web.dev: persistent storage](https://web.dev/persistent-storage) |

## Appendix B. Proof-of-concept status

A proof of concept of this spec was built on 2026-11-18, on the branch
`claude/great-ride-gmwms6`, by a team of agents working in parallel and
reviewed by independent agents (data integrity, security, UX, and a final
correctness pass). This appendix says what exists, where it departs from
the design above, and what was and wasn't verified. How to run, test and
deploy it: `docs/photonamous-setup.md`. What the app does, feature by
feature: `apps/photonamous/FEATURES.md`. How the library database works:
`packages/photos-core/README.md`. The develop chain in the engine:
`engine/src/develop/mod.rs`.

### What exists

| Spec | Built |
|---|---|
| 5.1 First run | Three kinds of storage: Google Drive (GIS token model, `drive.file`), a folder on this computer (Chromium) and this browser (OPFS). Reconnecting checks it is the same Google account. |
| 5.2 Library | Grid (sizes, sorting, windowed for large libraries), Single, Compare and Cull. Ratings, labels, set aside, titles, captions, keywords, albums (whole photos or single versions), the Info panel. Filters with counts, text search, saved searches, dates, imports, bursts. Stacks of RAW+JPEG pairs, versions and Lopsy documents. Library undo (⌘Z) for marks, keywords, albums, deletes and versions. Delete to trash and restore. Check library: orphans, missing, trashed, changed and left-over files, with repair. |
| 5.3, 6.8 Import | Files, folders, and Add from Google Drive (Picker). Duplicates by SHA-256 (named before importing), RAW+JPEG pairs, embedded previews, EXIF, XMP sidecars with their develop settings (`crs:`) mapped (`xmp/crs-mapping.ts`), a preset, album and keywords to apply. Staged in OPFS, resumable uploads with checksum verification, retry with backoff, Retry for parked items. Survives a reload; one tab at a time claims an import. |
| 5.4, 6.10 Edit | Profile (Standard and the Fujifilm looks from the base curves, Neutral, Monochrome), White balance (As shot, Auto, the camera's presets, picker, Kelvin for RAW), Tone with Auto, Curves (luminance, red, green, blue), Color with Color by hue, Color Grading, Local contrast (large details, small details, haze), Sharpness & noise, Framing (crop with aspect presets, straighten with a Level tool, rotate, flip both ways), Finish (vignette amount, midpoint, roundness, feather; grain), Areas (up to 8 linear or radial gradients with their own tone, white balance and saturation). Histogram with clipping warnings (J, and Alt while dragging Blacks, Whites or sharpening). History with click-back, Versions, Presets (built-in and the user's, previewed on hover), Copy and Paste edits, Before and after (toggle and split), filmstrip. Edits run on a working image of at most 4096 px; full resolution loads at 50 % zoom and for output. |
| 5.5, 6.11 Export | JPEG, PNG (8 or 16-bit) and TIFF (16-bit, Deflate, ICC), in sRGB or Display P3. Size by long edge, short edge or megapixels, with "Don't enlarge". Metadata all, copyright only or none, with location removed by default. File-name templates. To `Exports/` in the library, a download, or a ZIP. Export presets (built-in and the user's). Show in Drive and share links, only after the user confirms. |
| 5.6, 6.12 Round trips | Edit in Lopsy (16-bit), Save to Photonamous (`.lopsy` v3 with a 16-bit render, stacked with the photo, updated in place only at a matching revision, otherwise a copy), Add to Photonamous from Lopsy's File menu, and Grade in Photonamous for a layer (L5). Lopsy offers none of this unless its build sets `VITE_PHOTONAMOUS_URL`; without it Lopsy is unchanged, and Save Project still writes v2. |
| 5.7, 6.7 Devices and offline | The library opens offline from IndexedDB, and a service worker loads the app shell offline. Keep originals: Recent, All or None. Previews re-render in the background after presets, pastes, synced edits and new versions. Sync panel, storage meter, device cache. |
| 6.6 Library database | Per-device journals of last-writer-wins fields stamped with hybrid logical clocks, snapshots, roll-up, the Drive change feed, a Web Locks single writer per device, durable-before-destructive ordering, and merging of duplicate library roots. A 50,000-photo library opens cold in about 2 s. |
| 6.2 Code layout | `packages/ui` (`@lopsy/ui`), which both apps import: the design tokens, reset and fonts; the Slider, Lopsy's, which Photonamous' Edit view now uses too; a Menu with Photonamous' look, used by Import photos; and the keyboard and focus helpers from the accessibility pass (`@lopsy/ui/a11y`). `packages/handoff` and `packages/photos-core` as specified. The engine bridge is still in `apps/lopsy-web`. |
| 6.3 Hosting | Its own Pages project, `photonamous`, for `photonamous.com`, with its own CSP; Lopsy hands off to it there. Deployed only when the repository variable `DEPLOY_PHOTONAMOUS` is `true`. CI runs Photonamous' typecheck, lint and unit tests. |
| Accessibility | WCAG 2.2 AA: AA contrast tokens, 24 px targets, a visible focus ring, every function by keyboard (crop edges, curve points and areas included, with fields or sliders instead of dragging), focus that moves into dialogs and menus and back, live announcements, page titles, landmarks, a reflowing library, and a setting that turns single-key shortcuts off. `e2e/accessibility.spec.ts` runs axe-core on every view; keyboard specs cover each area. |

### Where it departs from the design

- **Phase 0's package moves were done only in part.** `packages/engine-web`
  does not exist: Photonamous imports Lopsy's engine package from
  `apps/lopsy-web`. `packages/ui` has the tokens, reset and fonts, the
  Slider, a Menu and the accessibility helpers; the other components each
  app shows (Button, IconButton, Modal, Popover and the rest) are still its
  own.
- **The develop chain is display-referred.** The RAW stage outputs
  sRGB-encoded values and the later stages (Lopsy's adjustments, the
  colour mixer, areas, detail, finish) work on them, not on linear
  Rec. 2020 floats. The order also differs from 6.10: noise reduction,
  haze and local contrast run before tone; areas after colour and curves;
  sharpening and finish last. `engine/src/develop/mod.rs` gives the
  reasons.
- **The engine runs on the main thread** (spike S4 was not done). RAF
  decoding runs in workers.
- **Curves' luminance channel is Lopsy's RGB master curve**, so it shifts
  saturation as well as brightness.
- **Color Grading has sliders, not drawn wheels.** There is no Black &
  White per-hue mix.
- **Presets are ordinary fields on new IDs**, not a `preset.add` op.
- **No default sharpening or noise reduction**, even for RAW files.
- **Areas have no local contrast of their own**: the recipe has the field;
  the engine doesn't render it.
- **Rec. 2020 export and WebP export** are not offered, and TIFF carries no
  EXIF. There is no output sharpening.
- **Lopsy's own Save Project** stays at `.lopsy` v2 (8-bit); v3 is written
  only for Photonamous.
- **White balance from sidecars' develop settings** maps for JPEG, PNG and TIFF.
  For RAW files it needs the photo's own Kelvin scale, which the import
  doesn't pass yet, so RAW sidecars keep the as-shot white balance.
- **⌘Z reaches a delete only right after it** (or through the message's
  Undo), because undoing a delete must also take the files out of the
  trash; library history covers marks, keywords, albums and versions.
- **DNG files load at full size** in the Edit view; RAF, JPEG, PNG and
  WebP edit on the working image. Grain previewed on the working image
  looks a little stronger than in a full-size export.

### Not built

- Areas from a brush, a brightness range or a colour range; Spot fixes;
  Lens corrections; Perspective (Phase 4).
- Proxies, "Open with Photonamous" from Drive's UI, the sign-in helper, a
  watermark on export, keyword paths (Phase 5).
- RAW formats other than Fujifilm RAF, and Fujifilm's lossy compressed RAF
  (about 2–3 days with a sample file); HDR editing and export (Phase 6).
- Tiled rendering for images larger than the GPU's texture limit.

### Verified, and not

- **Tests on the final branch:** `docs/photonamous-setup.md` §5 says how
  to run each suite.
  Unit tests cover photos-core, the app and the handoff package; e2e
  suites cover the app (including real RAFs from
  `LOPSY_RAF_SAMPLES`), photos-core in a browser, the Lopsy round trip,
  Lopsy's handoff and grade, and the production build as Pages serves it,
  offline start included, and an axe-core accessibility scan of every view. All
  eight sample RAFs decode, and the engine's Rust tests run on them.
- **Not verified against Google.** Sign-in, the Picker, uploads, the
  change feed and share links ran against the fake Drive and stubbed
  Google scripts only. Drive's parameters and fields were checked against
  its live discovery document and its CORS answers against live
  preflights; whether `Location` and `Range` are readable on real upload
  responses (spike S1), silent token refresh (S2), what a picked folder
  grants (S3) and `anyone` sharing under `drive.file` need a signed-in
  account (setup guide §6).
- **No real GPU.** Everything ran on SwiftShader on a shared, heavily
  loaded 4-core machine. There a 40 MP RAF became editable in 4–18 s and
  reached full resolution in 20–60 s, and the engine's own RAF work took
  about 1.5 s of that. Real-GPU timings are unknown.
- **Edit view speed is unmeasured on real hardware.** A committed change
  costs four renders (the screen, two preview draws once the edit
  settles, and a restore; the histogram reuses the screen's frame), and
  `e2e/edit-render-budget.spec.ts` pins those counts. Under SwiftShader
  such a change on a 3600×2400 photo with sharpening and local contrast
  still took 5–8 s, and an exposure change on a 40 MP RAF about 13 s; on a
  GPU each render should take milliseconds. Profile it on real hardware
  first.
- **Chromium only.**

### Decisions for the owner

1. **Default sharpening and noise reduction for RAW**, as most RAW developers apply.
2. **A SIMD engine build**, measured 15 % faster at RAF decoding.
3. **Deploying:** create the Pages project and its domain, do the Google
   Cloud setup (section 15), then set `DEPLOY_PHOTONAMOUS` and the
   `PHOTONAMOUS_GOOGLE_*` variables (setup guide §3–4).

The name and domain are settled: Photonamous, at photonamous.com. An
origin of its own also settles the shared-origin risk (6.13).
