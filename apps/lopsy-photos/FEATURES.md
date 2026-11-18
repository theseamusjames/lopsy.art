# Lopsy Photos feature catalog

What Lopsy Photos does today, as the code and its e2e specs show it.
Current behaviour only; bugs live in GitHub issues. The design behind it
is `docs/lopsy-photos-spec.md`; running and setup are in
`docs/lopsy-photos-setup.md`.

## Storage and sign-in

- **Start screen.** "Where should your library live?" offers up to three
  choices; a build offers only those it can serve:
  - **Google Drive**: the library lives in the user's own Drive, so every
    computer that signs in sees the same library. Offered only in builds
    with a Google client ID (`VITE_GOOGLE_CLIENT_ID`).
  - **This browser**: private storage inside this browser on this computer
    (the origin private file system). Clearing the browser's data removes
    it.
  - **A folder on this computer**: the user picks a folder; photos and the
    library are kept there as ordinary files. Needs the File System Access
    API (Chromium).
- **Reopening.** The library from the last visit is offered first ("Open
  your library in this browser", "Reopen the folder …", "Continue as
  <account>"), with the other choices below it.
- **Sign-in.** Google sign-in asks for the `drive.file` scope only, so the
  app sees just the files it made or the user picked. Tokens stay in
  memory. When a token can no longer be refreshed, the header offers
  **Reconnect Google Drive**; nothing else is lost.
- **Add from Google Drive…** (the Import menu, Drive libraries only):
  picks photos already in Drive with Google's Picker and adds them to the
  library; Settings chooses whether they are moved into `Originals/` or
  left where they are.
- **Close this library** (header) goes back to the start screen.
- **Layout in storage.** A `Lopsy Photos/` folder holds `Originals/`
  (filed by capture year and month), `Lopsy documents/`, `Exports/` and
  `Library data/` (the journal, snapshots, previews and device records).
  Originals are never modified or permanently deleted.

## The library

### Grid

- Photos in a virtualised grid, newest first by default. **Order by**
  Date taken, Date added, Last edited, File name or Rating, each in its
  natural direction (newest, most recently edited and best first; names A
  to Z); the arrow beside it reverses the order. **Size** sets the
  thumbnail size.
- **Toolbar** groups: *Look at* (one photo large, **Compare**, **Cull**),
  *Edits* (**Copy edits**, **Paste**, **Presets**), and **More** (New
  version, Edit in Lopsy, Group bursts), then Details. Button titles give
  each shortcut, read from the shortcut list.
- Tiles show the photo's 512 px preview, its colour label and stars, and
  badges: a version count, **RAW+JPEG** for a pair shot together (shown
  as one photo, the RAW in front, and counted once everywhere: All
  photos, Dates, Imports), a burst count, and a Lopsy-document count.
  Each badge opens or folds its stack.
- **Previews follow edits.** A preset or pasted edits from the grid, a
  new version, or a change from another device gets new previews in the
  background, one photo at a time, while the Edit view is closed; the
  **Saving and storage** panel shows "Updating N previews". A new
  version with the same edit as another shows that one's preview at once.
- **Stacks.** With **Group bursts** on, shots taken in quick succession
  show as one tile; its badge shows or folds the rest. Lopsy documents
  made from a photo are stacked behind it the same way, behind a
  paintbrush badge with their count.
- **Selection.** Click selects one; ⌘/Ctrl-click adds or removes; Shift
  extends; ⌘A selects every photo shown and ⌘D selects none. Arrow keys
  move the focus; Shift+←/→ grows the selection.
- **Versions as tiles.** A photo's tile shows its *shown* version; its
  version badge opens the others as tiles of their own right after it,
  each with its own preview, and folds them back. **Show this version for
  the photo** (a version tile's menu) makes that version the one the
  photo shows in the grid and in albums.
- **Photo actions** (a tile's right-click menu): Look at it large, Edit,
  New version, Show this version for the photo (on a version's tile),
  Edit in Lopsy, Copy edits…, Paste edits, Export…, Move to the trash….
- **Drag** photos onto an album in the sidebar to add them; dragging a
  version's own tile adds just that version, which the album then shows
  as its own tile.

### Single, Compare and Cull

- **Single view** (Space, or double-click): one photo large at 2048 px,
  with Previous/Next (← →), its versions, and **Edit**, **Edit in Lopsy**
  and **Set aside / Bring back**. Space or Escape goes back to the grid.
- **Compare** (C): two to four selected photos side by side.
- **Cull** (F): full screen, one photo at a time; rating (1–5) or setting
  aside (X) moves on to the next. Escape leaves.

### Marks, details and keywords

- **Rating** 0–5 stars (keys 0–5), **colour label** red, yellow, green,
  blue, purple (R Y G B P; pressing the same key again removes it), and
  **Set aside** (X), which hides a photo from the other collections
  without deleting it. When the photo leaves the grid, the next one is
  selected; the message that follows has **Undo**.
- **Undo / Redo in the library** (⌘Z, ⇧⌘Z): marks, keywords, albums,
  versions and the delete record, one step at a time, with what was
  undone said in a message.
- **Details panel** (I): rating, label, title, caption, keywords and the
  albums the photo is in, plus file and camera facts (camera, lens,
  exposure, capture time, size). With several photos selected, changes
  apply to all of them.

### Collections and finding

- Sidebar: **All photos**, **Recent imports**, **Set aside**, **Albums**
  (made by hand, renamed and deleted from the sidebar), **Saved
  searches**, **Dates** (years opening into months), **Imports** (one
  entry per import) and **Keywords**.
- **Find photos**: a text search over file names, titles, captions and
  keywords, and filters for rating, label (including *No label*), edits
  (*Edited*, *Not edited*), file type (RAW (Fujifilm), RAW (DNG), JPEG,
  PNG, WebP, Lopsy document), camera and lens. **Save search** keeps the
  filters in the sidebar under a name.

### Versions, copying edits and presets

- **New version**: asks for a name ("Version 2" offered, selected), then
  makes another edit of the same photo starting from the current one; the
  original file is untouched. The photo's stack opens to show its
  versions as their own tiles. Single view lists them: switch, rename,
  **Show** (the one the photo shows everywhere), delete (the shown one
  too, when another is left).
- **Albums** hold whole photos or single versions: with a version's tile
  selected, the details panel adds that version.
- **Copy edits…** (⇧⌘C) asks which groups to copy; **Paste edits**
  (⇧⌘V) puts them on the selected photos, as one step, changing nothing
  else.
- **Presets** (grid toolbar): apply one to the selected photos. *Made by
  Lopsy* presets ship with the app; *Yours* are saved from the Edit view.
  The import sheet can apply a preset to everything it imports.

### Deleting

- **Move to the trash** (Delete or Backspace) asks first, then moves the
  original, its previews and any Lopsy document files to the storage's
  trash (Google Drive's trash on Drive) and hides the photo. Nothing is
  deleted permanently. The next photo is selected, and **Undo** in the
  message brings the photos and their files back.
- **Check library** (Settings) finds originals of deleted photos still
  outside the trash and moves them there.

## Import

- **Import photos** (header): *Choose photos…*, *Choose a folder…*
  (everything in it, including folders inside, where the browser can pick
  folders) or, in a Drive library, *Add from Google Drive…*; or drop files
  or folders on the window.
- Reads **RAF, DNG, JPEG, PNG and WebP**. The sheet counts what it found,
  says what it cannot read, and shows RAW+JPEG pairs as one photo (or
  imports the RAW only).
- **Photos already in the library are skipped** (by SHA-256), and the
  picked files are never changed. Before importing, the sheet names the
  ones that look like photos already there (same name and size) and
  leaves them out of the count.
- **Add to album** (an existing one or a new one) and **Keywords** for
  everything the import brings in.
- **Edits to start from**: none ("as the camera took them") or a preset.
- **XMP sidecars.** A `.xmp` picked or dropped with its photo
  (`<name>.xmp` or `<name>.<ext>.xmp`) is not imported as a file: its
  rating, label, title, caption, keywords and Lightroom / Camera Raw edits
  (`crs:`, mapped approximately onto the recipe: tone, presence, detail,
  colour by hue, crop and straighten) are applied to the photo it belongs
  to, also when that photo is already in the library.
- Each file is hashed, uploaded into `Originals/<year>/<month>/`, checked
  against its hash, and added with its metadata (capture time,
  orientation, camera, lens, exposure, GPS). Previews (512 and 2048 px)
  come from the camera's embedded JPEG or the browser's decode.
- Progress shows in a strip at the bottom of the window. An import that
  is interrupted (the tab closes, the network drops) resumes; uploads
  resume where Drive allows.

## Edit view

Opened with Enter, **Edit** in Single view, or double-click. One photo, a
left column, the image and a panel of groups; edits are saved to the
version as they are made, and previews are rendered when the edit settles
and on leaving.

- **Loading and working size.** RAF decodes on a pool of workers into the
  engine's RAW develop stage; DNG through the engine's decoder; 16-bit PNG
  at full depth; JPEG and WebP through the browser. Editing starts on a
  *working image* sized to the view (at most 4096 px on its long edge),
  so a large photo is editable quickly; zooming to 50 % or closer loads
  the full resolution ("Loading full resolution…"), and full-size
  exports always render from it.
- **Left column**: **Presets** (apply one, or **Save preset…** from this
  edit, choosing its groups), **Versions** (switch, rename, **New
  version**) and **History** (every step; clicking one goes back to it).
  The column folds away. A **filmstrip** of the photos around this one
  moves between them.
- **Toolbar.** Library (back), Undo / Redo (⌘Z, ⇧⌘Z or ⌘Y), Rotate left,
  Rotate right, Flip, Flip vertical, **Crop**, **Areas**, **Before** (or
  hold `\`), **Split** (before and after side by side, with a divider to
  drag), Fit (⌘0), 100% (⌘1) with a zoom readout, Copy edits / Paste edits
  (⇧⌘C, ⇧⌘V), **Edit in Lopsy** and **Export**. The image pans by
  dragging and zooms with the wheel.
- **Histogram** of the rendered edit, updated as it changes. Its shadow
  and highlight markers light when the photo clips, and clicking them
  shows clipped pixels on the photo (blue at black, red at white; never
  in exports or previews); **J** toggles both. Holding Alt (Option)
  while dragging Blacks or Whites shows that side's clipping, and while
  dragging a Sharpen slider shows what is being sharpened.
- **Straighten**: Angle (−45..45°), and **Level**: draw along something
  that should be level (or upright) to set it.
- **Profile**: for RAW, the camera's look first ("Camera (Velvia look)",
  not listed a second time), then the engine's film looks with Provia
  shown as "Standard (Provia look)" (or "Camera (Provia look, Standard)"
  when the camera shot Provia), Neutral and Monochrome; for other photos,
  Standard and Monochrome.
- **White balance**: a **Mode** menu (As shot; Auto, on RAW files; the
  RAW file's presets — Daylight, Cloudy, Shade, Tungsten, the
  fluorescents, Flash, Underwater, as the body has them; and Custom,
  which the sliders set), Temperature and Tint, and a **picker** (the
  pipette): click something that should be neutral grey and the
  engine sets Temperature and Tint to neutralise it (Esc cancels). On
  RAW files the Temperature readout shows Kelvin and takes typed Kelvin;
  on other photos the sliders are relative. Each choice, pick or slider
  release is one history step ("White balance: Daylight", "White
  balance: picked").
- **Tone**: Exposure, Contrast, Highlights, Shadows, Whites, Blacks, with
  **Auto**, which the engine sets conservatively from the histogram.
- **Color**: Vibrance, Saturation.
- **Curves**: a luminance curve and red, green and blue curves, edited by
  dragging points.
- **Color by hue**: Hue, Saturation and Luminance for eight bands (red,
  orange, yellow, green, aqua, blue, purple, magenta).
- **Color Grading**: shadows, midtones, highlights and global wheels
  (hue, saturation, luminance), Blending and Balance.
- **Local contrast**: Large details, Small details, Haze.
- **Sharpness & noise**: Sharpen, Radius, Edges only, Noise, Color noise,
  Keep detail. While a slider drags these passes are left out, and they
  come back when it settles.
- **Finish**: Vignette, with its Midpoint, Roundness and Feather; and
  Grain, Grain size and Roughness. Grain is the same on every render and
  export of a photo.
- Every group has a **Reset**; each slider has a typed value field, and
  double-clicking a slider resets it. Each change is one history step
  named after it ("Exposure +0.50").
- **Crop** tool: drag the frame; **Aspect** Free, Original, 1 : 1,
  4 : 5, 3 : 2 or 16 : 9, made landscape or portrait; Reset, Done (Enter)
  or Cancel (Escape). The crop follows rotation.
- **Areas** (toolbar): add **Linear** (a gradient across the photo) or
  **Radial** (an ellipse) areas, up to eight, each with Amount, Invert, a
  name, Delete, and its own Exposure, Contrast, Highlights, Shadows,
  Temperature, Tint and Saturation. The selected area's mask shows in red
  on screen, and handles on the image move it, resize it, turn it and set
  its feather; each drag or slider release is one history step ("Area:
  move"). Areas are stored on the unrotated photo, so they follow
  rotation, flips, straightening and the crop.

## Export

- **Export…** (header, tile menu, Edit view): the selected photos'
  versions, rendered by the engine at full quality.
- **File type**: JPEG with **Quality**, PNG 16-bit or 8-bit, or TIFF
  16-bit (full size, no EXIF). **Colours**: sRGB or Display P3 (Rec. 2020
  waits for the engine).
- **Size**: original, or by long edge, short edge or megapixels, with
  **Don't enlarge** on by default.
- **Details in the file**: all (with **Remove location**, on by default;
  "Location will be kept" shows when it is off), copyright and contact
  only, or none; Creator and Copyright fields.
- **File names**: a template with `{name}` `{date}` `{seq}` `{seq:3}`
  `{title}` `{version}` `{camera}`, and the first name shown.
- **Save to**: the library's `Exports/` folder, or a download: one file,
  or for several either **one ZIP** or each file on its own.
- **Export presets**: *Made by Lopsy* ones and *Yours*, saved, renamed
  and deleted from the dialog; a saved preset keeps every choice above.
- **After an export into the library** (Google Drive): **Show in Drive**
  opens the export's folder, and **Copy share link** shares that folder
  with anyone who has the link, only after a confirmation that says
  exactly that.
- Not yet: WebP output and output sharpening.
- An export can **keep going in the background** while the user goes on.

## Lopsy round trips

Photos and Lopsy talk over `window.postMessage` (`packages/handoff`); Lopsy
never talks to Google. Lopsy's side is in `apps/lopsy-web/FEATURES.md`
(Lopsy Photos Round Trip).

- **Edit in Lopsy** (grid toolbar, tile menu, Single view, Edit view):
  opens Lopsy in its tab (`lopsy-editor`) from the click. A photo goes as
  its developed full-size 16-bit PNG with its source (library, asset,
  version, recipe hash) and a camera summary; a Lopsy document goes as its
  `.lopsy` with the file's current revision (read until stable).
- **Save to Lopsy Photos** (in Lopsy): the `.lopsy` and a flattened 16-bit
  PNG come back and are stored in `Lopsy documents/` as a document
  asset, stacked behind the photo it was made from, with previews. Saving
  again updates the same document in place; if it changed elsewhere since
  Lopsy opened it, the save becomes a copy ("<name> 2"). A toast reports
  each save.
- **Add to Lopsy Photos** (Lopsy's File menu) and saves from a Lopsy tab
  whose Photos tab is gone open Photos at `?receive=<id>`, which stores
  the save and says so in a toast.
- **Grade in Lopsy Photos** (Lopsy's Layer menu and layer right-click
  menu): opens Photos at `?grade=<id>`, straight into the Edit view on
  that layer with no library or start screen. The layer arrives at
  16 bits with its transparency, and is edited with the non-RAW pipeline.
  Each grade has a tab of its own. **Done** sends the full-size 16-bit PNG
  and the recipe back, and the tab closes; **Cancel** sends nothing. A
  render Lopsy would refuse (the wrong size, over 1 GB) is reported to
  Lopsy as a failure and the tab stays open to say so.

## Devices, offline, sync and settings

- **Sync.** Every change is an operation in this device's journal in
  storage; other devices' changes are merged in, in any order, with the
  same result. The header shows the state (saved, changes waiting,
  offline, needs attention); the **Saving and storage** panel shows
  changes waiting, when it last saved, where the library is stored and
  how much space it uses, with **Save now** and **Try again**.
- **One tab per library.** A second tab that opens the same library takes
  it over, and the first says so and stops writing.
- **Offline.** In production builds a service worker keeps the app
  shell, so the app starts without a connection; changes wait in the
  device's queue and are saved when storage is reachable again. Photos
  whose originals are kept on the device can be edited offline.
- **Settings**:
  - *This device*: its name, as other devices see it.
  - *Kept on this device*: keep originals on this device (only the photo
    being edited; up to 20 GB, oldest opened go first; or every
    original, for working offline, shown in the sync panel), and clear
    what is kept.
  - *Adding from Google Drive* (Drive libraries).
  - *Library health*: **Check library** verifies that every photo's
    original is still in storage and unchanged, and marks the ones that
    are not. When a delete left originals of deleted photos outside the
    trash, it offers to move them there.

## Keyboard shortcuts

Shown in the app with `?`.

| Keys | What |
|---|---|
| 0–5 | Rating (0 clears) |
| R Y G B P | Red, yellow, green, blue, purple label (again removes it) |
| X | Set aside, or bring back |
| ⌘Z / ⇧⌘Z | Undo / redo in the library |
| ← → ↑ ↓ | Move between photos (↑ ↓ in the grid) |
| Shift+← → | Grow the selection |
| ⌘A / ⌘D | Select all shown / none |
| Enter | Edit the photo |
| Space | One photo large, and back |
| C | Compare the selected photos |
| F | Sort through full screen |
| I | Show or hide details |
| Delete, Backspace | Move to the trash |
| ⇧⌘C / ⇧⌘V | Copy edits / paste edits |
| Escape | Go back |
| ? | Show the shortcuts |

In the Edit view: ⌘Z undo, ⇧⌘Z or ⌘Y redo, ⌘0 fit, ⌘1 100%, ⇧⌘C and
⇧⌘V copy and paste edits, hold `\` for before, J for clipping.
