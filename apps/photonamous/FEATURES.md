# Photonamous feature catalog

What Photonamous does today, as the code and its e2e specs show it.
Current behaviour only; bugs live in GitHub issues. The design behind it
is `docs/photonamous-spec.md`; running and setup are in
`docs/photonamous-setup.md`.

## Storage and sign-in

- **Start screen.** The page a visitor lands on, in two columns. The left
  two thirds is a short film of the app; the right third, which stays in
  view, has the wordmark in colour as wide as the column, the line "RAW editing.
  Your cloud storage. Completely free.", **Try it now**, and links to
  Privacy and Terms, with GitHub's mark at the right linking to the
  source. On a window under 860 px wide
  the film sits above the rest and the page scrolls.
- **Try it now** opens **How it works**: three steps side by side, each
  with a drawing. Step 1, Connect with Google: Photonamous has access
  only to the one folder it creates in the visitor's Drive. Step 2,
  Upload your photos: RAW, DNG, JPG and other common types, stored in
  their Drive and nowhere else. Step 3, Edit and export. Under them is
  **Continue with Google**, which has focus, and a line saying what Google
  will ask. On a narrow window the steps stack. A failed sign-in is said
  under the button.
- **The film** on the left is a silent trailer of about 24 seconds, cut
  from the app itself and looping: the library under the title "Your
  photos."; a photo picked and given five stars; a timelapse of a real
  edit of a RAW file, all 41 of its steps, under "Professional editing."
  and "In your web browser."; before and after under the split divider;
  "No servers."; "Your own cloud storage."; the library in Google Drive,
  clicked through from its folder to a day's originals; "Completely
  free.", which dissolves into an end card, the wordmark in colour and the start screen's
  line, "RAW editing. Your cloud storage. Completely free.", over a
  photograph from the library.
  It starts by itself, muted,
  from a poster; a **Pause the film** button stops it. A visitor who asked
  for reduced motion or to save data gets the poster and **Play the
  film**, and the video is not downloaded until they press it. What it
  shows and says is also there as text for assistive technology. It is
  under two megabytes (AV1, with H.264 for browsers without it) and is not
  part of the offline shell.
- **Google Drive is the only storage a production build offers.** The
  library lives in the user's own Drive, so every computer that signs in
  sees the same library. It needs a Google client ID
  (`VITE_GOOGLE_CLIENT_ID`); a production build without one says sign-in
  is not set up.
- **Libraries on this computer are for development.** A development build
  (and a production build made with `VITE_LOCAL_LIBRARIES=true`, as the
  site tests are) also offers, under "Development builds only":
  - **This browser**: private storage inside this browser on this computer
    (the origin private file system). Clearing the browser's data removes
    it.
  - **A folder on this computer**: the user picks a folder; photos and the
    library are kept there as ordinary files. Needs the File System Access
    API (Chromium).
- **Reopening.** The library from the last visit is offered first
  ("Open your Google Drive library", with **Use a different Google
  account** under it; in development also "Open your library in this browser" and "Reopen
  the folder …").
- **Sign-in.** Google sign-in asks for one thing, the `drive.file` scope,
  so the app sees just the files it made or the user picked. It does not
  ask for the name, email address or profile, and never learns them. To
  keep one Google account's library apart from another's in the same
  browser, and to refuse a reconnect with the wrong account, it reads
  Drive's own opaque ID for the account and nothing else about it. With
  no email to hint with, Google's window shows its account chooser.
  Tokens stay in memory. Google's token lasts an hour and can only be
  renewed through Google's own window, which a browser opens from a
  click; so once the token is 45 minutes old, the next ordinary click in
  the app renews it. Google's window opens and closes by itself. If
  several Google accounts are signed in, Google cannot tell which is
  meant and the click after that shows its account chooser once; closing
  it leaves things as they are. When a token does run out (the app was
  left untouched past the hour), the header offers **Reconnect Google
  Drive**; nothing else is lost.
- **Add from Google Drive…** (the Import menu, Drive libraries only):
  picks photos already in Drive with Google's Picker and adds them to the
  library; Settings chooses whether they are moved into `Originals/` or
  left where they are. The Picker opens in the page. Some browsers keep
  it from seeing the user's Google account there (those that block
  cross-site cookies; Brave does), and it then shows Google's sign-in
  page instead of files. So a prompt under the Picker, "Google asking
  you to sign in?", offers **Open in a Google window**: the same Picker
  in a window of Google's own, where the user chooses their account and
  agrees each time. Taking it is remembered on the device, Brave starts
  with the window, and Settings > Adding from Google Drive has the
  choice. Photos picked in another Google account than the library's are
  refused with a message.
- **Where the library lives** is named in the header, beside the
  wordmark: "Google Drive", "This browser" or the folder's name. A Drive
  library is called "Google Drive" everywhere (Settings, the import
  dialog's free-space line): the app does not know whose it is.
- **Close this library** (header) goes back to the start screen.
- **Layout in storage.** A `Photonamous/` folder holds `Originals/`
  (filed by capture year and month), `Lopsy documents/`, `Exports/` and
  `Library data/` (the journal, snapshots, previews and device records).
  Originals are never modified or permanently deleted.

## The library

### Grid

- Photos in a virtualised grid, newest first by default. **Order by**
  (in the row of filters under the toolbar) Date taken, Date added, Last
  edited, File name or Rating, each in its natural direction (newest,
  most recently edited and best first; names A to Z); the arrow beside it
  reverses the order.
- **Toolbar**: *Edits* (**Copy edits**, **Paste**, **Presets**,
  **Reset**), and at the right end Details and **More** (New version,
  Edit in Lopsy, Group bursts). Button titles give each shortcut, read
  from the shortcut list.
- **The bar under the gallery**: **Size** at the left sets the thumbnail
  size; at the right, the ways of looking, as icons of which the current
  one is on: **Grid**, **One photo** (Space), **Two up** (C), **Four up**
  and **Full screen** (F). The same bar, without the size, sits under the photos
  side by side. The Presets and
  More menus open lined up with their button's left edge, or its right
  edge where they would otherwise run off the window (the toolbar wraps
  to the left when the details panel is open).
- **Reset** takes the selected photos back to the original: every edit
  off, crop and rotation included, as one History step for each photo.
  Photos with no edits are left alone.
- Tiles show the photo's 512 px preview, its colour label and stars, and
  badges: a version count, **RAW+JPEG** for a pair shot together (shown
  as one photo, the RAW in front, and counted once everywhere: All
  photos, Dates, Imports), a burst count, and a Lopsy-document count.
  Each of those opens or folds its stack. An edited photo has a mark
  that is not a button: a picture with a tick, in green. Under the
  pointer (and on the tile the keyboard is on, where Tab reaches it) a
  tile has an **Edit** button at its top right, which selects the photo
  and opens it in the Edit view.
- **Previews follow edits.** A preset or pasted edits from the grid, a
  new version, or a change from another device gets new previews in the
  background, one photo at a time, while the Edit view is closed; the
  **Saving and storage** panel shows "Updating N previews". A new
  version with the same edit as another shows that one's preview at once.
  Until a tile's picture has caught up with its edits a turning ring sits
  in the middle of it (named "Updating"), from the moment the edit lands.
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

### Single, side by side and Full screen

- **Single view** (Space, or double-click): one photo large at 2048 px,
  with Previous/Next (← →). Above it, a header of two rows in the bars'
  colour: **Back** (a link at the left edge),
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
- **Two up and Four up**: photos side by side, two or up to four (a 2 × 2
  grid). They show the selected photos; when fewer are selected than the
  view holds, the ones that come after the first of them in the gallery
  fill it (with nothing selected, from the focused photo), and those join
  the selection. C opens Two up for up to two selected photos and Four up
  for more. With more than two on show each has a tick box: tick
  two, and **Two up** shows just those. **Four up** from there widens
  again, and **Grid** goes back.
- **Full screen** (F): one photo at a time filling the screen, laid out as Single view,
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
- **Long lists stay short.** Albums, Saved searches, Dates (its years),
  Imports and Keywords each show their first eight rows, and under
  them **Show all** with the number there are. The row the grid is
  showing stays in the list when it is further down. Opened out, a
  list keeps to about nine rows and scrolls in its own room, so one
  list of eighty albums does not push the others off the sidebar;
  **Show fewer** folds it again.
- **Find photos**, one row under the toolbar: a text search over file
  names, titles, captions and keywords, then filters for rating, label (including *No label*), edits
  (*Edited*, *Not edited*), file type (RAW (Fujifilm), RAW (DNG), RAW
  (Sony), JPEG, PNG, WebP, Lopsy document), camera and lens, and at the right end the
  order. Where the row has not the room for all of that on one line (a
  small window, the details panel open, or filters whose buttons have
  grown with what they are set to), the filters are one **Filters** menu, opened by the button beside the search
  field; it turns blue and counts the filters in use, and **Clear
  filters** is at its foot. **Save search** keeps the filters in the
  sidebar under a name.

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
- **Presets** (grid toolbar): apply one to the selected photos. A
  library starts with five (Cool, Monochrome, Punchy, Soft matte, Warm);
  they and the ones saved from the Edit view are one list, by name, and
  any of them can be deleted there. A deleted starter stays deleted, on
  every device.
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
- Reads **RAF, DNG, ARW (Sony), JPEG, PNG and WebP**, each known by its
  bytes, not its name. The sheet counts what it found, says what it cannot
  read, and shows RAW+JPEG pairs as one photo (or imports the RAW only).
  An ARW (lossy, uncompressed or lossless) shows in the library with the
  camera's full-size embedded JPEG as its preview and the picture's size
  (the camera's crop, not the sensor's). Sony's older SR2 and SRF files
  are not read.
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

Opened with Enter (in the grid, Single view or Full screen) or **Edit** in Single
view and the tile menu; double-clicking a tile opens Single view, not
Edit. One photo, a left column, the image and a panel of groups; edits
are saved to the version as they are made, and previews are rendered when
the edit settles (never during a slider drag), on leaving, and before the
filmstrip opens another photo.

The app's header stays on screen above the Edit view, in use: the saving
panel, Import photos, Export, the shortcut list, Settings and Close this
library all work from there, and their dialogs open over the Edit view.
Only the library under the header is out of reach while editing. Export
is the header's alone (the Edit view has no button of its own) and reads
"Export 1" here: it takes the photo and version being edited, whatever
is selected in the grid under it.

A Lopsy document opens here on its flattened render, the PNG Lopsy saves
beside the `.lopsy`: its edits, versions, presets, copy and paste and
exports work as a photo's do, on top of that render, and the `.lopsy`
itself is untouched (Edit in Lopsy still sends it as it is). When Lopsy
saves the document again, its edits here apply to the new render, and
its previews are rendered again with them. The render is read from
storage each time a document opens: it is not kept in the device's cache
of originals. A document without a render opens only in Lopsy: should the
Edit view be asked for one, it names the document, says it was saved
without a picture to edit here, and offers **Open in Lopsy** and **Back**.

A version edited with a newer version of Photonamous (a newer editing
engine, opened in an older copy of the app the browser still has) does
not open here either: the Edit view names the photo, says the app needs
updating to show or change its edits, and offers **Reload** and **Back**.
Nothing in the app changes such a version meanwhile: a preset, pasted
edits or Reset from the grid passes it by, and its previews stay the ones
the newer version made.

- **Loading and working size.** RAF, DNG and Sony ARW decode on a pool of
  workers into the engine's RAW develop stage. A DNG the RAW path cannot
  read (a lossy one), and DNG and ARW on a GPU without float targets,
  open as the engine's finished picture and are edited as an ordinary
  photo; when that cannot be read either, the Edit view says why. 16-bit
  PNG at full depth; JPEG and WebP through the browser. Editing starts on
  a *working image* sized to the view (at most 4096 px on its long edge;
  a RAW file binned by a whole factor, so one less than twice that size
  opens at full size), so a large photo is editable quickly; zooming
  to 50 % or closer loads the full resolution ("Loading full
  resolution…"), and Edit in Lopsy and Done always render from it. While it loads, the version's stored preview shows
  with "Loading…".
- **Left column**: **Presets** (apply one, delete one, or **Save
  preset…** from this edit, choosing its groups), **Versions** (switch, rename, **New
  version**) and **History** (every step; clicking one goes back to it).
  The button beside Back folds the column into a strip of three icons,
  one for each; an icon opens the column again with its section unfolded.
  A **filmstrip** of the photos around this one
  moves between them, in the grid's order: a photo whose stack is open in
  the grid shows each version as a tile of its own (named "<file>
  (<version>)", with that version's preview), which opens that version.
  Lopsy documents are in it too.
- **Top bar.** Back, the button that folds the left column, then the
  tools in four groups with a line between them: the two clipping warnings (a moon for shadows, a
  sun for highlights; see Histogram below); Rotate left, Rotate right,
  Flip, Flip vertical and **Crop**; Undo / Redo (⌘Z, ⇧⌘Z or ⌘Y); and
  Copy edits / Paste edits (⇧⌘C, ⇧⌘V). The image pans by dragging and zooms with the wheel.
- **Toolbar**, icons down the right edge, as Lopsy's panel toolbar is.
  **Edit** and **Mask** each open their panel beside it, with the
  histogram above; the one whose panel is open is blue, and pressing it
  again closes the panel and gives the photo the room. Under them,
  **Edit in Lopsy** (the paintbrush) sends this version to Lopsy.
- **Edit panel.** The profile, then a section for each group of
  controls: Straighten, White balance, Tone, Curves, Color, Color by
  hue, Color Grading, Local contrast, Sharpness & noise and Finish. Each
  is folded to its heading until it is opened, and one is open at a
  time, as a group's effects are in Lopsy: opening a section folds the
  one that was open. The one open is remembered on this device. A
  heading keeps its Reset (and Auto or Level) while
  folded, and has a dot after its name while its controls are not at
  their defaults. **Reset all** is at the foot.
- **A section's eye.** Every section but Straighten has an eye at the
  right of its heading. It shows the photo without that section, as its
  Reset would leave it, and changes nothing in the edit: the history,
  the previews, Export, Done and Edit in Lopsy keep the section. While a
  section is hidden its eye is blue, its controls wait, and the photo
  says which are left out ("Without Tone", "Without Tone and Color",
  "Without 3 sections"). Any number can be hidden at once; they are
  shown again on another photo or version. A mask has the same eye (see
  Mask below).
- **The bar under the photo.** On the left, the zoom level, a field to
  type in: a percentage from 10 to 400, with or without its sign, taken
  on Enter or on leaving the field (a level outside the range is held to
  it, and what is not a number puts the level back). Beside it, **Fit**
  (⌘0) and **Full** (⌘1: one pixel of the photo to one pixel of the
  screen). On the
  right, two icon buttons: **Before** (or
  hold `\`) and **Split** (before and after side by side, with a divider
  to drag), each blue while it is on, as Crop is in the top bar.
- **Pixel readout**: the rendered colour under the pointer (R G B,
  0–255): the photo's, never the clipping warning's or a mask's red
  painted over it.
- **Histogram** of the rendered edit, updated as it changes. Its shadow
  and highlight markers light when the photo clips, and clicking them
  shows clipped pixels on the photo (blue at black, red at white; never
  in exports or previews); **J** toggles both. The moon and sun buttons
  in the top bar are the same two toggles: each lights when
  its end clips and is pressed while its warning shows. Holding Alt (Option)
  while dragging Blacks or Whites shows that side's clipping, and while
  dragging a Sharpen slider shows what is being sharpened.
  While the Edit view shows the HDR rendering (an HDR display on WebGPU,
  with the status bar's HDR switch on), the histogram draws that
  rendering instead, from black to the HDR peak, with a dashed line and
  the word "White" where ordinary white sits, so the part to its right is
  brighter than white; its highlight marker then counts what reaches the
  peak, as the clipping warning does on the photo. Its text alternative
  says how much is brighter than white. Auto and every other reading use
  the ordinary rendering whatever the view.
- **Straighten**: Angle (−45..45°), and **Level**: draw along something
  that should be level (or upright) to set it.
- **Profile**: for RAW, the camera's look first ("Camera (Velvia look)",
  not listed a second time), then the engine's film looks with Provia
  shown as "Standard (Provia look)" (or "Camera (Provia look, Standard)"
  when the camera shot Provia), Neutral and Monochrome; for a DNG or a
  Sony ARW, Standard, Neutral and Monochrome; for other photos, Standard
  and Monochrome. Eleven Sony bodies have colour computed from measured
  sensor data (RX100 IV, A6400, A7C II, A7 III, A7 IV, A7R II, A7R III,
  A7R IV, A7S II, A7S III, A9). For any other body the colour is only
  approximate (the file carries part of the camera's colour, so it is
  less saturated than the camera's JPEG): the decoder's sentence saying
  so sits in small text under the Profile menu, which a screen reader
  reads with the menu.
- **Straighten**: Angle, and **Level** (draw along something that should
  be level). The crop shrinks to the largest rectangle inside.
- **White balance**: under its heading, a **Mode** menu (As shot; Auto,
  on RAW files; the RAW file's presets — on a RAF, the camera's own,
  read from the file: Daylight, Cloudy, Tungsten and three fluorescents
  (daylight, day white, cool white), none on a RAF whose header does not
  hold them (one whose values are those of another is listed once); on a DNG or a Sony ARW with
  measured colour, the standard illuminants Daylight, Cloudy, Shade and
  Tungsten through the file's own calibration; none on an ARW without);
  and Custom, which the sliders set) and a **picker** (the pipette):
  while it is armed, "Click something neutral · Esc to cancel" shows on
  the photo, and a click sets Temperature and Tint to neutralise that
  spot. Then Temperature and Tint. On RAW files with Kelvin (RAF, DNG,
  an ARW with measured colour) the Temperature readout shows Kelvin and
  takes typed Kelvin (clamped to 2000–50000 K, then to what the slider
  reaches, with the readout showing the Kelvin reached; text that is not
  a number puts the readout back): a RAF's from a scale fitted through
  the camera's illuminant A and D65 whites in the file (none without
  them), a DNG's or ARW's measured, the colour temperature of
  the white both sliders make, exactly the file's as-shot Kelvin at As
  shot. On an ARW without measured colour Temperature is relative. On
  every RAW file the group waits,
  "Reading the camera's white balance…", until the photo is read. On
  other photos the sliders are relative. Each choice, pick or slider
  release is one history step ("White balance: Daylight", "White
  balance: picked", "Temperature 6500 K" on RAW).
- **Tone**: Exposure, Contrast, Highlights, Shadows, Whites, Blacks, with
  **Auto**, which the engine sets conservatively, as one history step;
  pressing it again changes little. The tone sliders work on the photo's
  light before it is made into a picture, in stops: Exposure is in EV,
  and Shadows and Highlights lift or lower a range of stops rather than
  a range of screen values. Highlights pulled down brings back detail
  in highlights the default rendering shows as white, a RAW file's
  clipped highlights included (the decoder rebuilds those from the
  channels that did not clip). Auto measures the photo's light the same
  way.
- **Color**: Vibrance, Saturation. Colour (these, Color by hue and Color
  Grading) is adjusted in a perceptual colour space (OkLab), so a change
  of saturation or hue keeps a colour's brightness.
- **Curves**: a luminance curve and red, green and blue curves, edited by
  dragging points. They apply to the rendered picture, as they look on
  screen.
- **Color by hue**: Hue, Saturation and Luminance for eight bands (red,
  orange, yellow, green, aqua, blue, purple, magenta).
- **Color Grading**: a tab each for shadows, midtones, highlights and
  global, then Blending and Balance. A tab has a **colour field**, a
  square as wide as the panel with hue running left to right and
  saturation fading to white at the bottom: a click or a drag sets both
  at once, as one step ("Shadows color"), and a marker shows the colour.
  Over the field the pointer is a ring filled with the colour under it,
  the one a press there would pick.
  The field keeps hue and saturation to a tenth, finer than the
  sliders' whole steps, so every pixel across it is a colour of its
  own. The arrow keys move the marker a step (ten with Shift, a tenth
  with Alt). Under it are Hue, Saturation and Luminance sliders; the
  Hue and Saturation boxes show the tenth and take a typed one. The
  button in the field's bottom left corner **enlarges** it to about
  500 px, out of the panel and over the photo, which makes it 500
  colours across in place of the panel's 268; any click (the one that
  picks included), a turn of the wheel, a scroll or Escape puts it back.
  An exported XMP sidecar has these values as whole numbers, as
  Lightroom keeps them.
- **Local contrast**: Large details, Small details, Haze. Large and small
  details work on brightness in linear light, without the bright or dark
  rims a strong setting used to leave along edges; Haze works on the
  photo's light before the tone sliders.
- **Sharpness & noise**: Sharpen, Radius, Edges only, Noise, Color noise,
  Keep detail. While a slider drags these passes are left out, and they
  come back when it settles.
- **Finish**: Vignette, with its Midpoint, Roundness and Feather; and
  Grain, Grain size and Roughness. Grain is the same on every render and
  export of a photo.
- **Local contrast** (Large details, Small details, Haze) and **Sharpness
  & noise**.
- **Slider ranges.** Where a value past 100 means something the slider
  runs to 150, and 100 is no longer its end: Temperature and Tint run
  −200 to 200 (a camera's own presets reach that far); Contrast,
  Highlights, Shadows, Whites and Blacks run −150 to 150;
  Vibrance, Saturation, a band's Color by hue saturation, Large details
  and Small details −100 to 150 (−100 is grey, or the detail taken away
  exactly); Color by hue's hue and luminance and Color Grading's
  luminance and Balance −150 to 150; Haze −150 to 100 (100 takes away the
  whole haze it measures); Sharpen, Edges only, Noise, Grain and Grain
  size 0 to 150. A mask's Temperature and Tint run −200 to 200, its
  Contrast, Highlights and Shadows −150 to 150, its Saturation and Large
  details −100 to 150, and
  its further adjustments as the photo's. The rest keep their ends, which
  are real ones: Exposure (±5 EV, a mask's ±4), Radius (pixels), Angle
  (degrees), Color noise and Keep detail (0 to 100), Color Grading's hue
  (0 to 360), saturation (to the colour field's edge, 100) and Blending,
  the Vignette's amount (±100 takes the corners to black or white) and
  its Midpoint, Roundness and Feather, Roughness, and a mask's Amount and
  Feather. A typed value past the end is held to it. A camera's
  white-balance preset is its own Temperature and Tint wherever they are
  within ±200 (before, ±100 cut some off, most often Tungsten); past 200
  it is held there. On RAW files the Kelvin readout shows "—" where the
  body's fitted scale passes infinite Kelvin, which on most bodies is
  between about 100 and 150.
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
- **Mask** (its own panel, from the toolbar): linear masks (a gradient
  across the photo) and radial ones (an ellipse), up to eight. Each mask
  is a section, as the Edit panel's are: its name ("Mask 1" until it has
  its own) opens and folds it, a pencil beside the name renames it, and
  at the right of the heading are Delete and its eye; a dot after the
  name says its adjustments are in use. One is open at a time, and the
  open one is the selected one, whose handles are on the photo. Inside:
  its kind and **Invert** (a toggle: the adjustments go to the rest of
  the photo), **Amount** and its own Exposure, Contrast, Highlights,
  Shadows, Temperature, Tint and Saturation (worked out as the photo's
  own sliders are, so a mask's Temperature or Exposure moves as far as the
  photo's does), then **Position**, closed
  at first, which opens to the mask's shape sliders, and at the bottom
  **Add adjustment**, as Lopsy's adjustments have. It gives the mask a
  further adjustment of its own, any of the Edit panel's other
  sections: **Whites & blacks**, **Curves**, **Vibrance**, **Color by
  hue**, **Color grading**, **Local contrast**, **Sharpness & noise**
  and **Vignette & grain**, each with the controls it has in the Edit
  panel (the curve editor, the tabs, the colour field), for that mask
  alone. They show in the Edit panel's order, each under its name. A
  further adjustment is drawn as the mask's own layer: the photo with
  all its other edits is run through the mask's settings and laid over
  the photo with the mask as its opacity (so Amount and Invert apply to
  it too), in previews and exports alike. So a mask's noise reduction
  and local contrast work on the edited photo, after tone and colour.
  The × beside an adjustment's name takes it off the mask again (back
  to its defaults, as one step), and a mask that is using one shows it
  when the panel opens. Sharpening, noise reduction and local contrast
  of a mask wait while a slider is dragged, as the photo's own do.
  The **eye** shows the
  photo without that mask and changes nothing in the edit, as a
  section's does ("Without Mask 1"). With no mask yet, the middle of
  the panel has one button, **Add a mask**. A bar at the foot of the panel
  stays in place while the masks scroll: **New mask** (a menu: Linear,
  Radial) and **Duplicate mask** (a copy of the open one, in the same
  place, with its adjustments, Amount and Invert).
  Handles on the image move the selected mask, resize it, turn it and
  set its feather; each drag or slider release is one history step
  ("Mask: move"). The selected mask shows in red on screen (never in
  exports, previews or the histogram) while its shape changes and for a
  second after, and for a second after it is added, chosen or inverted,
  or its eye is turned back on; it hides while its Amount or an
  adjustment slider is dragged. **O** (Show mask) keeps it shown the
  rest of the time too; the panel has no button for it. The recipe stores masks
  as `areas`, on the unrotated photo, so they follow rotation, flips,
  straightening and the crop.

## Export

- **Export…** (header, tile menu): the selected photos' versions, or in
  the Edit view the one being edited, rendered by the engine at full
  quality.
- **File type**: JPEG with **Quality**, PNG 16-bit or 8-bit, or TIFF
  16-bit (full size, no EXIF). **Colours**: sRGB or Display P3 for every
  file, and Rec. 2020 for a 16-bit one (TIFF, or a 16-bit PNG at its
  original size). Each file's pixels are rendered straight into the space
  chosen, and every file says which space it is in: an ICC profile (and
  for a wide-gamut PNG a `cICP` chunk), or the `sRGB` chunk for an sRGB
  PNG.
- **HDR files**, offered whatever the display (a file can be HDR even if
  this screen is not), under their own heading in File type, each with a
  line saying what it is:
  - **HDR JPEG (gain map)**: an ordinary sRGB JPEG, the same picture as
    the JPEG export at the same size and quality (its base is that
    export), carrying a half-size gain map
    (ISO 21496-1, with the Ultra HDR metadata). It is designed to open
    as an ordinary photo everywhere and with its highlights in HDR in
    Chrome, Edge, Safari 26 and on Android. **Quality** applies to both
    pictures.
  - **HDR PNG (16-bit, PQ)**: 16-bit Rec. 2020 with the BT.2100 PQ curve
    (`cICP`, with mastering and light-level chunks), SDR white at 203
    cd/m², made for HDR viewers such as Safari 26. No quality setting.
  Both hold highlights up to four times SDR white (two stops), the same
  peak the HDR view shows. They take the Size choices as JPEG does,
  smaller but never larger than the photo: at a smaller size the engine
  reduces the HDR picture before its output step, and the gain map is
  worked out against the engine's own sRGB picture at that size, which is
  within one 8-bit step of the base on average. Neither
  has a colour choice (the Colours field says what each is). A photo
  with nothing brighter than white still exports; its file simply has no
  headroom. They keep EXIF as the other formats do, and batch exports and
  ZIPs work with them. They need floating-point rendering: on the 8-bit
  fallback the dialog says they are not available, and why. A file that
  cannot be made (a very large photo can need more memory than the
  browser allows) fails with a message saying so, in the dialog and in a
  toast. **Unverified by a person on an HDR display**: whether Chrome,
  Edge and Android show the gain-map JPEG in HDR, and whether Safari and
  Lightroom show the PQ PNG in HDR; Apple's ImageIO reads the gain map
  back (plan decision 15).
- **Size**: original, or by long edge, short edge or megapixels, with
  **Don't enlarge** on by default. TIFF is always the full size. The HDR
  files are never enlarged: Don't enlarge is not offered for them, and a
  photo smaller than the size asked for is made at its own size.
- **Details in the file**: all (with **Remove location**, on by default;
  "Location will be kept" shows when it is off), copyright and contact
  only, or none; Creator and Copyright fields.
- **File names**: a template with `{name}` `{date}` `{seq}` `{seq:3}`
  `{title}` `{version}` `{camera}`, and the first name shown.
- **Save to**: the library's `Exports/` folder, or a download: one file,
  or for several either **one ZIP** or each file on its own.
- **Export presets**: the three a library starts with and the user's
  own in one list, saved, renamed and deleted from the dialog; a saved preset keeps every choice above.
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

## Privacy Policy and Terms

- **Privacy Policy** (`/privacy`) and **Terms of Service** (`/terms`) are
  pages of their own, not screens of the app: plain HTML with no script,
  so they can be read with scripting off and by Google's review of the
  sign-in. Each has the way back to the app and a link to the other, a
  skip link, and the shared tokens and fonts; they reflow to a phone and
  print in black on white.
- The Privacy Policy says what the app does with Google data under four
  headings (what it can access, what it does with it, where it is stored,
  who it is shared with), names Google Analytics and Cloudflare, and says
  how to remove everything. The Terms are short: free, as is, no
  liability for lost data, the user's files are theirs.
- The service worker leaves both to the network. They are not in the
  offline shell, so a change to their words is not a new version of the
  app, and offline they fail as any page does.

## Errors

- If the app stops rendering, it shows **Something went wrong** with
  **Reload** instead of a blank page; the library is saved as it changes.

## Devices, offline, sync and settings

- **Setting up your library.** A device that opens a library for the
  first time reads it from storage after the window opens. Until that
  first sync has finished, a library with nothing to show says
  "Setting up your library", not that it is empty; if storage cannot
  be reached, or needs a sign-in, it says "Your library hasn't loaded
  yet" and why. "Your library is empty", with Import photos, is said
  only once the device has synced.
- **Sync.** Every change is an operation in this device's journal in
  storage; other devices' changes are merged in, in any order, with the
  same result. The header shows the state (saved, changes waiting,
  offline, needs attention); the **Saving and storage** panel shows
  changes waiting, when it last saved, where the library is stored and
  how much space it uses, with **Save now** and **Try again**.
- **One tab per library.** A second tab that opens the same library takes
  it over, and the first says so and stops writing.
- **Offline.** In production builds a service worker keeps the app
  shell, so the app starts without a connection; of the editor's two
  engine builds (WebGPU and WebGL) it keeps the one the browser uses,
  once the editor or an import has started it online; changes wait in the
  device's queue and are saved when storage is reachable again. Photonamous
  whose originals are kept on the device can be edited offline.
- **Colour.** Photos are edited in linear light with a wide gamut
  (Rec. 2020) and shown for the screen: on a display with the Display P3
  gamut the editor's canvas is Display P3, on both WebGPU and WebGL, and
  follows the window to another display. Previews in the library are
  sRGB on every display. On a graphics processor that cannot render to
  floating-point targets, photos are developed with the RAW decoder's
  finished look in 8 bits and shown as sRGB, and the status bar says
  "8-bit"; there the tone and colour sliders, curves and Auto work on the
  screen values after the RAW look, as they did before the linear working
  space, so the same edit looks somewhat different there, and a tone,
  white balance or colour slider past 100 (and a mask's) works as 100.
- **HDR on screen.** On WebGPU, while the display reports high dynamic
  range, the Edit view's canvas is HDR (16-bit float, extended tone
  mapping) and highlights above white show brighter than the page's
  white, up to four times SDR white. Where the browser cannot make that
  canvas, on WebGL and on a display without HDR, the photo shows as on
  an ordinary screen, as before. Exports and previews never use it.
  Whether the brightness actually shows has not been checked by a person
  on an HDR display (plan decision 35).
- **Status bar** along the bottom of the window, in the library and the
  Edit view (not on the start screen or in Full screen): at the left, the
  number of photos shown and, when any are, how many are selected; in the
  Edit view, the photo's size and the size it is being edited at ("full
  size" once the full resolution is loaded). At the right, the engine
  that draws (WebGPU or WebGL, once it has started) and the display's
  colour (sRGB or Display P3), then, while the canvas really is HDR,
  "HDR" and a sun button beside it: pressed, the Edit view shows the HDR
  rendering; not pressed, it shows the photo as an ordinary screen will,
  which is how most people who receive it will see it. Its name says
  what it does ("Show highlights in HDR"), it is a toggle (pressed or
  not) reached with Tab, and its choice lasts until the page is closed;
  it is not stored. Each item says what it is to a screen reader
  ("Renderer: WebGPU").
- **Graphics.** The editor draws with WebGPU where the browser offers
  it, and with WebGL otherwise, in the same visit and with nothing for
  the user to do. When WebGPU is offered but fails to start, the editor
  changes to WebGL at once, and the browser tab keeps using WebGL until
  it is closed. When the graphics processor stops while a photo is open
  (a driver reset, a GPU crash), the Edit view starts the editor again
  and loads the photo again, and says "The graphics processor was
  reset"; if it cannot, it says so. The edit is never lost: it is in the
  library, not in the editor.
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
    Full screen, Edit, a dialog or the menu, and stays on a photo when photos are
    deleted, dropped or filtered out.
  - The large photo in Single view and Full screen zooms from the keyboard (Enter
    or Space; the arrow keys pan, Escape fits), and in Compare Left and
    Right choose the marked photo.
  - Screen readers hear the photo count as filters and selections change,
    the photo and its position in Single view and Full screen, import milestones
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
  - *Mask*: under **Position**, a button that opens and closes, the
    selected mask's shape sliders set Start and End X and Y (linear), or
    Center X and Y, Width, Height, Turn and Feather (radial), in percent
    of the photo as shown. Each mask has Rename beside its name, Invert
    says whether it is on, and New mask is a menu the arrow keys move
    through.
  - *Curves*: points are sliders. Up and Down change the output, Left and
    Right the input (Shift for ten levels), Delete removes a point, and
    Add point adds one in the widest gap.
  - With the photo focused, the arrow keys move a zoomed photo and + and
    − zoom. The before/after divider takes the arrow, Page, Home and End
    keys.
  - The zoom level under the photo is a text field named Zoom: Enter
    takes what was typed and keeps the field, Up and Down step to the
    next 10 %, and Escape drops what was typed without leaving the
    photo.
  - The histogram's clipping markers, and the moon and sun in the top
    bar, are outlined, or filled when that end clips; the histogram's
    channels are solid, dashed and dotted lines, named in
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
| F | Full screen (marking a photo moves on to the next) |
| I | Show or hide details |
| Delete, Backspace | Move to the trash |
| ⇧⌘C / ⇧⌘V | Copy edits / paste edits |
| Escape | Go back |
| ? | Show the shortcuts |

In the Edit view: ⌘Z undo, ⇧⌘Z or ⌘Y redo, ⌘0 fit, ⌘1 full size (100%), ⇧⌘C and
⇧⌘V copy and paste edits, hold `\` for before, J for clipping, R crop,
M a linear mask, ⇧M a radial mask, O Show mask (with the Mask panel open), ← →
the previous or next photo, Escape back to the library (or out of the
tool in use), ? the Edit view's shortcuts. With the photo focused, the
arrow keys move a zoomed photo and + and − zoom.
