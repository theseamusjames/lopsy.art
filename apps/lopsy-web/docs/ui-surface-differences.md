# Where UI surfaces differ

Many operations can be reached from more than one surface: a menu item, a
key, a panel button, a dialog, the canvas context menu. This document
lists the ones where those surfaces do not run the same sequence, and
what a user can see as a result. Each surface's behaviour is pinned as it
is by the `e2e/surface-*.spec.ts` characterization specs, in tests named
`D<n>: ...` after the entries below; making two surfaces agree, or
changing what one does, is a product change that updates its spec and
its entry here in the same change.

Paths are relative to `apps/lopsy-web/`. A surface that "runs" a command
starts it with `invokeFromUi` (`src/commands/invoke-from-ui.ts`): menus
through `commandItem`, keys through `runKeyCommand` and the table in
`src/app/shortcuts/key-bindings.ts`. A key handler marked exempt in that
table calls the function named instead. An entry whose surfaces now do
the same thing says so and keeps its number, because specs cite it.

## D1 — Deselect

- **Select > Deselect**: `select.none` (commit false): `clearSelection()`
  only.
- **Cmd+D** and **Escape** (when no path draft, popover or text edit takes
  Escape first): `select.none` with `commit: true`, which runs
  `deselectAndCommit()`: `clearSelection()`, `setTransform(null)` and
  `clearPersistentTransform()`.
- **Canvas context menu > Deselect** (`useContextMenu.ts`):
  `clearSelection()`, disabled with no selection.
- **Marquee click with a selection** (`marquee-strategy.ts`):
  `clearSelection()` and `setTransform(null)`.

**Difference**: the menu and the context menu leave the transform box
(`ui.transform`) set and a Move float or multi-layer transform live. Cmd+D
and Escape clear the transform box and commit the float in place.

**Pinned by**: `surface-menu-select.spec.ts` "D1: Deselect clears the
selection but leaves ui.transform set, with no history entry", "D1:
Deselect after a Move drag leaves the Move float and ui.transform in
place"; `surface-keys-edit.spec.ts` "D1: Cmd+D clears the selection and
ui.transform, with no history entry", "D1: Cmd+D after a Move drag
commits the float in place and clears ui.transform";
`surface-keys-tools.spec.ts` "D1: Escape clears the selection and
ui.transform, with no history entry", "D1/D22: Escape after a Move drag
COMMITS the float in place (there is no keyboard cancel)".

## D2 — Paste

- **Edit > Paste**: `clipboard.paste`, which pastes the internal clipboard
  (`pasteInternalClipboard()`) and never reads the system clipboard. With
  the internal clipboard empty it refuses silently.
- **Cmd+V** (exempt: `paste` and `pasteEvent`): the key handler does not
  prevent the default and calls `scheduleFallbackPaste()`, a 200 ms timer
  that pastes the internal clipboard. The browser's `paste` event then
  cancels the timer and `handlePaste` (`useKeyboardShortcuts.ts`) takes, in
  order: text editing (inserts the event's plain text); a Copy or Cut
  newer than the system clipboard (`isInternalClipboardNewer()`): the
  internal clipboard; an image file in `clipboardData.files`, then an
  image in `clipboardData.items`: `pasteImageBlob` (the internal clipboard
  when the image matches it, otherwise `pasteOrOpenBlob`: a new layer at
  0,0, the Move tool, the layer's alpha selected); otherwise
  `navigator.clipboard.read()` for an image, falling back to the internal
  clipboard when there is none or the read is refused. Ignored with an
  aria-modal dialog open.
- **Cmd+Shift+V**: no handler. On macOS, and in Firefox, no paste event
  fires. Chromium on Linux and Windows binds Ctrl+Shift+V to paste as plain
  text and fires the same `paste` event as Ctrl+V, which `handlePaste` takes
  as one.

**Difference**: only the key pastes an image from the system clipboard.
While text is being edited the key inserts text, while the menu pastes
the internal image clipboard as a layer.

**Pinned by**: `surface-menu-edit.spec.ts` "D2: Paste with an empty
internal clipboard does nothing"; `surface-keys-edit.spec.ts` "D2: Cmd+V
with an empty internal clipboard and no clipboard permission does
nothing", "D2: Cmd+V after Cmd+C adds "Pasted Layer" in place, picks Move
and selects its alpha; the native paste event fires", "D2: Cmd+V with an
external image on the system clipboard opens it as a layer at 0,0 (the
menu Paste cannot)", "D2: Cmd+Shift+V has no handler of its own; only the browser decides
whether it pastes", "D2: Cmd+V
is ignored while an aria-modal dialog is open (no paste, no fallback
timer)", "D2/D3: Cmd+V while editing text inserts the system clipboard
text".

## D3 — Edit keys and menu items while text is being edited

- **Keys** (exempt: `textEditingKeys`): Cmd+A selects all of the text. Cmd+C
  and Cmd+Shift+C leave the image clipboard alone; Cmd+X cuts the selected
  text. Cmd+Z, Cmd+Shift+Z, Cmd+D and Cmd+E do nothing.
- **Menus**: the same commands as outside text editing (`clipboard.copy`,
  `clipboard.cut`, `clipboard.copy-merged`, `select.all`, `select.none`,
  `history.undo`, `history.redo`, `paint.fill`). None of them checks for a
  text edit, and opening a menu does not commit or cancel it.

**Difference**: the keys act on the text buffer or do nothing; the menu
items act on the layer and the document history. Edit > Copy copies the
text layer's pixels, Select > All selects the document, Edit > Fill
refuses with the text-layer toast, and Edit > Undo ends the edit and
removes the new text layer (its "Add Text Layer" step goes to the redo
stack).

**Pinned by**: `surface-keys-edit.spec.ts` "D3: Cmd+A selects all of the
text, not the document", "D3: Cmd+C and Cmd+Shift+C leave the image
clipboard alone; Cmd+X cuts the selected text", "D3: Cmd+Z, Cmd+Shift+Z,
Cmd+D and Cmd+E do nothing while editing text";
`surface-menu-edit.spec.ts` "D3: opening and closing a menu does not
commit or cancel the text edit", "D3: Select > All and Edit > Copy while
editing text act on the layer, and the edit stays open", "D3: Edit > Fill
while editing text refuses with the text-layer toast and keeps the edit
open", "D3: Edit > Undo while editing text removes the new text layer
instead of a text change".

## D4 — Delete layer

- **Delete / Backspace** with no pixel selection and outside mask edit
  mode (`handleDeleteKey` in `delete-key.ts`): `layer.remove` on the
  active layer ("Delete Layer").
- **Layers panel > Delete Layer button**: `layer.remove-selected`, every
  selected layer except the root group ("Delete Layers"). Disabled with
  one layer, or with only the root group selected. In mask edit mode it
  still deletes.
- **Delete / Backspace with focus inside the Layers panel** (the panel's
  own `keydown` listener on `document`): `removeSelectedLayers()` directly.

**Difference**: the key removes the active layer, the button every
selected layer, under different history labels; in mask edit mode the key
fills the mask (D26) and the button deletes. With a row button of a
layer other than the active one focused, one press runs both listeners:
the global handler deletes the active layer, the next layer down becomes
active and selected, and the panel handler deletes that one too. With
the active row's own button focused, Chromium unmounts that row first and
only one layer goes; Firefox still runs the panel handler, and two go.

**Pinned by**: `surface-keys-tools.spec.ts` "D4: Delete with no selection
removes only the ACTIVE layer, as "Delete Layer", even with several
selected", "D4: Backspace and Cmd+Backspace delete the active layer like
Delete", "D4: Delete with a non-active row button focused runs BOTH
handlers and removes two layers (pinned as-is)", "D4: Delete with the
active row's own button focused removes one layer in Chromium (its row
unmounts first), two in Firefox"; `surface-panel-layers.spec.ts` "D4: Delete Layer removes EVERY
selected layer, as "Delete Layers"", "D4: Delete Layer is disabled when
only the root group is selected", "D4: Delete Layer in mask edit mode
still deletes the layer (the key fills the mask)".

## D5 — Delete with a pixel selection

- **Delete / Backspace** with a selection: `paint.clear`, which runs
  `clearSelectedLayerPixels()`: commits a Move float or unmoved prefloat,
  pushes "Clear Selection" and clears the selected pixels. The selection
  and the internal clipboard are kept. It checks neither the layer lock
  nor the layer type. With focus in the Layers panel, D4's panel handler
  also runs.
- **Edit > Fill** (`paint.fill`), the nearest menu operation on selected
  pixels, refuses on a locked layer (silently) and on a text or group
  layer (with a toast).

**Difference**: Delete clears pixels on a locked layer, with no toast.

**Pinned by**: `surface-keys-tools.spec.ts` "D5: Delete with a selection
clears the pixels as "Clear Selection" and keeps the layer and selection",
"D5: Delete with a selection clears pixels on a LOCKED layer, with no
toast (pinned as-is)", "D5: Delete after a Move drag commits the float and
clears the moved area". Fill's refusals: `surface-menu-edit.spec.ts`
"Fill on a locked layer does nothing and shows no toast", "Fill on a text
layer refuses with the guardPixelWrite toast".

## D6 — Making a layer active

- **Row click** (`activateLayerFromPanel`): `clearPersistentTransform()`,
  `setActiveLayer(id)`, then mask edit mode off. Cmd-click and
  Shift-click change only the layer selection.
- **Mask thumbnail** (`editLayerMaskFromPanel`): as a row click, then mask
  edit mode on.
- **Effects button** (`selectLayerFromPanel` and the effects drawer): as a
  row click without touching mask edit mode; a second click on the active
  layer's button closes the drawer.
- **Layer > Adjustment Layer…**: `ui.layer.adjustment-layer`, which runs
  `openAdjustmentLayer()`: `setActiveLayer(rootGroupId)` without
  `clearPersistentTransform()`, then opens the effects drawer and the
  "Adjustment layers" note.

**Difference**: the menu item leaves a pending Move float or multi-layer
transform live across the layer switch; the panel commits it. The effects
button leaves mask edit mode on when it targets the active masked layer;
on another layer mask edit mode ends only because that layer has no mask.

**Pinned by**: `surface-menu-layer.spec.ts` "D6: Adjustment Layer…
switches the active layer without committing a pending Move float";
`surface-panel-layers.spec.ts` "D6: a row click commits a pending Move
float before switching layers", "D6: the mask thumbnail activates its
layer and enters mask edit mode", "D6: the effects button activates its
layer and opens the drawer; mask edit mode survives only on the same
layer".

## D7 — Duplicate layer

- **Layer > Duplicate Layer**: `ui.layer.duplicate`, which calls
  `duplicateLayer()` with no root-group check; never disabled.
- **Layers panel > Duplicate Layer button**: `layer.duplicate`, which
  refuses the root group; the button is disabled while the root group is
  active.
- **Option-drag with the Move tool** (`move-handlers.ts`): `duplicateLayer()`
  with the live float kept.

**Difference**: with the root group active, the menu duplicates the whole
project as a sibling group; the button cannot be used.

**Pinned by**: `surface-menu-layer.spec.ts` "D7: Duplicate Layer with the
root group active duplicates the whole project as a sibling group";
`surface-panel-layers.spec.ts` "D7: Duplicate Layer is disabled with the
root group active, and a click does nothing".

## D8 — Group layers

- **Layer > Group Layers**: `layer.group`; always enabled.
- **Layers panel > Group Layers button**: `layer.group`; shown only with
  two or more non-root layers selected.
- **Layers panel > New Group**: `layer.add-group`, a different operation
  (an empty group).

**Difference**: the menu wraps a single selected layer in a new "Group";
the panel offers no button then.

**Pinned by**: `surface-menu-layer.spec.ts` "D8: Group Layers with one
layer selected wraps that layer in a new "Group"";
`surface-panel-layers.spec.ts` "D8: Group Layers appears only with two or
more layers selected, and wraps them in one "Group"".

## D9 — Merge Down

- **Layer > Merge Down**: `layer.merge-down`; aria-disabled when
  `canMergeDown` is false, and a click on it does nothing.
- **Cmd+E**: `layer.merge-down` whatever the layer. The command calls
  `mergeDown()`, which flushes layer data and then returns without
  merging, and refuses silently.

**Difference**: none observable. The key reaches the store's flush where
the disabled menu item does not.

**Pinned by**: `surface-menu-layer.spec.ts` "D9: Merge Down is
aria-disabled for the bottom layer and the root group, and a click does
nothing"; `surface-keys-edit.spec.ts` "D9: Cmd+E with the bottom layer or
the root group active does nothing observable".

## D10 — Fit to Screen

- **View > Fit to Screen**: `ui.view.fit`, which runs `fitToScreen()`:
  0.9 × min(width / document width, height / document height) of the
  viewport size the store measured from the canvas container, then pan
  0,0; nothing until a size has been measured.
- **Cmd+0** (exempt: `zoomFit`): the same formula over the canvas
  element's integer `clientWidth` and `clientHeight`, when the canvas is
  mounted.
- `fitToView()`, used after open and paste, is a third formula (padded,
  capped at 1).

**Difference**: the size each reads. With an integer-sized container the
zoom is the same.

**Pinned by**: `surface-menu-view.spec.ts` "D10: Fit to Screen sets zoom
to 0.9 x min(vw/dw, vh/dh) of the container and pans to 0,0";
`surface-keys-tools.spec.ts` "D10: Cmd+0 sets zoom to 0.9 x min(canvas
clientWidth/dw, clientHeight/dh) and pans to 0,0".

## D11 — Zoom In / Zoom Out

- **View > Zoom In / Zoom Out**: `ui.view.zoom-in` / `ui.view.zoom-out`,
  which step from the store's zoom (`zoomStep`).
- **Cmd+= and Cmd++ / Cmd+-** (exempt: `zoomIn`, `zoomOut`): step from the
  zoom React last rendered.

**Difference**: the key also answers to `+`. Both step through the same
fixed levels and keep the pan; no other difference is observable.

**Pinned by**: `surface-menu-view.spec.ts` "D11: Zoom In and Zoom Out step
through the fixed zoom levels and keep the pan", "D11: Zoom In from an
off-level zoom lands on the next level up"; `surface-keys-tools.spec.ts`
"D11: Cmd+= and Cmd++ zoom in, Cmd+- zooms out through the fixed levels,
keeping the pan", "D11: Cmd+= from the fractional Cmd+0 zoom lands on the
next level up".

## D12 — Actual Size

- **View > Actual Size** and **Cmd+1**: `ui.view.actual-size`: zoom 1, pan
  0,0.
- **Status bar zoom double-click** (`StatusBar.tsx`): zoom 1, pan 0,0,
  directly.
- **Navigator zoom slider double-click** (`NavigatorPanel.tsx`): zoom 1
  only.

**Difference**: the Navigator keeps the pan.

**Pinned by**: `surface-menu-view.spec.ts` "D12: Actual Size sets zoom 1
and pans to 0,0"; `surface-keys-tools.spec.ts` "D12: Cmd+1 sets zoom 1 and
pans to 0,0". The Navigator and status bar have no characterization spec.

## D13 — Crop

- **Edit > Crop**: `image.crop-to-selection`: crops to the selection's
  bounds and drops the selection ("Crop Canvas"); disabled with no
  selection.
- **Crop tool drag release** (`crop-interaction.ts`): crops to the
  dragged rectangle ("Crop Canvas") and keeps the selection.
- **Crop tool, perspective mode > Apply** (`CropOptions.tsx`):
  `commitPerspectiveCrop`, which ends with `fitToView()`.

**Difference**: the menu drops the selection and the tool keeps it.
Enter does nothing with the Crop tool.

**Pinned by**: `surface-menu-edit.spec.ts` "D13: Crop is disabled without
a selection; with one it crops the canvas and clears the selection".

## D14 — Open a file

- **File > Open...**: `ui.file.open`, which runs `openFileFromDisk()`: the
  unsaved-changes confirm, then a file picker; `openFile` routes `.lopsy`,
  `.psd`, `.dng` and `.raf` to their loaders and decodes other images
  through an `Image` and a 2D canvas, as a new document.
- **New Document dialog > Open, with a document open** (`ModalHost.tsx`):
  `.psd` to `importPsdFile`, everything else to
  `pasteOrOpenBlob(file, name, true)`, although the picker also offers
  `.lopsy`, `.dng` and `.raf`.
- **New Document dialog before any document, and drag-and-drop onto the
  canvas** (`useDocumentOpenHandlers.ts`): `classifyOpenFile` routes
  `.lopsy`, `.psd`, `.dng` and `.raf`; images go to
  `pasteOrOpenBlob(file, name)`, which adds a layer when a document is
  open. A drop closes only the New Document dialog.

**Difference**: only File > Open... asks about unsaved changes. The
surfaces decode images differently, the open-document dialog does not
send `.lopsy`, `.dng` or `.raf` to their loaders, and a drop onto an open
document adds a layer instead of opening a document.

**Alike**: an image or project too large for this device is refused on
every surface before anything changes, with the message over the canvas
(`reportOpenFailure`, `showIfTooLarge`); the open-document New Document
dialog closes for it so the message is not under it
(`image-too-large.spec.ts`).

**Pinned by**: `surface-menu-file.spec.ts` "D14: Open... on a dirty
document asks first; dismissing opens no chooser", "D14: Open... opens a
chooser for images, PSD, raw and projects, and opens a PNG as a new
document".

## D15 — New document

- **File > New**: `ui.file.new`, which runs `startNewDocument()`: the
  unsaved-changes confirm, then the New Document dialog. A newly created
  document is already dirty, so New asks first. The dialog's Create runs
  `createDocument(...)`; its Clipboard preset runs
  `pasteOrOpenBlob(blob, 'Copied File', true)`.
- **New Document dialog before any document** (`useDocumentOpenHandlers.ts`):
  Create is the same; Clipboard runs `pasteOrOpenBlob(blob, 'Copied File')`
  without `forceNewDocument`.

**Difference**: the `forceNewDocument` flag of the Clipboard preset
differs between the two dialogs.

**Pinned by**: `surface-menu-file.spec.ts` "D15: a freshly created
document is already dirty, so New asks first; accepting opens "New
Document"", "D15: New on a clean (saved) document opens "New Document"
with no confirm; Cancel leaves the document", "D15: New on a dirty
document asks first; dismissing leaves the document and opens nothing".

## D16 — Export

- **File > Export…**: `ui.dialog.export` opens the Export dialog. Its
  preview (`createExportPreviewSession`) finalizes a pending stroke,
  commits a multi-layer transform (`commitLayerTransform()`) and flushes
  layer data as the dialog opens. Its Export button closes the dialog and
  calls `exportCanvasWithOptions(options)`.
- **File > Quick Export PNG**: `ui.file.quick-export-png`, which runs
  `exportCanvas('png')`: quality 92, not high quality, the document's name
  or "lopsy".
- Both exports run the same pre-steps (`prepareForExport` in
  `src/io/export-image.ts`) and mark the document saved.

**Difference**: the options. Opening the dialog commits a pending stroke
and a multi-layer transform even when the dialog is cancelled; a live
Move float is not committed and survives.

**Pinned by**: `surface-menu-file.spec.ts` "D16: opening Export… with a
live Move float, then Cancel, leaves the float as it is".

## D17 — Stroke a path

- **Enter with the Pen tool** (exempt: `enterPenStroke`):
  `strokePathOnEnter()`. A draft of two or more anchors is committed
  ("Add Path") and stroked; with no draft, the selected path is stroked,
  once (a second Enter on the same path does nothing). The width is the
  Pen tool's options-bar stroke width, unclamped.
- **Paths panel > Stroke Path**, then the Stroke Path dialog's Stroke:
  `path.stroke` with the dialog's width, rounded and clamped to 1–50.

**Difference**: where the width comes from and whether it is clamped;
only Enter skips a repeat stroke.

**Pinned by**: no characterization spec.

## D18 — Undo / Redo outside text editing

- **Edit > Undo / Redo** and **Cmd+Z / Cmd+Shift+Z**: `history.undo` /
  `history.redo`.

**Difference**: none in what runs. The keys are ignored with an
aria-modal dialog open, with a text field focused and while text is being
edited (D3); the menu items are never disabled. Both can undo the
document's first step, "New Document".

**Pinned by**: `surface-menu-edit.spec.ts` "D18: Undo and Redo are never
disabled; Undo on a fresh document pops "New Document"";
`surface-keys-edit.spec.ts` "D18: Cmd+Z on a fresh document pops "New
Document"; with empty stacks both keys change nothing", "D18: Cmd+Z is
ignored with an aria-modal dialog open and with a text field focused".

## D19 — Escape while a non-modal panel is open

Escape reaches the global handler first (`select.none` with commit, as in
D1), then the panel's own listener: the guide colour picker closes
(`closeModalOfKind('guideColor')`), Tilt-Shift cancels
(`cancelTiltShift()`). The Brushes panel and Liquify are `role="dialog"`
without `aria-modal` and have no Escape handler. Dialogs marked
`aria-modal` stop the global handler (`isModalDialogOpen`), and an open
menu dropdown takes Escape for itself (`escapeDismissPopover`).

**Difference**: Escape that closes the guide colour picker or cancels
Tilt-Shift also drops the selection and commits a Move float. With the
Brushes panel or Liquify open, Escape drops the selection and leaves the
panel open, and tool letters and Cmd+Z stay live.

**Pinned by**: `surface-keys-tools.spec.ts` "D19: Escape with Tilt-Shift
open cancels it AND drops the selection", "D19: Escape with the guide
colour picker open closes it AND drops the selection", "D19: with the
Brushes panel open, Escape drops the selection but leaves the panel;
letters and Cmd+Z stay live", "D19: with Liquify open, Escape drops the
selection but leaves the panel; letters stay live".

## D20 — Enter while Tilt-Shift is open

The global Enter handler strokes the Pen path when the Pen tool is active
(D17), then Tilt-Shift's own listener applies the blur.

**Difference**: with the Pen tool and a draft, one Enter both strokes the
path and applies Tilt-Shift.

**Pinned by**: `surface-keys-tools.spec.ts` "D20: Enter with Tilt-Shift
open applies it and keeps the selection", "D20: Enter with Tilt-Shift open
and a Pen draft strokes the path AND applies Tilt-Shift".

## D21 — Select All with focus in the Layers panel

- **Cmd+A**: `select.all`; then, when focus is inside the Layers panel and
  no text is being edited, the panel's own listener selects every
  non-root layer (`setLayerSelection`).
- **Select > All**: `select.all`. **Canvas context menu > Select All**:
  `selectAll()` directly.

**Difference**: the key, with the panel focused, also selects every
layer. Select > All keeps a live Move float (D22).

**Pinned by**: `surface-keys-edit.spec.ts` "D21: Cmd+A with a Layers-panel
button focused also selects every layer", "D21: Cmd+A with nothing focused
leaves the layer selection alone"; `surface-menu-select.spec.ts`
"D21/D22: All after a Move drag keeps the live float".

## D22 — Committing a Move float or multi-layer transform

There is no keyboard commit or cancel for a Move float or multi-layer
transform: Enter only strokes a Pen path. Escape, Cmd+D and a layer-row
click run `clearPersistentTransform()`, which commits
(`commitLayerTransform()`, then the float is dropped because the layer
already holds the result). Select > Inverse and the Grow, Shrink and
Feather dialogs commit a live float first (`commitLiveFloat()`). Select >
Deselect, Select > All, Edit > Fill and Layer > Adjustment Layer… leave
it live. Export, Save Project and Export PSD commit only a multi-layer
transform.

**Difference**: Escape commits rather than cancels, and whether a float
is committed before a selection change depends on the surface that
changes it.

**Pinned by**: `surface-keys-tools.spec.ts` "D1/D22: Escape after a Move
drag COMMITS the float in place (there is no keyboard cancel)";
`surface-menu-select.spec.ts` "D21/D22: All after a Move drag keeps the
live float", "D21/D22: Inverse after a Move drag commits the live float",
and the same for Grow…, Shrink… and Feather….

## D23 — Tool selection

- **Letter key**: `tool.select`. Ignored with Cmd, Ctrl or Alt held, with
  an aria-modal dialog open, with a text field focused and while text is
  being edited; Shift+letter still picks the tool.
- **Toolbox button**: `setActiveTool(id)` directly, with no such guards.

**Difference**: none in what runs. The toolbox labels ("Brush (B)") carry
the default letter as fixed text and do not follow customised keys; the
toolbox-only tools have no letter.

**Pinned by**: `surface-keys-tools.spec.ts` "D23: every tool letter and its
toolbox button pick the same tool, with no history", "D23: the
toolbox-only tools have no letter", "D23: Shift+letter still picks the
tool; Alt+letter and Cmd+letter do not", "D23: tool letters are ignored
with an aria-modal dialog open, a text field focused, or text being
edited".

## D24 — Swap / reset colours, Quick Mask

- **X**: `color.swap`; **Color panel > Swap Colors (X)**: `swapColors()`
  directly.
- **D**: `color.reset`; no button.
- **Q**: `ui.quick-mask.toggle`; **toolbox Quick Mask toggle**:
  `toggleQuickMaskMode()` directly, the function the command runs.

**Difference**: none in what runs. The button labels carry the letter as
fixed text, as in D23.

**Pinned by**: `surface-keys-tools.spec.ts` "D24: X and the Color panel
swap button both swap the colours; D resets them", "D24: Q and the toolbox
toggle both flip Quick Mask; the toggle label follows".

## D25 — Text commit and cancel

- **Commit**: Shift+Enter or Tab (exempt: `textEditingKeys`), the Commit
  text button, a canvas click outside the text, a tool switch and a
  layer-row click all reach `commitTextEditing()`.
- **Cancel**: Escape (when no popover is open; the popover closes first)
  and the Cancel text button reach `cancelTextEditing()`, which removes a
  new text layer.

**Difference**: none in what runs.

**Pinned by**: `surface-keys-tools.spec.ts` "D25: <surface> commits the
text edit" and "D25: <surface> cancels a new text layer and removes it",
one test per surface listed above.

## D26 — Filling a layer mask

- **Edit > Fill** in mask edit mode: `paint.fill`, which fills the mask
  with the foreground colour ("Mask Fill") and refuses on a locked layer.
- **Delete / Backspace** in mask edit mode: `mask.clear`, which fills it
  with the background colour ("Mask Clear") and does not check the lock.

**Difference**: the colours are opposite, as intended; only Fill checks
the lock.

**Pinned by**: `surface-keys-tools.spec.ts` "D26: Delete in mask edit mode
fills the mask as "Mask Clear", even on a locked layer, and keeps the
layer".

## D27 — Define a brush

- **Edit > Define Brush...** (and Define Color Brush...):
  `ui.edit.define-brush`, which runs `defineBrush(color)`: reads the
  selection as a tip, prompts for a name ("Brush name:") and adds the
  preset as the active one.
- **Canvas context menu > Define Brush Preset** (`useContextMenu.ts`):
  `readSelectionBrushTip(false)`, a preset named "Custom Brush", made
  active, and the Brushes panel opens.

**Difference**: the menu prompts for a name and does not open the
Brushes panel; the context menu names the brush "Custom Brush", opens the
panel and has no colour variant.

**Pinned by**: no characterization spec.

## Same label, different operation

- **Rotate 90° CW / CCW**: Image menu: `image.rotate` (the whole canvas).
  Move tool options: `rotateFromMoveOptions` (the selection, the
  multi-layer transform or the active layer).
- **Flip Horizontal / Vertical**: Image menu: `image.flip-layer` (the
  active layer). Move tool transform controls: `flipFromMoveOptions` (the
  float or the multi-layer transform).
- **Group Layers**: the menu and the Layers panel button run the same
  command, with different availability (D8).

## Menu shortcut labels with no key handler

⌘N (New), ⌘O (Open...), ⌘S (Save Project), ⌥⇧⌘E (Export…), ⇧⌘E (Quick
Export PNG: Cmd+Shift+E reports `e.key` `E`, which no handler matches),
⇧F5 (Fill), ⇧⌘N (New Layer), ⌘J (Duplicate Layer), ⌘G (Group Layers) and
⌘R (Show Rulers). The menu shows them, and pressing them does nothing in
the app; ⌘N, ⌘O and ⌘R are left to the browser.

**Pinned by**: `surface-keys-edit.spec.ts` "label-only shortcut <label>
changes nothing", for every label except ⌘N, ⌘O and ⌘R, which the spec
does not press.
