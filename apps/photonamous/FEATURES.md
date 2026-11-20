# Photonamous feature catalog

What Photonamous does today, as the code and its e2e specs show it.
Current behaviour only; bugs live in GitHub issues. The design behind it
is `docs/photonamous-spec.md`; running and setup are in
`docs/photonamous-setup.md`.

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
- **Layout in storage.** A `Photonamous/` folder holds `Originals/`
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
- **Versions as tiles.** A photo's tile shows its *selected* version;
  its version badge opens the others as tiles of their own right after
  it, each with its own preview, and folds them back. **Make this the
  selected version** (a version tile's menu) makes that version the one
  the photo uses in the grid, albums and exports.
- **Photo actions** (a tile's right-click menu): Look at it large, Edit,
  New version, Make this the selected version (on a version's tile),
  Edit in Lopsy, Copy edits…, Paste edits, Export…, Move to the trash….
  On a Lopsy document, Edit edits its flattened render and Edit in Lopsy
  sends its `.lopsy`.
- **Drag** photos onto an album in the sidebar to add them; dragging a
  version's own tile adds just that version, which the album then shows
  as its own tile.

### Single, Compare and Cull

- **Single view** (Space, or double-click): one photo large at 2048 px,
  with Previous/Next (← →). Above it, a header of two rows in the bars'
  colour: **Back** (a link at the left edge, named "Back to the grid"),
  the file name, centred, and its place in the list; then the colour
  labels at the left, the stars in the centre and **Edit in Lopsy** and
  **Edit** at the right, as icons named for screen readers and in their
  tooltips. On a Lopsy document the first is **Open in Lopsy**, which
  sends its `.lopsy`, and Edit edits its flattened render here. Below the
  photo, a bar with its versions and, at the right end, **Drop / Bring
  back**; then the Lopsy documents made from it.
  Space or Escape goes back to the grid. In a narrow window the bars wrap
  rather than overlap: the edit buttons go under the labels and stars, and
  Drop under the versions.
- **Versions in Single view**: the **Selected** box, drawn like the
  chips, holds the version the photo uses in the grid, albums and
  exports, with its Rename (or a double-click on its name; Enter saves and
  Escape keeps the old name) and Delete (never the last version; the next
  one becomes selected). Up to four versions, the others are chips beside
  it. A chip shows its version without selecting it (Edit then edits that
  version); while it is on screen it has a check, which makes it the
  selected version and puts the one it replaces back among the chips, and
  a bin. The version on screen, the box or a chip, has a green outline.
  With five or more, a dropdown of the others ("4 other versions") takes
  the chips' place, outlined while it shows one, with the check and the
  bin of the one it shows. When the
  bar has no room for them, the chips scroll sideways on their own and
  never run under Drop. **New version** is there either way.
- **Compare** (C): two to four selected photos side by side.
- **Cull** (F): full screen, one photo at a time, laid out as Single view,
  with the keys' hint beside Drop; rating (1–5) or dropping (X) moves on
  to the next. Escape leaves.

### Marks, details and keywords

- **Rating** 0–5 stars (keys 0–5), **colour label** red, yellow, green,
  blue, purple (R Y G B P; pressing the same key again removes it), and
  **Drop** (X), which hides a photo from the other collections without
  deleting it, until **Bring back**; dropped photos are in **Dropped**. When the photo leaves the grid, the next one is
  selected; the message that follows has **Undo**.
- **Undo / Redo in the library** (⌘Z, ⇧⌘Z): marks, keywords, albums and
  versions, one step at a time, with what was undone said in a message.
  A delete is undone by ⌘Z right after it (or the message's Undo), which
  brings back the photo and takes its files out of the trash together;
  once something else has changed, the delete is no longer in ⌘Z's reach.
- **Details panel** (I): rating, label, Drop, title, caption,
  keywords and the albums the photo is in, plus file and camera facts
  (camera, lens, exposure, capture time, size). With several photos
  selected, changes apply to all of them. Beside the Single view it leaves
  out rating, label and Drop, which the bars around the photo have.

### Collections and finding

- Sidebar: **All photos**, **Recent imports**, **Dropped**, **Albums**
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
  makes another edit of the same photo starting from the current one, as
  the photo's selected version (one undo step); the original file is
  untouched. The photo's stack opens to show the other versions as their
  own tiles. Single view has the selected one in a box and the others as
  chips or, past four, a dropdown: show, select, rename, delete (the
  selected one too, when another is left).
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
  message (or ⌘Z right after) brings the photos and their files back.
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
  rating, label, title, caption, keywords and develop settings
  (`crs:`, mapped approximately onto the recipe: tone, presence, detail,
  curves, colour by hue, colour grading, crop and straighten, vignette and
  grain) are applied to the photo it belongs to, also when that photo is
  already in the library. White balance comes across for JPEG, PNG and
  TIFF photos; a RAW file keeps its as-shot white balance, because
  a sidecar's Kelvin values only map through the photo's own scale.
- Each file is hashed, uploaded into `Originals/<year>/<month>/`, checked
  against its hash, and added with its metadata (capture time,
  orientation, camera, lens, exposure, GPS). Previews (512 and 2048 px)
  come from the camera's embedded JPEG or the browser's decode.
- Progress shows in a strip at the bottom of the window while the import
  runs, with Pause and Stop. An import that ends cleanly (nothing failed,
  nothing waiting to try again, not paused) says how it went in a message
  that goes after a few seconds (it stays while the pointer is on it or
  it has focus), and the strip goes. Any other end keeps the strip, with
  what failed (listed by file), **Retry** or **Resume**, until it is
  dismissed. The outcome counts photos as the grid does ("Imported 5
  photos (6 files: RAW+JPEG pairs count once)"). Imports in the same
  minute are told apart in the sidebar by their seconds. An import that
  is interrupted (the tab closes, the network drops) resumes; uploads
  resume where Drive allows.

## Edit view

Opened with Enter (in the grid, Single view or Cull) or **Edit** in Single
view and the tile menu; double-clicking a tile opens Single view, not
Edit. One photo, a left column, the image and a panel of groups; edits
are saved to the version as they are made, and previews are rendered when
the edit settles (never during a slider drag), on leaving, and before the
filmstrip opens another photo.

A Lopsy document opens here on its flattened render, the PNG Lopsy saves
beside the `.lopsy`: its edits, versions, presets, copy and paste and
exports work as a photo's do, on top of that render, and the `.lopsy`
itself is untouched (Edit in Lopsy still sends it as it is). When Lopsy
saves the document again, its edits here apply to the new render, and
its previews are rendered again with them. The render is read from
storage each time a document opens: it is not kept in the device's cache
of originals. A document without a render opens only in Lopsy: should the
Edit view be asked for one, it names the document, says it was saved
without a picture to edit here, and offers **Open in Lopsy** and **Back
to the library**.

- **Loading and working size.** RAF decodes on a pool of workers into the
  engine's RAW develop stage; DNG through the engine's decoder; 16-bit PNG
  at full depth; JPEG and WebP through the browser. Editing starts on a
  *working image* sized to the view (at most 4096 px on its long edge),
  so a large photo is editable quickly (DNG loads at full size); zooming
  to 50 % or closer loads the full resolution ("Loading full
  resolution…"), and full-size exports, Edit in Lopsy and Done always
  render from it. While it loads, the version's stored preview shows
  with "Loading…".
- **Left column**: **Presets** (apply one, or **Save preset…** from this
  edit, choosing its groups), **Versions** (switch, rename, **New
  version**) and **History** (every step; clicking one goes back to it).
  The column folds away with the button at its bottom left, which stays
  there while it is folded. A **filmstrip** of the photos around this one
  moves between them, in the grid's order: a photo whose stack is open in
  the grid shows each version as a tile of its own (named "<file>
  (<version>)", with that version's preview), which opens that version.
  Lopsy documents are in it too.
- **Toolbar.** Library (back), Rotate left, Rotate right, Flip, Flip
  vertical, **Crop**, **Masks**; then Undo / Redo (⌘Z, ⇧⌘Z or ⌘Y) beside
  Copy edits / Paste edits (⇧⌘C, ⇧⌘V), away from the rotations; **Edit in
  Lopsy** and **Export**. The image pans by dragging and zooms with the
  wheel.
- **The bar under the photo.** On the left, **Fit** (⌘0), **Full** (⌘1:
  one pixel of the photo to one pixel of the screen) and the zoom level,
  which works as Lopsy's does: drag left or right on it to zoom out or in
  (1 % a pixel, 10 % to 400 %), and double-click it for 100 %. On the
  right, two icon buttons: **Before** (or hold `\`) and **Split** (before
  and after side by side, with a divider to drag).
- **Pixel readout**: the rendered colour under the pointer (R G B,
  0–255).
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
- **Straighten**: Angle, and **Level** (draw along something that should
  be level). The crop shrinks to the largest rectangle inside.
- **White balance**: under its heading, a **Mode** menu (As shot; Auto,
  on RAW files; the RAW file's presets — Daylight, Cloudy, Shade,
  Tungsten, the fluorescents, Flash, Underwater, as the body has them;
  and Custom, which the sliders set) and a **picker** (the pipette):
  while it is armed, "Click something neutral · Esc to cancel" shows on
  the photo, and a click sets Temperature and Tint to neutralise that
  spot. Then Temperature and Tint. On RAW files the Temperature readout
  shows Kelvin and takes typed Kelvin (clamped to 2000–50000 K; text
  that is not a number puts the readout back), and the group waits,
  "Reading the camera's white balance…", until the photo is read. On
  other photos the sliders are relative. Each choice, pick or slider
  release is one history step ("White balance: Daylight", "White
  balance: picked", "Temperature 6500 K" on RAW).
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
- **Local contrast** (Large details, Small details, Haze) and **Sharpness
  & noise**.
- Every group has a **Reset**. The sliders are Lopsy's: the name on the
  left, the track, then a value field that takes a typed number (↑ and ↓
  step it). A changed slider's track fills in blue from its default to the
  thumb, so the changes in a group show at a glance; a change too small to
  clear the thumb shows none. Clicking the track moves the value to that
  point, and dragging follows the pointer; the arrow keys step it, Page
  Up and Page Down by a tenth of its range, Home and End go to its ends.
  Double-clicking the name resets it (on the track, the first click of
  the two also moves it there, a step of its own). Each change is one
  history step named after it ("Exposure +0.50"); a click or key that
  changes nothing makes none.
- **Crop** tool: drag the frame; **Aspect** Free, Original, 1 : 1,
  4 : 5, 3 : 2 or 16 : 9, made landscape or portrait; Reset, Done (Enter)
  or Cancel (Escape). The crop follows rotation and flips. These options
  sit at the bottom of the stage, and while Crop is open a fitted photo
  is fitted above them, so they do not hide its bottom edge (when a
  zoomed photo would put that edge under them, they go to the top). Their
  grip has a column of its own at their left: dragging it puts them
  anywhere on the photo, and clicking it sends them to the top or the
  bottom. The next crop on this device opens with them where they were
  put, in the same corner when the window is another size, and the photo
  at its usual size.
- **Masks** (toolbar): add **Linear** (a gradient across the photo) or
  **Radial** (an ellipse) masks, up to eight. Each row of the list has
  the mask's name ("Mask 1" until it has its own), Rename, **Invert** (a
  toggle: the adjustments go to the rest of the photo) and Delete. Under
  the list come the selected mask's Amount and its own Exposure,
  Contrast, Highlights, Shadows, Temperature, Tint and Saturation, then
  **Position**, closed at first, which opens to the mask's shape
  sliders. Handles on the image move the selected mask, resize it, turn
  it and set its feather; each drag or slider release is one history
  step ("Mask: move"). The selected mask shows in red on screen (never
  in exports, previews or the histogram) while its shape changes and for
  a second after, and for a second after it is added, chosen or
  inverted; it hides while its Amount or an adjustment slider is
  dragged. **Show mask** (O, in the panel's header) shows it the rest of
  the time too. The recipe stores masks as `areas`, on the unrotated
  photo, so they follow rotation, flips, straightening and the crop.

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
- Progress: a bar filled by the photos done, with a moving stripe while
  one renders (a full-size RAW can take a while), full when finished.
- An export can **keep going in the background** while the user goes on.

## Lopsy round trips

Photonamous and Lopsy talk over `window.postMessage` (`packages/handoff`); Lopsy
never talks to Google. Lopsy's side is in `apps/lopsy-web/FEATURES.md`
(Photonamous Round Trip).

- **Edit in Lopsy** (grid toolbar, tile menu, Single view, Edit view):
  opens Lopsy in its tab (`lopsy-editor`)
  from the click or key press. A photo goes as
  its developed full-size 16-bit PNG with its source (library, asset,
  version, recipe hash) and a camera summary; a Lopsy document goes as its
  `.lopsy` with the file's current revision (read until stable). In Single
  view a document's button is **Open in Lopsy**, beside Edit, which edits
  its flattened render here (see the Edit view).
- **Save to Photonamous** (in Lopsy): the `.lopsy` and a flattened 16-bit
  PNG come back and are stored in `Lopsy documents/` as a document
  asset, stacked behind the photo it was made from, with previews. Saving
  again updates the same document in place; if it changed elsewhere since
  Lopsy opened it, the save becomes a copy ("<name> 2"). A toast reports
  each save.
- **Add to Photonamous** (Lopsy's File menu) and saves from a Lopsy tab
  whose Photonamous tab is gone open Photonamous at `?receive=<id>`, which stores
  the save and says so in a toast.
- **Grade in Photonamous** (Lopsy's Layer menu and layer right-click
  menu): opens Photonamous at `?grade=<id>`, straight into the Edit view on
  that layer with no library or start screen. The layer arrives at
  16 bits with its transparency, and is edited with the non-RAW pipeline.
  Each grade has a tab of its own. **Done** sends the full-size 16-bit PNG
  and the recipe back, and the tab closes; **Cancel** sends nothing. A
  render Lopsy would refuse (the wrong size, over 1 GB) is reported to
  Lopsy as a failure and the tab stays open to say so.

## Errors

- If the app stops rendering, it shows **Something went wrong** with
  **Reload** instead of a blank page; the library is saved as it changes.

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
  device's queue and are saved when storage is reachable again. Photonamous
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

## Accessibility

The app aims at WCAG 2.2 level AA. `e2e/accessibility.spec.ts` walks every
view as a user reaches it and runs axe-core's WCAG 2.2 A and AA and
best-practice rules at each step; the `a11y-*.spec.ts` and
`character-keys.spec.ts` specs drive the same views by keyboard.

- **Colour and size.** Text meets 4.5:1 and control edges and focus rings
  3:1 on every surface: primary buttons are a darker blue (#1f6fd6) and
  danger buttons a darker red (#c62828) under white text, and secondary
  text is #adadad. Every control is at least 24 × 24 px, or 24 px from
  its neighbours. Every control shows a light-blue focus ring when it is
  reached by keyboard. Animations stop when the system asks for reduced
  motion.
- **Single-key shortcuts** (1–5, the label letters, X, R, J, ?…) can be
  turned off in Settings > Keyboard, for speech input or stray key
  presses. Shortcuts with Ctrl or ⌘, the arrow keys, Space, Enter and
  Escape keep working, and text fields get every key. The choice is kept
  on this device.
- **The library by keyboard.** The header, the Library navigation and the
  photos are landmarks with headings, which screen readers jump between,
  and the page title names the view ("All photos – Photonamous"). Enter,
  Space and the arrow keys act on the focused button, checkbox or slider;
  the library's shortcuts take them only on a photo.
  - The photo grid is one Tab stop. The arrow keys move and select; Shift
    extends the selection, Ctrl or ⌘ moves without selecting, and Ctrl or
    ⌘ with Space adds or removes a photo. Home and End go to the first
    and last photo, Page Up and Page Down a screen at a time, and Shift+F10
    or the Menu key opens the photo's menu. Escape clears the selection
    and keeps your place.
  - Focus returns to the photo you were on after Single view, Compare,
    Cull, Edit, a dialog or the menu, and stays on a photo when photos are
    deleted, dropped or filtered out.
  - The large photo in Single view and Cull zooms from the keyboard (Enter
    or Space; the arrow keys pan, Escape fits), and in Compare Left and
    Right choose the marked photo.
  - Screen readers hear the photo count as filters and selections change,
    the photo and its position in Single view and Cull, import milestones
    (failures at once; a clean import's outcome once, as its message), and
    leaving full screen.
  - Below 760 px wide, or at 200 % zoom, the library is one scrolling
    column: header, sidebar, grid, details.
- **Dialogs.** Tab and Shift+Tab stay inside the open dialog; Escape
  closes only the topmost dialog or popover, and focus goes back where it
  was. Delete opens on Keep, Settings on its first heading.
- **Popovers** (sync, keyboard shortcuts, filters): focus moves in when
  one opens and back when it closes; they close when focus moves out. The
  shortcut list scrolls with the arrow keys.
- **Menus** (More, Photo actions, Presets, Import photos): they open on
  the first item; the arrow keys move (wrapping), Home and End jump, a
  letter jumps to the next item starting with it, Enter or Space chooses,
  Escape closes with focus back on the button, and Tab closes and moves on.
- **Rating stars and colour labels** are one Tab stop each; the arrow
  keys choose, Space on the chosen star clears the rating, and every
  label is named in words ("Red label").
- **Toasts.** They sit at the bottom right, clear of the panels that float
  over the photo. Errors are announced at once and other messages politely. A
  toast stays while it is hovered or focused, Escape dismisses it, and
  its Undo also dismisses it.
- **Announcements.** Saving state, originals downloads, Check library's
  findings, an export's start and end, and "Link copied." are announced
  politely and once.
- **Edit view.** The photo is the page's main content with its file name
  as the heading, and the page title is "<file> – Edit – Photonamous".
  Opening it focuses the heading and closing it gives focus back. Asked
  for a Lopsy document without a render, it shows the document's name as
  a focused heading instead, and Escape goes back as it does from the
  Edit view.
  Screen readers hear when the photo is ready, export progress, and what
  Undo or Redo did; errors also show on screen with Dismiss.
  - *Crop*: each edge is a slider. The arrow keys move the focused edge,
    Shift or Page Up/Down by 10 %, Home and End to the photo's side; Left,
    Top, Width and Height fields set the crop in pixels. Opening Crop
    focuses the top edge, and focus returns to Crop when it closes. The
    options' grip ("Move crop options", next after the edges) takes the
    arrow keys, 10 px a press or 50 px with Shift, and Enter or Space
    sends the options to the top or the bottom without applying the crop.
  - *Masks*: under **Position**, a button that opens and closes, the
    selected mask's shape sliders set Start and End X and Y (linear), or
    Center X and Y, Width, Height, Turn and Feather (radial), in percent
    of the photo as shown. Each row has Rename, and Invert says whether
    it is on.
  - *Curves*: points are sliders. Up and Down change the output, Left and
    Right the input (Shift for ten levels), Delete removes a point, and
    Add point adds one in the widest gap.
  - With the photo focused, the arrow keys move a zoomed photo and + and
    − zoom. The before/after divider takes the arrow, Page, Home and End
    keys.
  - The zoom level under the photo is a button: Enter or Space gives
    100 %, and the arrow keys step to the next 10 % (Right and Up in,
    Left and Down out) without changing photo.
  - The histogram's clipping markers are outlined, or filled when that
    end clips; its channels are solid, dashed and dotted lines, named in
    a key. The current history step and version are marked by a bar as
    well as by colour.
  - Exposure and Angle tell screen readers their units ("+0.50 EV").

## Keyboard shortcuts

Shown in the app with `?`. The one-key shortcuts below (digits, letters,
`?`) can be turned off in Settings > Keyboard.

| Keys | What |
|---|---|
| 0–5 | Rating (0 clears) |
| R Y G B P | Red, yellow, green, blue, purple label (again removes it) |
| X | Drop, or bring back |
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

In the Edit view: ⌘Z undo, ⇧⌘Z or ⌘Y redo, ⌘0 fit, ⌘1 full size (100%), ⇧⌘C and
⇧⌘V copy and paste edits, hold `\` for before, J for clipping, R crop,
M a linear mask, ⇧M a radial mask, O Show mask (with Masks open), ← →
the previous or next photo, Escape back to the library (or out of the
tool in use), ? the Edit view's shortcuts. With the photo focused, the
arrow keys move a zoomed photo and + and − zoom.
