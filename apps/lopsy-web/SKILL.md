---
name: lopsy
description: >
  Make images with Lopsy (https://lopsy.art), a free, open-source image editor
  that runs entirely in the browser: layers, masks, blend modes, layer effects,
  gradients, brushes, shapes, text with Google Fonts, filters, adjustments and
  PNG/JPEG/WebP export. The editor page offers every editing operation as a
  named command with checked parameters, through `window.lopsy`, and a person
  can work in the same document. Use this when you need to make a poster,
  illustration, logo, cover, social image or any other raster artwork
  programmatically, from any browser you can run JavaScript in.
---

# Making images with Lopsy

Lopsy is an image editor that runs entirely in the browser, at
<https://lopsy.art/>. The editor page, the same one a person uses, has
`window.lopsy`: you make an image by calling commands on it, from any browser
where you can run JavaScript in the page, and a person can work in the same
document beside you. There is no backend and no account: the image is made in
that browser tab, and you take the files away with export and save commands.

This file covers everything you need to do that reliably:

1. [Setup](#setup): open the page, call `window.lopsy`, read the commands.
2. [Working alongside a person](#working-alongside-a-person).
3. [Getting image bytes out and in](#getting-image-bytes-out-and-in).
4. [The loop](#the-loop): plan, build in stages, look, checkpoint, export.
5. [The contract](#the-contract): invocations, results, errors, coordinates,
   layers, and the ambient state every painting command reads.
6. [Command families](#command-families): what there is, and how to read the
   full parameter list.
7. [Recipes](#recipes): tested invocation lists for shapes, light, gradients,
   brushes, type, effects, filters, masks, adjustments, transforms and a
   complete poster.
8. [What the API does not offer](#what-the-api-does-not-offer).
9. [Behaviours worth knowing](#behaviours-worth-knowing).
10. [The guestbook](#the-guestbook): leave a note to say hello.
11. [Appendix: a ready-made driver](#appendix-a-ready-made-driver).

Related resources:

- **Feature catalog:** <https://lopsy.art/FEATURES.md>. It's long and
  exhaustive: every tool, filter, effect and adjustment, and exactly how each
  behaves. The commands do what the editor's UI does, so it describes them too.
- **Index for agents:** <https://lopsy.art/llms.txt>
- **Tutorials** (step-by-step compositions made in Lopsy): <https://lopsy.art/tutorials/>
- **Source:** <https://github.com/theseamusjames/lopsy.art>. Open issues list
  current bugs, so search them when something looks wrong.
- **Contributing:** we accept pull requests written by AI agents. If you hit a
  bug or a missing command, you're welcome to fix it: read
  [AGENTS.md](https://github.com/theseamusjames/lopsy.art/blob/main/AGENTS.md)
  for the workflow first.

## Setup

Open <https://lopsy.art/> in a browser where you can evaluate JavaScript in
the page, wait until `window.lopsy` exists, and call it. The page opens on a
New Document screen with `window.lopsy` already there; `doc.new` replaces
that screen with the editor. How you get JavaScript into the page is up to
you: an automation library (Playwright, Puppeteer, Selenium, the DevTools
protocol) driving a headless or headed browser; a browser tool your agent
harness gives you over a browser session, possibly the user's own browser
(one tool runs JavaScript in the page, another takes screenshots); or a
person pasting into the DevTools console. With a shell, Node and no browser
tool, use the [ready-made driver](#appendix-a-ready-made-driver). Whichever
you use:

- **Keep one page open for the whole piece.** The document lives in that
  tab; a reload or navigating away loses it (with unsaved changes the browser
  asks first), and the next visit brings back the panel layout but no
  document, colours or tool options. [Checkpoint](#the-loop) as you go.
- **The browser needs WebGL2.** Desktop Chrome and Edge have it with
  hardware acceleration on. A headless Chromium on a machine with no GPU
  needs software WebGL (SwiftShader): start it with
  `--use-gl=angle --use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist`.
  Without WebGL2 the page shows a warning instead of the editor, and every
  `lopsy.run` answers at once with `unavailable` and a message that says so.
- **The page is tested in Chromium**, the engine of Chrome and Edge. It
  needs nothing beyond WebGL2, so other browsers may work, but they are not
  tested.
- **The page must be the visible tab** ([below](#the-page-must-be-the-visible-tab)).

`lopsy.run` returns a promise of the result envelope, which tools that
evaluate JavaScript in a page wait for:

<!-- snippet: first-call -->
```js
lopsy.run([
  { op: 'doc.new', width: 800, height: 600 },
  { op: 'color.set', foreground: '#e63946' },
  { op: 'select.rect', x: 100, y: 100, width: 300, height: 200 },
  { op: 'paint.fill' },
  { op: 'select.none' },
])
```

JSON is JavaScript: every recipe below can be passed to `lopsy.run` as it is.

### Reading the commands

`lopsy.describe()` returns, synchronously, all ~140 commands with their full
parameter schemas: over 100 KB. Ask for what you need instead: every id with
its summary, one command's schema, or every command in one family.

<!-- snippet: describe-list -->
```js
lopsy.describe().map((c) => `${c.id}: ${c.summary}`).join('\n')
```

<!-- snippet: describe-op -->
```js
lopsy.describe().find((c) => c.id === 'layer.effects')
```

<!-- snippet: describe-family -->
```js
lopsy.describe().filter((c) => c.id.startsWith('filter.'))
```

### The page must be the visible tab

Browsers pause animation frames in background tabs, and the engine draws on
animation frames. A headless page is always visible. In a headed browser,
keep the editor the front tab: in a background tab, commands wait and
then fail with `unavailable` or `unsettled`, and the message says *The page
is a background tab … make it the visible tab*.

## Working alongside a person

The editor is the page a person uses, so someone may be working in it while
you do. There is one document, one undo history and one set of tools:

- **They see your work as you make it**: your layers in the Layers panel,
  your steps in the History panel. They can undo your steps with the undo
  key, and `history.undo` undoes theirs as it would yours.
- **You see theirs**: `doc.info` reports their layers, history, active layer
  and tool. Between two of your calls they may have painted, undone, switched
  layers or tools, changed colours or selected something: call `doc.info`
  before a stage that depends on the state.
- **The ambient state is shared.** The tool, its options, the colours and
  the selection are the ones their toolbox, options bar and Color panel set:
  a foreground they pick in the Color panel is what your `paint.fill` uses.
  Set what a stage relies on ([Ambient state](#ambient-state)).
- **Don't replace their document.** `doc.new` and `doc.open` discard the open
  document and its history without asking, unsaved or not (File > New asks
  first when there is unsaved work). Call `doc.info` first, and make or open
  a document over theirs only when that is what you were asked to do.
- **Wait while they are mid-action.** Two states refuse every call with
  `unavailable`. The refused step did not run: wait a moment and send it
  again (in a batch, the invocations from `error.index` on).
  - `The person has a dialog open with a live preview on the layer. Nothing was run. Send the call again once they apply or cancel it.`
  - `A drag or scroll on the canvas is in progress. Nothing was run. Send the call again once it is released.`

A refusal reaches you as the error only (a `clipboard.copy` refused on a
group shows the person nothing). Their text being typed and a transform they
have pending are under [Behaviours](#behaviours-worth-knowing).

## Getting image bytes out and in

The results of `view.render`, `view.render-layer`, `doc.export`,
`doc.export-psd` and `doc.save` carry a file as `base64`, beside its `mime`
(and `ext`, except for renders) and, for images, its `width` and `height`. A
render is easily hundreds of kilobytes of base64: never print it or bring it
into your context. **From a script**, return the envelope to the script,
decode each `base64` and write it to a file there. **With only a JavaScript
tool and screenshots**, look with a screenshot and take files away as
downloads.

**Looking by screenshot.** A screenshot of the page is the whole editor:
the menu bar, the toolbox, the options bar, the panels, and between them the
canvas area with rulers along its top and left and the document fitted into
it when it is created or opened (never above 100%; the person may zoom or
pan it since). It is the quickest look at your work and at what the person
sees, but it is not the image: transparency shows as a checkerboard, guides,
the selection's outline and the Move tool's handles are drawn over it, mask
edit mode tints what the mask hides, the document is usually scaled down,
and the colours can differ from your hex values. `view.render` gives the
image itself, at the size you ask for, with none of that; `view.sample`
reads an exact colour.

**Downloading a file.** This runs one invocation whose result carries a
file (any of those above), has the browser download it to its downloads
folder as `poster.png`, and returns only the name and size:

<!-- snippet: download -->
```js
(async (invocation, name) => {
  const out = await lopsy.run(invocation);
  if (!out.ok) return out;
  const { base64, mime, ext = mime.split('/').pop() } = out.result;
  const blob = await (await fetch(`data:${mime};base64,${base64}`)).blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${ext}`;
  a.click();
  return { downloaded: a.download, bytes: blob.size };
})({ op: 'doc.export', format: 'png' }, 'poster')
```

### Bytes in

`doc.open` and `layer.add-image` take a file's bytes as base64. In this
guide they are written `"<base64 of photo.jpg>"`: put the real base64 in
that string. From a script, read the file and encode it there. With only a
JavaScript tool, have the page fetch the image and convert it:

<!-- snippet: fetch-image -->
```js
(async (url) => {
  const blob = await (await fetch(url)).blob();
  const base64 = await new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
  return lopsy.run({ op: 'layer.add-image', base64, name: url.split('/').pop() });
})('https://example.com/photo.jpg')
```

The page puts no limit on what it fetches, but a browser reads another
site's file only when that site allows it (`Access-Control-Allow-Origin`);
when it does not, `fetch` rejects with a `TypeError`.

## The loop

A finished piece takes dozens to hundreds of commands. Don't send one giant
list and rerun it from the top whenever something is off. Work in stages on
the one document the page keeps open:

1. **Plan before you touch the editor.** Decide the concept, the document
   size, a palette of 4–8 hex colours, and the layer stack from back to front,
   with a name for each layer. Compute geometry in code (polygons, curves,
   grids, text positions) so shapes line up exactly.
2. **Build in stages**, one `lopsy.run` per stage (background, main shapes,
   detail, type, effects, finishing), each a batch of related commands. Put
   every element on its own layer, so it can be moved, recoloured or given
   effects later.
3. **Look after every stage**: take a screenshot of the page, or end the
   batch with `{ "op": "view.render", "maxSize": 800 }` and open the PNG.
   Check that the stage did what you intended before you send the next one. Most
   mistakes are cheap to undo straight away (`history.undo`) and expensive to
   find later. `view.render-layer` shows one layer alone, and `view.sample`
   reads one pixel's colour; `doc.info` lists the layers, the selection, the
   colours, the active tool and the history.
4. **Checkpoint** after each stage that took real work: `{ "op": "doc.save" }`
   returns a `.lopsy` project; keep the file (write or download it). If the
   page is reloaded or something goes wrong, reopen it:

   ```json
   { "op": "doc.open", "base64": "<base64 of checkpoint.lopsy>", "name": "checkpoint.lopsy" }
   ```

   A reopened project keeps its layers, masks, effects, text, adjustments,
   paths and guides, and starts a fresh undo history.
5. **Export** with `{ "op": "doc.export", "format": "png" }` (or `jpeg`,
   `webp`, `bmp`) and look at the exported file itself.

## The contract

### Invocations and batches

An invocation is a JSON object: `op` names the command and every parameter
sits beside it.

```json
{ "op": "select.rect", "x": 40, "y": 40, "width": 200, "height": 120 }
```

`lopsy.run` takes one invocation or an array. An array runs
**in order** and **stops at the first failure**: the commands after it do not
run, and the ones before it stay done.

### Results

Every call resolves to an envelope; `lopsy.run` does not reject:

```json
{ "ok": true, "result": { "id": "…" } }
{ "ok": true, "results": [ { … }, { … } ] }
{ "ok": false, "error": { "name": "CommandError", "code": "invalid", "message": "…" } }
```

A refusal is a `CommandError`. A bug in the editor comes back the same way,
as `{ "name": "InternalError", "code": "internal" }` (see below).

`result` answers a single invocation, `results` an array (one entry per
invocation, in order). Each command's summary says what it returns: the new
layer's id, the selection bounds, the layer's properties after a change, and
so on. For a failed array, `error.index` is the position of the invocation
that failed, `error.completed` holds the results of the ones before it, and
the message starts with `[index] op:`.

### Errors

| `code` | Meaning | What to do |
| --- | --- | --- |
| `invalid` | The params are wrong. The message names the bad one and what it accepts (`select.rect: width must be a finite number from 1 to 49152, got -5`; `unknown param "w"; allowed: x, y, width, height, mode`). | Fix the params. |
| `refused` | The editor will not do that in its current state. The message says why and usually what to do (`A selection is active … deselect first (select.none)`). | Change the state, then retry. |
| `not-found` | An unknown command, layer, node or path. Unknown commands come with suggestions (`Did you mean: filter.gaussian-blur, …`). | Correct the name; [`lopsy.describe()`](#reading-the-commands) or `doc.info` lists what exists. |
| `unavailable` | Nothing to act on yet: no document open (`No document is open`), the engine not started, or the graphics context lost and being restored. Or the person is in the middle of something, and the step was not run ([Working alongside a person](#working-alongside-a-person)). | Create or open a document; otherwise wait a moment and retry. |
| `unsettled` | The command's change **was applied**, but the engine did not finish drawing it within 10 s. Its result is on `error.result`. | **Do not run it again.** Wait, then check with `view.render` or `doc.info`. |
| `internal` | The editor hit a bug. The step that failed **may or may not have been applied**; in a batch, the steps before it (`error.completed`) were. The message names the error. | Call `doc.info` (and `view.render`) before deciding what to redo, and report it with the message and the batch that caused it. |

`unavailable` also answers every call at once, before anything runs, when the
browser has no WebGL2 (the message says so): use a real GPU, or software
WebGL (see [Setup](#setup)).

### Coordinates

All positions are **document pixels**: (0, 0) is the top-left of the image, x
grows to the right and y downwards. Points are `{ "x": …, "y": … }`;
rectangles and ellipses are `x, y, width, height` of their box. There is no
view or zoom to account for. Points may lie outside the document (from −16384
to 32768), so a stroke or gradient can start off the canvas; selections are
clipped to it. Stroke and gesture points may be fractional. A document is at
most 16384 px a side, or the GPU's largest texture if that is smaller.

### Layers

A layer param takes a layer's **id or its exact name**; leaving it out means
the **active layer**. A command that works on the active layer (`layer.duplicate`,
`layer.rasterize-style`, `layer.move`, `mask.add`, `image.flip-layer`,
`text.style`…) makes a named layer active first, as clicking its row would,
and then acts, so that layer is active afterwards; its summary says so. Others
(`layer.set`, `layer.effects`, `layer.remove`, `mask.remove`,
`select.from-layer`, `view.render-layer`) leave the active layer alone. When two layers share a name, the call is refused as
`invalid` and lists their ids, so give layers unique names (`layer.add`
takes `name`) or keep the ids that `layer.add` and `doc.info` return.
`doc.info` lists the layers bottom to top, each with its id, type, parent
group, position, opacity, blend mode and whether it is active.

A new white document has a white **Background** layer and an empty
**Layer 1** above it, which is active, both inside the root group
**Project** (the document's own group, which carries its global
adjustments). `background: "transparent"` gives one empty Background layer.

### Ambient state

This is the one idea agents get wrong. Painting, filling, gradient, shape,
selection and text commands **take no colour or style params**: they read
the editor's current settings, exactly as the tools read the Color panel and
the options bar. Set them first:

- `color.set` sets the **foreground** (and `background`) colour as
  `"#rrggbb"`. `paint.fill`, `paint.stroke`, `paint.bucket`, `path.stroke`
  and `text.add` use the foreground; `filter.clouds` blends the foreground
  into the background.
- `tool.set` sets a tool's options: brush size and hardness, gradient type
  and stops, shape kind and colours, the marquees' feather, text size and
  alignment, wand tolerance… `{ "op": "tool.describe", "tool": "brush" }`
  lists every option with its range and current value.
- `text.set-font` sets the font family, weight and style (`text.fonts` lists
  the families).

Nothing resets between commands or between documents: `doc.new` keeps the
colours, the tool options and the active tool you had before, and a person
on the page changes the same settings. Set everything a stage relies on at
the start of the stage. There are no per-call overrides.

Commands that drive a tool make it the **active tool** first, as clicking it
in the toolbox would: `paint.stroke`, `paint.gradient`, `paint.shape`,
`paint.bucket`, `text.add`, `text.edit`, `layer.move`, `layer.nudge`,
`layer.transform`, `select.wand`, `select.quick`, `select.nudge`,
`tool.gesture` and `tool.select` itself; `layer.add-image` and
`clipboard.paste` choose the Move tool. The selection commands
(`select.rect`, `select.ellipse`, `select.polygon`…) and the filters do not
change the tool. Switching tools commits text being edited and a pending Move
float, as it does in the UI.

### Commands wait for the engine

A command resolves only once the engine has drawn its change: a `view.render`
straight after a fill shows the fill. You never need sleeps or retries
between commands. A large document on a software renderer can take a few
seconds per heavy command (see [Behaviours](#behaviours-worth-knowing)); a
command that is still drawing after 10 s comes back `unsettled`.

## Command families

About 140 commands, in 20 families. This table is a map; the parameters are
in [`lopsy.describe()`](#reading-the-commands), which is always current.
Every command's summary names the UI control it matches and its history label.

| Family | For | Most useful |
| --- | --- | --- |
| `doc` | Documents and files | `doc.new`, `doc.info`, `doc.export`, `doc.save`, `doc.open` |
| `view` | Looking at the result | `view.render`, `view.render-layer`, `view.sample` |
| `layer` | The layer stack | `layer.add`, `layer.set` (name, opacity, blend mode, visibility), `layer.effects`, `layer.move`, `layer.transform` (turn, scale, skew, distort, perspective), `layer.duplicate`, `layer.group`, `layer.reorder` |
| `color` | Foreground and background | `color.set`, `color.swap`, `color.reset` |
| `tool` | Tool options | `tool.set`, `tool.describe`, `tool.options`, `tool.gesture` (raw canvas gestures) |
| `select` | Selections | `select.rect`, `select.ellipse`, `select.polygon`, `select.none`, `select.modify`, `select.invert`, `select.from-layer` |
| `paint` | Putting pixels down | `paint.fill`, `paint.stroke`, `paint.gradient`, `paint.shape`, `paint.clear`, `paint.bucket` |
| `text` | Live text layers | `text.fonts`, `text.set-font`, `text.add`, `text.style`, `text.set-color`, `text.edit` |
| `filter` | Destructive filters | `filter.gaussian-blur`, `filter.add-noise`, `filter.texture`, `filter.clouds`, `filter.halftone`, `filter.tilt-shift`, `filter.mesh-warp`, `filter.liquify`… (36) |
| `adjust` | Non-destructive adjustments on a group | `adjust.add`, `adjust.set`, `adjust.list` |
| `mask` | Layer masks | `mask.add`, `mask.edit`, `mask.clear`, `mask.remove` |
| `image` | The whole canvas | `image.canvas-size`, `image.size`, `image.crop`, `image.rotate`, `image.flip-layer`, `image.border` |
| `history` | Undo | `history.undo`, `history.redo` |
| `path` | Vector paths | `path.add`, `path.stroke`, `path.to-selection`, `path.unite`, `path.list` |
| `clipboard` | The editor's own clipboard | `clipboard.copy`, `clipboard.paste`, `clipboard.copy-merged` |
| `guide` | Ruler guides | `guide.add`, `guide.list` |
| `quickmask` | Quick Mask mode | `quickmask.set` |
| `pattern`, `brush` | Defining patterns and brush tips | `pattern.define`, `filter.pattern-fill`, `brush.define` |
| `guestbook` | Saying hello ([below](#the-guestbook)) | `guestbook.sign` |

## Recipes

Each recipe is a complete invocation list that runs as written on a fresh
page (they are tested against the editor). Pass one to `lopsy.run` as it
is, then adapt it. Apart from the photo recipe, which needs a photo's bytes
in place of `"<base64 of photo.jpg>"`, they need nothing but the page.

<!-- recipe: flat-shapes -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Ground" },
  { "op": "color.set", "foreground": "#f4e9d8" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "House" },
  { "op": "color.set", "foreground": "#264653" },
  { "op": "select.rect", "x": 120, "y": 200, "width": 360, "height": 160 },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Roof" },
  { "op": "color.set", "foreground": "#2a9d8f" },
  { "op": "select.polygon", "points": [{ "x": 90, "y": 210 }, { "x": 300, "y": 70 }, { "x": 510, "y": 210 }] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Windows" },
  { "op": "color.set", "foreground": "#e9c46a" },
  { "op": "select.rect", "x": 160, "y": 240, "width": 70, "height": 60 },
  { "op": "select.rect", "x": 370, "y": 240, "width": 70, "height": 60, "mode": "add" },
  { "op": "select.ellipse", "x": 270, "y": 110, "width": 60, "height": 60, "mode": "add" },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Door" },
  { "op": "tool.set", "tool": "shape", "options": { "mode": "rectangle", "cornerRadius": 18,
    "fillColor": "#e76f51", "strokeColor": "#1d3557", "strokeWidth": 4 } },
  { "op": "paint.shape", "from": { "x": 300, "y": 310 }, "to": { "x": 335, "y": 360 } },

  { "op": "view.render", "maxSize": 600 }
]
```

**Flat shapes: select, then fill.** A selection plus `paint.fill` is the most
dependable primitive: crisp edges, exact geometry, any polygon you can
compute; for a smooth curve, `path.to-selection` turns a bezier path into a
selection (see Brush work). `mode: "add"` (or
`subtract`, `intersect`) combines selections, so one fill covers several
shapes. With no selection, `paint.fill` fills the whole layer. Always
`select.none` afterwards: a live selection keeps constraining everything that
follows. The Shape tool is the other route, with its own fill and stroke
colours (`fillColor`, `strokeColor`, set with `tool.set`, not the foreground)
and rounded corners; it draws from the centre (`from`) to a corner (`to`).

<!-- recipe: soft-shapes-and-light -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Night" },
  { "op": "color.set", "foreground": "#14213d" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Glow" },
  { "op": "tool.set", "tool": "marquee-ellipse", "options": { "feather": 40 } },
  { "op": "select.ellipse", "x": 200, "y": 70, "width": 200, "height": 200 },
  { "op": "color.set", "foreground": "#fca311" },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "tool.set", "tool": "marquee-ellipse", "options": { "feather": 0 } },
  { "op": "layer.set", "blendMode": "screen" },

  { "op": "layer.add", "name": "Orb" },
  { "op": "select.ellipse", "x": 250, "y": 120, "width": 100, "height": 100 },
  { "op": "color.set", "foreground": "#fff3c4" },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Shadow" },
  { "op": "color.set", "foreground": "#000000" },
  { "op": "select.ellipse", "x": 210, "y": 320, "width": 180, "height": 30 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "filter.gaussian-blur", "radius": 12 },
  { "op": "layer.set", "blendMode": "multiply", "opacity": 70 },

  { "op": "layer.add", "name": "Haze" },
  { "op": "select.rect", "x": 0, "y": 250, "width": 600, "height": 60 },
  { "op": "select.modify", "kind": "feather", "amount": 30 },
  { "op": "color.set", "foreground": "#e5e5e5" },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.set", "blendMode": "soft-light" },

  { "op": "view.render", "maxSize": 600 }
]
```

**Soft shapes and light.** There are three ways to soften an edge: the
marquees' `feather` option (shared by both marquees and `select.polygon`, so
set it back to 0 afterwards), `select.modify` with `kind: "feather"` on a
selection you already have, or a hard fill followed by `filter.gaussian-blur`
on that layer. Put glows and haze on their own layers with a blend mode:
`screen` or `color-dodge` for light, `multiply` for shade, `overlay` or
`soft-light` for tint. Blend modes and opacity are layer properties, set with
`layer.set`.

<!-- recipe: gradients -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Sky" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#0b132b" }, { "position": 0.6, "color": "#5c4d7d" }, { "position": 1, "color": "#f4a261" } ] } },
  { "op": "paint.gradient", "from": { "x": 300, "y": 0 }, "to": { "x": 300, "y": 400 } },

  { "op": "layer.add", "name": "Moon glow" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "radial", "stops": [
    { "position": 0, "color": "#fff1c1" }, { "position": 1, "color": "#fff1c100" } ] } },
  { "op": "paint.gradient", "from": { "x": 430, "y": 120 }, "to": { "x": 430, "y": 20 } },
  { "op": "layer.set", "blendMode": "screen" },

  { "op": "layer.add", "name": "Panel" },
  { "op": "select.rect", "x": 60, "y": 220, "width": 240, "height": 140 },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#e63946" }, { "position": 1, "color": "#457b9d" } ] } },
  { "op": "paint.gradient", "from": { "x": 60, "y": 220 }, "to": { "x": 300, "y": 360 } },
  { "op": "select.none" },

  { "op": "view.render", "maxSize": 600 }
]
```

**Gradients.** A gradient's stops are a tool option, not the
foreground/background colours: set them with `tool.set` on the `gradient`
tool (2–16 stops, positions 0–1, colours `"#rrggbb"` or `"#rrggbbaa"` for
transparency). `paint.gradient` is a drag: linear runs along it, radial is
centred on `from` with the drag's length as its radius. It covers the whole
layer, or only the selection when there is one, which is how a gradient goes
into a shape. A stop with alpha `00` lets the layer show through, so a radial
gradient to transparent on a `screen` layer is a soft light source.

<!-- recipe: brush-work -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Paper" },
  { "op": "color.set", "foreground": "#fdf6e3" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Ink" },
  { "op": "color.set", "foreground": "#073642" },
  { "op": "tool.set", "tool": "brush", "options": { "size": 14, "hardness": 90, "opacity": 100 } },
  { "op": "paint.stroke", "points": [
    { "x": 60, "y": 120 }, { "x": 100, "y": 90 }, { "x": 140, "y": 80 }, { "x": 180, "y": 95 }, { "x": 220, "y": 125 },
    { "x": 260, "y": 150 }, { "x": 300, "y": 155 }, { "x": 340, "y": 140 }, { "x": 380, "y": 110 }, { "x": 420, "y": 88 },
    { "x": 460, "y": 85 }, { "x": 500, "y": 100 }, { "x": 540, "y": 125 } ] },

  { "op": "tool.set", "tool": "brush", "options": { "size": 6, "hardness": 100 } },
  { "op": "paint.stroke", "points": [{ "x": 60, "y": 220 }] },
  { "op": "paint.stroke", "points": [{ "x": 540, "y": 220 }], "line": true },
  { "op": "paint.stroke", "points": [{ "x": 540, "y": 340 }], "line": true },

  { "op": "tool.set", "tool": "pencil", "options": { "size": 2 } },
  { "op": "paint.stroke", "tool": "pencil", "points": [{ "x": 60, "y": 260 }, { "x": 300, "y": 300 }] },

  { "op": "path.add", "anchors": [
    { "point": { "x": 60, "y": 360 }, "handleOut": { "x": 180, "y": 260 } },
    { "point": { "x": 400, "y": 360 }, "handleIn": { "x": 280, "y": 260 } } ] },
  { "op": "color.set", "foreground": "#cb4b16" },
  { "op": "path.stroke", "width": 5 },

  { "op": "tool.set", "tool": "eraser", "options": { "size": 40 } },
  { "op": "paint.stroke", "tool": "eraser", "points": [{ "x": 300, "y": 60 }, { "x": 300, "y": 180 }] },

  { "op": "color.set", "foreground": "#268bd2" },
  { "op": "tool.set", "tool": "spray", "options": { "size": 70, "density": 40, "opacity": 80, "softness": 40 } },
  { "op": "paint.stroke", "tool": "spray", "points": [
    { "x": 80, "y": 40 }, { "x": 160, "y": 30 }, { "x": 240, "y": 45 } ] },
  { "op": "paint.stroke", "tool": "spray", "points": [{ "x": 520, "y": 200 }], "dwell": 800 },

  { "op": "layer.add", "name": "Leaf" },
  { "op": "path.add", "closed": true, "anchors": [
    { "point": { "x": 440, "y": 300 }, "handleIn": { "x": 470, "y": 370 }, "handleOut": { "x": 470, "y": 230 } },
    { "point": { "x": 560, "y": 300 }, "handleIn": { "x": 530, "y": 230 }, "handleOut": { "x": 530, "y": 370 } } ] },
  { "op": "path.to-selection" },
  { "op": "color.set", "foreground": "#859900" },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "view.render", "maxSize": 600 }
]
```

**Brush work.** `paint.stroke` is one drag of a painting tool through
`points`, with the tool's options from `tool.set` and the foreground colour.
One point is a single dab. Denser points give smoother curves: generate them
in code. `line: true` is a Shift-click: a straight line from where the
previous stroke **on this layer** ended to the stroke's first point, so a dab
followed by `line` strokes draws a polyline. The pencil gives aliased,
pixel-art lines; the eraser, smudge, dodge, sponge, stamp, healing and spray
tools work the same way (`tool` picks one). For an exact smooth curve, add a bezier
path with `path.add` (each anchor's `handleIn` / `handleOut` are absolute
document points) and stroke it with `path.stroke`, which uses the foreground
colour and a width of 1–50 px. To fill a curve, `path.to-selection` makes the
area a path encloses the selection (an open path is closed with a straight
line) and `paint.fill` fills it, as with the Leaf. Strokes are instantaneous, so the brush's
time-based behaviours (speed-based size, hold-to-smooth) never happen.

The **spray** tool is the one that works in real time. It scatters a burst
of random dots (`density` of them) inside its `size` at the press and along
each move, and while the button is held it adds another burst about every
166 ms. An instantaneous stroke therefore gets only the bursts of the press
and the moves: a light speckle along the path. `dwell` holds the pointer
still for that many milliseconds **at every point**, the press included, so
the paint builds up there as under a hand that lingers (the one point at
520, 200 gets about five more bursts in its 800 ms). The command takes as
long as its dwells add up to: at most 2000 ms a point and 10 s a stroke.
Spray dots are random, so a stroke never comes out the same twice; look at
the render rather than assuming. It takes no `line`.

<!-- recipe: type -->
```json
[
  { "op": "doc.new", "width": 800, "height": 500 },
  { "op": "layer.set", "name": "Backdrop" },
  { "op": "color.set", "foreground": "#1d1d2c" },
  { "op": "paint.fill" },

  { "op": "text.set-font", "family": "IM Fell English" },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 110, "align": "center" } },
  { "op": "color.set", "foreground": "#f4d58d" },
  { "op": "text.add", "x": 400, "y": 90, "text": "Night Market" },

  { "op": "layer.select", "layer": "Backdrop" },
  { "op": "text.set-font", "family": "Montserrat", "weight": 700 },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 26, "align": "center" } },
  { "op": "color.set", "foreground": "#f2f2f2" },
  { "op": "text.add", "x": 400, "y": 290, "text": "OPEN FRIDAYS FROM SIX\nBY THE RIVER" },
  { "op": "text.style", "options": { "letterSpacing": 6, "lineHeight": 1.8 } },

  { "op": "text.style", "layer": "Night Market", "options": { "fontSize": 120 } },
  { "op": "text.edit", "layer": "Night Market", "text": "Night Bazaar" },
  { "op": "text.set-color", "layer": "Night Bazaar", "color": "#ffb703" },

  { "op": "layer.select", "layer": "Backdrop" },
  { "op": "text.set-font", "family": "Barlow Condensed" },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 18, "align": "left" } },
  { "op": "color.set", "foreground": "#a8a8bf" },
  { "op": "text.add", "x": 60, "y": 400, "text": "Stalls, music and lanterns. Bring a friend and something to share.",
    "box": { "width": 260, "height": 60 } },

  { "op": "view.render", "maxSize": 800 }
]
```

**Type.** `text.add` makes a live text layer in the current font, size,
alignment and foreground colour, **directly above the active layer**. Point
text is a click at (x, y): `align: "center"` centres each line on x, and the
glyphs' ink starts noticeably below y (roughly a third of the font size for
capitals). `\n` breaks a line; `box` makes paragraph text that wraps at its
width. The layer is named after its first 16 characters.

**Choose the font before you add the text**, with `text.set-font` and an
exact family name as Google Fonts lists it (`Montserrat`, `Barlow
Condensed`, `IM Fell English`…) and a weight the family offers; `text.fonts`
lists the families, filtered by `category` or a `query`. The command
waits for the font to download, and so do `text.add` and `text.edit`: their
result says `fontLoaded: true` when the text is drawn in it.
`fontLoaded: false` means the font did not arrive within 20 s: the text is
there in a fallback face and will switch when the font loads, so don't add it
again.

**Watch the active layer.** Right after `text.add` the new text layer is
active, and as in the UI, the text settings then apply to it: `text.set-font`
**restyles that layer**, and `tool.set` on the text tool is refused. So
before setting up the next piece of text, select a non-text layer
(`layer.select`) or add one. To change a text layer later, `text.style`
changes its size, style, alignment, `lineHeight` (a multiple of the size),
`letterSpacing` and `paragraphSpacing` (pixels), as the subtitle's spacing is
set here; `text.set-color` recolours the whole layer and leaves the
foreground alone; and `text.edit` replaces its words (renaming a layer still
named after its old text). `text.edit` also loads the layer's colour into the
foreground and its font, size, alignment and spacing into the text options,
as clicking into the text does: set the colour again before you paint.

<!-- recipe: layer-effects -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Table" },
  { "op": "color.set", "foreground": "#e9ecef" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Badge" },
  { "op": "color.set", "foreground": "#3a86ff" },
  { "op": "select.ellipse", "x": 80, "y": 100, "width": 200, "height": 200 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.effects",
    "dropShadow": { "enabled": true, "color": "#000000", "offsetX": 0, "offsetY": 12, "blur": 24, "opacity": 40 },
    "stroke": { "enabled": true, "color": "#ffffff", "width": 8, "position": "inside" },
    "innerGlow": { "enabled": true, "color": "#bde0fe", "size": 30, "opacity": 60 } },

  { "op": "layer.add", "name": "Neon" },
  { "op": "color.set", "foreground": "#ffffff" },
  { "op": "select.rect", "x": 360, "y": 130, "width": 160, "height": 16 },
  { "op": "select.rect", "x": 432, "y": 130, "width": 16, "height": 140, "mode": "add" },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.effects", "outerGlow": { "enabled": true, "color": "#ff006e", "size": 30, "spread": 4, "opacity": 90 },
    "colorOverlay": { "enabled": true, "color": "#ffd6ec" } },

  { "op": "layer.rasterize-style", "layer": "Badge" },
  { "op": "view.render", "maxSize": 600 }
]
```

**Layer effects.** `layer.effects` sets any of `dropShadow`, `stroke`,
`outerGlow`, `innerGlow` and `colorOverlay` on a raster or text layer; fields
you leave out keep their values, so `{ "enabled": true }` alone turns an
effect on with its defaults. Its entry in `lopsy.describe()` has each
field's range. Effects stay live and follow the layer's pixels. A group has
no effects: give each layer its own. Many live effects slow every later
command down on a software renderer; once a layer's look is final,
`layer.rasterize-style` bakes its effects into its pixels. Like every command
that acts on the active layer, it takes `layer` to name another one, which it
makes active first (here Badge, while Neon was active).

<!-- recipe: filters-and-textures -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Paper" },
  { "op": "color.set", "foreground": "#efe4cf" },
  { "op": "paint.fill" },
  { "op": "filter.texture", "kind": "Canvas", "amount": 35 },

  { "op": "layer.add", "name": "Clouds" },
  { "op": "color.set", "foreground": "#ffffff", "background": "#3d405b" },
  { "op": "filter.clouds", "scale": 6 },
  { "op": "filter.tilt-shift", "focusPosition": 0.35, "focusWidth": 0.2, "blurRadius": 24 },
  { "op": "layer.set", "blendMode": "soft-light", "opacity": 60 },

  { "op": "layer.add", "name": "Dots" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#000000" }, { "position": 1, "color": "#ffffff" } ] } },
  { "op": "select.rect", "x": 40, "y": 220, "width": 520, "height": 140 },
  { "op": "paint.gradient", "from": { "x": 40, "y": 0 }, "to": { "x": 560, "y": 0 } },
  { "op": "filter.halftone", "dotSize": 10 },
  { "op": "select.none" },
  { "op": "filter.mesh-warp", "gridSize": 3, "points": [{ "col": 1, "row": 1, "dx": 0, "dy": -40 }] },
  { "op": "filter.liquify", "strokes": [
    { "mode": "push", "size": 120, "pressure": 60, "points": [
      { "x": 150, "y": 290 }, { "x": 160, "y": 286 }, { "x": 170, "y": 282 }, { "x": 180, "y": 278 },
      { "x": 190, "y": 274 }, { "x": 200, "y": 270 }, { "x": 210, "y": 266 }, { "x": 220, "y": 262 } ] },
    { "mode": "twirl-cw", "size": 140, "pressure": 70, "points": [
      { "x": 430, "y": 290 }, { "x": 430, "y": 290 }, { "x": 430, "y": 290 }, { "x": 430, "y": 290 },
      { "x": 430, "y": 290 }, { "x": 430, "y": 290 }, { "x": 430, "y": 290 }, { "x": 430, "y": 290 },
      { "x": 430, "y": 290 }, { "x": 430, "y": 290 }, { "x": 430, "y": 290 }, { "x": 430, "y": 290 } ] }
  ] },
  { "op": "layer.set", "blendMode": "multiply", "opacity": 80 },

  { "op": "layer.add", "name": "Grain" },
  { "op": "color.set", "foreground": "#808080" },
  { "op": "paint.fill" },
  { "op": "filter.add-noise", "amount": 40, "monochromatic": "Mono", "distribution": "Gaussian" },
  { "op": "layer.set", "blendMode": "overlay", "opacity": 30 },

  { "op": "view.render", "maxSize": 600 }
]
```

**Filters and textures.** A filter rewrites the active layer's pixels, inside
the selection when there is one (the Dots gradient and its halftone stay in
their rectangle). Params you leave out take the filter dialog's defaults.
Some enum values are the dialog's labels, capitalised as shown there
(`"Mono"`, `"Gaussian"`, `"Canvas"`), so read them from the filter family
in `lopsy.describe()`. Useful for illustration: `add-noise` (grain:
fill a layer mid-grey, add mono noise, set it to `overlay`), `texture`
(Grain, Rough, Canvas, Streaks, Cells), `halftone`, `pixelate`, `posterize`,
`threshold`, `oil-paint`, `cel-shading`; `clouds`, `fibers`, `smoke`,
`sunburst` and `voronoi` render texture onto the layer (clouds in the
foreground and background colours); `motion-blur`, `radial-blur`,
`lens-distortion`, `chromatic-aberration`, `kaleidoscope`, `bloom`,
`color-lut`. `tilt-shift` keeps a band sharp and blurs the rest (here the
Clouds): `focusPosition` and `focusWidth` are fractions of the document, 0
the top at `angle` 0. `mesh-warp` bends the layer by moving points of a grid
laid over the selection's box, or the whole document (here it lifts the
middle of the Dots band 40 px): each point is `{ col, row, dx, dy }`, offsets
in pixels. `liquify` warps the layer with brush strokes, as the Liquify
brush does by hand: each stroke has a `mode`, a brush `size` (its diameter)
and a `pressure` (percent), and `points`, the first a press and every
further one a pointer move that makes **one dab**. A `push` dab shoves the
pixels under the brush along the way the pointer came from the point before
it, so give a push stroke points a few pixels apart, a quarter of the brush
size or less (here it smears the left of the Dots up and to the right).
`twirl-cw`, `twirl-ccw`, `bloat` and `pinch` turn, swell or shrink what is
under the brush a little with every dab, wherever the pointer came from, so
repeat a point to work on one spot (the twelve dabs at 430, 290); at 10%
pressure or less a twirl hardly builds up however many dabs it gets, so use
more pressure rather than more dabs. All the strokes of one call are one history step. Filters
refuse text and group layers. `clouds`, `fibers`, `smoke` and `add-noise`
draw a new random seed on every run.

<!-- recipe: masks -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Sea" },
  { "op": "color.set", "foreground": "#0b3954" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Sunset" },
  { "op": "color.set", "foreground": "#ff6663" },
  { "op": "paint.fill" },
  { "op": "mask.add" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#ffffff" }, { "position": 1, "color": "#000000" } ] } },
  { "op": "paint.gradient", "from": { "x": 0, "y": 100 }, "to": { "x": 0, "y": 300 } },
  { "op": "mask.edit", "enabled": false },

  { "op": "layer.add", "name": "Porthole" },
  { "op": "color.set", "foreground": "#fefae0" },
  { "op": "paint.fill" },
  { "op": "select.ellipse", "x": 180, "y": 80, "width": 240, "height": 240 },
  { "op": "select.invert" },
  { "op": "mask.add" },
  { "op": "tool.set", "tool": "brush", "options": { "size": 30, "hardness": 100 } },
  { "op": "paint.stroke", "points": [{ "x": 40, "y": 360 }, { "x": 560, "y": 360 }] },
  { "op": "mask.edit", "enabled": false },

  { "op": "view.render", "maxSize": 600 }
]
```

**Masks.** `mask.add` gives the active layer a mask and **enters mask edit
mode**: from then on paint, fill, gradient and filter commands write the
mask, not the pixels, until `mask.edit` with `enabled: false`. With a
selection, the new mask reveals only the selection and the selection is
dropped (the Porthole frame keeps everything outside its circle). In the
mask, white reveals and black hides: `paint.fill` and `paint.gradient` use
the grey value of their colours, but the **brush and pencil always hide and
the eraser always reveals**, whatever the foreground. `mask.edit` with
`enabled: true` goes back into a mask later, `mask.clear` resets it and
`mask.remove` deletes it.

<!-- recipe: group-adjustments -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.set", "name": "Field" },
  { "op": "color.set", "foreground": "#90be6d" },
  { "op": "paint.fill" },
  { "op": "layer.add", "name": "Barn" },
  { "op": "color.set", "foreground": "#c1121f" },
  { "op": "select.rect", "x": 200, "y": 150, "width": 200, "height": 160 },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.group", "layers": ["Field", "Barn"] },
  { "op": "layer.set", "name": "Farm" },
  { "op": "adjust.add", "group": "Farm", "type": "hue-saturation" },
  { "op": "adjust.set", "group": "Farm", "node": "hue-saturation", "params": { "saturation": -60 } },
  { "op": "adjust.add", "group": "Farm", "type": "curves" },
  { "op": "adjust.set", "group": "Farm", "node": "curves", "params": {
    "curves": { "rgb": [{ "x": 0, "y": 0.1 }, { "x": 0.5, "y": 0.45 }, { "x": 1, "y": 0.95 }] } } },

  { "op": "adjust.set", "group": "Project", "node": "exposure", "params": { "exposure": 0.3 } },
  { "op": "adjust.list", "group": "Farm" },
  { "op": "view.render", "maxSize": 600 }
]
```

**Adjustments on a group.** Adjustments are non-destructive nodes on a
group: they apply to everything inside it and can be changed or removed at
any time. `layer.group` wraps layers in a new group named `Group` (rename it
with `layer.set`); `adjust.add` appends a node (`exposure`, `contrast`,
`highlights-shadows`, `saturation`, `vignette`, `curves`, `levels`,
`hue-saturation`, `color-balance`, `color-grading`, `invert`,
`black-white`, `photo-filter`, `channel-mixer`, `gradient-map`) and
`adjust.set` changes its params, which `adjust.list` shows with their
current values. The root group `Project` starts with levels, curves,
exposure, hue/saturation and colour-grading nodes at neutral settings:
adjust those to grade the whole image. `filter.hue-saturation` and
`filter.brightness-contrast` are the destructive equivalents on one layer.

<!-- recipe: move-flip-turn -->
```json
[
  { "op": "doc.new", "width": 600, "height": 400 },
  { "op": "layer.add", "name": "Arrow" },
  { "op": "color.set", "foreground": "#3d5a80" },
  { "op": "select.polygon", "points": [
    { "x": 60, "y": 80 }, { "x": 160, "y": 80 }, { "x": 160, "y": 50 }, { "x": 220, "y": 110 },
    { "x": 160, "y": 170 }, { "x": 160, "y": 140 }, { "x": 60, "y": 140 } ] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.duplicate" },
  { "op": "layer.set", "name": "Back" },
  { "op": "layer.move", "dx": 300, "dy": 0 },
  { "op": "image.flip-layer", "axis": "horizontal" },

  { "op": "layer.duplicate", "layer": "Arrow" },
  { "op": "layer.set", "name": "Down", "opacity": 60 },
  { "op": "layer.transform", "rotate": 90 },
  { "op": "layer.move", "dx": 0, "dy": 160 },
  { "op": "layer.nudge", "dx": 3, "dy": 0 },

  { "op": "layer.duplicate", "layer": "Arrow" },
  { "op": "layer.set", "name": "Tilted" },
  { "op": "layer.transform", "rotate": -30 },
  { "op": "layer.transform", "scale": { "x": 0.6, "y": 0.6 }, "anchor": "top-left" },
  { "op": "layer.move", "dx": 300, "dy": 230 },

  { "op": "layer.duplicate", "layer": "Arrow" },
  { "op": "layer.set", "name": "Leaning" },
  { "op": "layer.transform", "skew": { "x": -20, "y": 0 }, "anchor": "bottom" },
  { "op": "layer.move", "dx": 0, "dy": 190 },

  { "op": "layer.duplicate", "layer": "Arrow" },
  { "op": "layer.set", "name": "Receding" },
  { "op": "layer.transform", "perspective": { "top": { "inset": 40 } } },
  { "op": "layer.transform", "distort": { "bottom-right": { "x": 30, "y": 20 } } },
  { "op": "layer.move", "dx": 170, "dy": 40 },

  { "op": "view.render", "maxSize": 600 }
]
```

**Moving, flipping, turning and scaling.** `layer.move` moves a layer by
(dx, dy) as a Move-tool drag would, and returns where its content is
afterwards. It is **refused while a selection is active** (a drag would lift
the selected pixels instead), so `select.none` first. `image.flip-layer`
mirrors one layer about its own content (`image.rotate` turns the whole
image). `layer.transform` turns layers by any angle (`rotate`, degrees
clockwise), scales them (`scale: { "x": …, "y": … }`), or flips several
layers together, about their content. `rotate: 90` and `-90` are exact
quarter turns; any other angle, and every scale, drags the Move tool's
transform handles for you and resamples the pixels, so turn and scale once
rather than in many small steps. A scale keeps its `anchor` still and drags the
handle opposite it (default `"top-left"`: the bottom-right corner moves;
`"left"`, `"right"`, `"top"` and `"bottom"` scale one axis): there is no scaling about the
centre, so follow it with `layer.move` when the centre matters. The result
gives the angle or factors reached, which land within 0.01° and half a
pixel of what you asked, as a drag on whole pixels does. On one raster layer
it selects the layer's pixels for the drag and drops the selection after,
so `history.undo` brings that selection back: `select.none` with
`commit: true` before the next move. Text stays live through all of them.

`layer.transform` also reaches the Move tool's other three modes. `skew`
shears by degrees along one axis (`{ "x": -20, "y": 0 }`): an edge slides
along itself while the `anchor` edge opposite holds still, and a positive
`x` leans the bottom to the right of the top, a positive `y` the right side
below the left. `distort` moves corners of the box by pixel offsets, each on
its own (`{ "bottom-right": { "x": 30, "y": 20 } }`), and the picture
stretches to follow. `perspective` narrows or widens the top or bottom edge
evenly about its middle: `{ "top": { "inset": 40 } }` moves both ends of the
top edge 40 px inward, so the picture recedes upward. Offsets are in
document pixels, from where the corners of the box round the layer's content
are now, and the corners must stay a convex quad. `distort` and
`perspective` add **one history step per corner or edge moved**, and the
result's `corners` says how far each corner went; a text layer takes `skew`
and stays live, but must be rasterized (`layer.rasterize`) for the other
two.
`layer.duplicate` puts the copy, named
`<name> copy`, directly on top of the original and makes it active.

<!-- recipe: duplicate-and-group -->
```json
[
  { "op": "doc.new", "width": 600, "height": 300 },
  { "op": "layer.set", "name": "Snow" },
  { "op": "color.set", "foreground": "#edf6f9" },
  { "op": "paint.fill" },

  { "op": "layer.add", "name": "Tree" },
  { "op": "color.set", "foreground": "#2d6a4f" },
  { "op": "select.polygon", "points": [{ "x": 80, "y": 60 }, { "x": 130, "y": 230 }, { "x": 30, "y": 230 }] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.duplicate", "layer": "Tree" },
  { "op": "layer.set", "name": "Tree 2" },
  { "op": "layer.move", "dx": 160, "dy": 0 },
  { "op": "layer.duplicate", "layer": "Tree 2" },
  { "op": "layer.set", "name": "Tree 3" },
  { "op": "layer.move", "dx": 160, "dy": 0 },

  { "op": "layer.group", "layers": ["Tree", "Tree 2", "Tree 3"] },
  { "op": "layer.set", "name": "Forest", "opacity": 85 },
  { "op": "layer.add", "name": "Inside the group" },
  { "op": "doc.info" },
  { "op": "view.render", "maxSize": 600 }
]
```

**Duplicating and grouping.** Repeated elements are a duplicate and a move
each (or a fill each from computed geometry). `layer.group` puts the named
layers in a new group where the topmost of them was and makes the group
active. **`layer.add` inserts directly above the active layer, in the active
layer's group; when the active layer is a group, the new layer goes inside
it, at the top**, which is how "Inside the group" lands in Forest. To put a
layer somewhere else, `layer.reorder` moves it above or below another layer,
or `inside` a group. A group's opacity, blend mode and adjustments apply to
everything in it.

<!-- recipe: place-an-image -->
```json
[
  { "op": "doc.new", "width": 800, "height": 600 },
  { "op": "layer.add-image", "base64": "<base64 of photo.jpg>", "name": "photo.jpg" },
  { "op": "select.none" },
  { "op": "layer.set", "name": "Photo" },
  { "op": "filter.desaturate" },
  { "op": "layer.add", "name": "Duotone" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#2b2d42" }, { "position": 1, "color": "#ef8354" } ] } },
  { "op": "paint.gradient", "from": { "x": 0, "y": 0 }, "to": { "x": 800, "y": 600 } },
  { "op": "layer.set", "blendMode": "color", "opacity": 85 },
  { "op": "view.render", "maxSize": 800 }
]
```

**Placing an image.** `layer.add-image` takes an image file's bytes (PNG,
JPEG, GIF, BMP or WebP) as base64 ([Bytes in](#bytes-in)). The image becomes
a new layer named `Pasted Layer` above the active layer, centred and **shrunk to fit** when it is larger than
the canvas. As with a paste in the UI, its pixels become the selection and
the Move tool is chosen, so `select.none` before anything else (the selection
would constrain filters and paint, and `layer.move` refuses while it is
active). `doc.open` opens an image as a new document at its own size instead.

<!-- recipe: undo -->
```json
[
  { "op": "doc.new", "width": 300, "height": 200 },
  { "op": "color.set", "foreground": "#9d4edd" },
  { "op": "select.rect", "x": 20, "y": 20, "width": 120, "height": 120 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.add", "name": "Mistake" },
  { "op": "color.set", "foreground": "#ff0000" },
  { "op": "paint.fill" },
  { "op": "history.undo", "steps": 3 },
  { "op": "doc.info" }
]
```

**Undo.** `history.undo` and `history.redo` take `steps`. Every command's
summary gives its history label, and `doc.info` lists the labels to undo and
redo, so you can count steps. `layer.add` with a name is two steps (Add Layer,
Rename Layer); colour, tool-option, selection-replace and `select.none`
changes are none. Here the three steps undo the red fill and the named layer,
and `doc.info` shows `["New Document", "Fill"]`.

### A complete composition

A sunset poster in eight layers: a gradient sky, a glowing sun, two ridges
with mist between them, film grain, and type with a shadow. It runs in a few
seconds.

<!-- recipe: evening-poster -->
```json
[
  { "op": "doc.new", "width": 1200, "height": 800 },
  { "op": "layer.set", "name": "Sky" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#1b2a4a" }, { "position": 0.55, "color": "#c8553d" }, { "position": 1, "color": "#f2a541" } ] } },
  { "op": "paint.gradient", "from": { "x": 600, "y": 0 }, "to": { "x": 600, "y": 640 } },

  { "op": "layer.add", "name": "Sun" },
  { "op": "color.set", "foreground": "#ffe8a3" },
  { "op": "select.ellipse", "x": 470, "y": 330, "width": 260, "height": 260 },
  { "op": "paint.fill" },
  { "op": "select.none" },
  { "op": "layer.effects", "outerGlow": { "enabled": true, "color": "#ffb347", "size": 80, "opacity": 80 } },

  { "op": "layer.add", "name": "Far ridge" },
  { "op": "color.set", "foreground": "#5b3f63" },
  { "op": "select.polygon", "points": [
    { "x": 0, "y": 800 }, { "x": 0, "y": 520 }, { "x": 180, "y": 450 }, { "x": 340, "y": 540 }, { "x": 560, "y": 470 },
    { "x": 820, "y": 560 }, { "x": 1000, "y": 470 }, { "x": 1200, "y": 530 }, { "x": 1200, "y": 800 } ] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Mist" },
  { "op": "tool.set", "tool": "gradient", "options": { "type": "linear", "stops": [
    { "position": 0, "color": "#ffd9a000" }, { "position": 1, "color": "#ffd9a0" } ] } },
  { "op": "paint.gradient", "from": { "x": 600, "y": 470 }, "to": { "x": 600, "y": 640 } },
  { "op": "layer.set", "blendMode": "screen", "opacity": 70 },

  { "op": "layer.add", "name": "Near ridge" },
  { "op": "color.set", "foreground": "#0e1628" },
  { "op": "select.polygon", "points": [
    { "x": 0, "y": 800 }, { "x": 0, "y": 600 }, { "x": 240, "y": 560 }, { "x": 420, "y": 640 },
    { "x": 700, "y": 590 }, { "x": 960, "y": 660 }, { "x": 1200, "y": 600 }, { "x": 1200, "y": 800 } ] },
  { "op": "paint.fill" },
  { "op": "select.none" },

  { "op": "layer.add", "name": "Grain" },
  { "op": "color.set", "foreground": "#808080" },
  { "op": "paint.fill" },
  { "op": "filter.add-noise", "amount": 40, "monochromatic": "Mono", "distribution": "Gaussian" },
  { "op": "layer.set", "blendMode": "overlay", "opacity": 35 },

  { "op": "text.set-font", "family": "Barlow Condensed", "weight": 700 },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 170, "align": "center" } },
  { "op": "color.set", "foreground": "#f7f1e3" },
  { "op": "text.add", "x": 600, "y": 40, "text": "EVENING" },
  { "op": "layer.effects", "dropShadow": { "enabled": true, "color": "#1b2a4a", "offsetX": 0, "offsetY": 6, "blur": 18, "opacity": 50 } },

  { "op": "layer.select", "layer": "Grain" },
  { "op": "text.set-font", "family": "Montserrat", "weight": 700 },
  { "op": "tool.set", "tool": "text", "options": { "fontSize": 26, "align": "center" } },
  { "op": "text.add", "x": 600, "y": 730, "text": "A WALK IN THE HILLS  ·  SEPTEMBER" },

  { "op": "view.render", "maxSize": 800 },
  { "op": "doc.export", "format": "png" }
]
```

The last two results carry an 800 × 533 preview and the 1200 × 800 PNG. In real work you would send this as four or
five stages and look at each one; it is one list here so it can be tested
whole.

## What the API does not offer

These have no command. Don't hunt for them:

- **Colouring part of a text layer.** `text.set-color` recolours the whole
  layer; colours on ranges of the text need it open for editing.
- **Anything that needs the system clipboard or a file picker.** A browser
  allows those only inside a person's click. Files go in and out as base64
  (`doc.open`, `layer.add-image`, `doc.save`, `doc.export`,
  `doc.export-psd`), and `clipboard.*` is the editor's own clipboard.
  `doc.export` takes everything the Export dialog offers: format, JPEG/WebP
  quality and 16-bit PNG.
- **Listing the fonts installed on the machine.** `text.fonts` lists the font
  picker's catalogue (the Google Fonts and the browser's own); installed fonts
  are left out, and `text.set-font` takes one only once the browser has
  granted the page access to them.

## Behaviours worth knowing

Each of these was checked on the editor page.

- **A new document** is a white `Background`, an empty `Layer 1` (active) and
  the root group `Project`. It changes nothing else: the colours, the tool
  options and the active tool carry over from before `doc.new` (Move on a
  fresh page; the Brush after a `paint.stroke`).
- **A selection constrains painting, fills, gradients and filters until
  `select.none`.** It is the most common cause of "my stroke only half
  appeared". `select.none` takes `commit`: `true` also commits a pending Move
  float or layer transform, as Cmd+D does. `commit: true` is the safe default
  when you want a clean state.
- **`layer.add` inserts above the active layer**, inside the active layer's
  group, or inside the active group at its top. Text from `text.add` lands
  the same way. Plan which layer is active before you add.
- **`text.add` puts point text's line box at (x, y)**, for left alignment
  its top-left; the ink starts lower, by about a third of the font size for
  capitals in most faces. Read the real bounds from `doc.info` (`x`, `y` of
  the text layer) or `view.render-layer`.
- **After `text.add`, the text settings belong to the new text layer.**
  `text.set-font` restyles it and `tool.set` on the text tool is refused until
  another layer is active.
- **The Shape tool's fill starts as the foreground colour** the first time it
  is chosen on a page, unless `tool.set` has given it a `fillColor` already.
- **In mask edit mode the brush and pencil always hide and the eraser always
  reveals**; `paint.fill` and `paint.gradient` write the grey value of their
  colours.
- **`layer.move` is refused while a selection is active**, and
  `layer.add-image` leaves one: `select.none` after placing an image.
- **`color.set` takes opaque colours only** (`"#rrggbb"` or `"#rgb"`;
  `"#rrggbbaa"` is `invalid`). For a translucent fill, lower the layer's
  opacity, or use a gradient stop with alpha.
- **`view.sample` reads the canvas as the Eyedropper does**: in mask edit
  mode that includes the mask overlay's tint. `view.render` and `doc.export`
  give the image itself.
- **Your next edit commits text the person is typing** (checked with
  `layer.add`), keeping what they typed; a read such as `doc.info` does not.
- **A Move transform the person has pending** refuses `layer.transform` (the
  message says what to do); `paint.fill` or `paint.stroke` commits it and
  paints inside the transformed selection.
- **The undo history holds 50 steps.** Older steps fall off the bottom.
  Save projects as checkpoints instead of relying on deep undo.
- **Fonts download on first use.** `fontLoaded: false` (after 20 s without
  the font) means the change was made in a fallback face; it switches when the
  font arrives. Don't repeat the command.
- **Software WebGL is much slower than a GPU.** A browser with no GPU (a
  headless Chromium on most servers, or one started with the SwiftShader
  flags) renders in software: simple commands take milliseconds, but a large
  layer effect or a `view.render` of a 3000 × 2000 document takes seconds.
  Keep documents around 1000–2000 px on the long side, render previews with
  `maxSize`, and use the GPU when the machine has one. This names the
  renderer the page gets (SwiftShader, or another software renderer such as
  llvmpipe, when there is no GPU):

  <!-- snippet: renderer -->
  ```js
  (() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no WebGL2';
  })()
  ```
- **Exports are wide-gamut.** PNGs from `doc.export` and `view.render` carry a
  Display P3 colour profile: your hex values are written unchanged and tagged
  P3, so a colour-managed viewer shows them a little more saturated than the
  same hex in sRGB. That's expected, not a bug.
- **Something that looks like a bug may be one.** Search
  <https://github.com/theseamusjames/lopsy.art/issues> for workarounds.

## The guestbook

If you made something here, sign the guestbook: it is how agents say hello
to the people who make Lopsy. `lopsy.guestbook(entry)` takes your name, your
region, your model and a message. Each is optional and up to 100 characters:

<!-- snippet: guestbook -->
```js
lopsy.guestbook({ name: 'Ada', region: 'Lisbon', model: 'Example-1', message: 'Hello, the gradients are lovely' })
```

It is `lopsy.run({ op: 'guestbook.sign', ...entry })` under another name, so
it resolves to the same envelope, with `{ signed: true }` as the result, and
can be the last step of a batch. Nothing in the document changes. The entry
is kept with the site's usage statistics (Google Analytics), so put nothing
private in it. `signed` is `false` when the page has no analytics to carry
the entry, as on a development build or behind a blocker.

## Appendix: a ready-made driver

If you have a shell with Node 18+ and no browser tool of your own, this is
one way to reach the page; nothing above depends on it. The driver keeps
**one** headless Chromium page open and turns HTTP on `127.0.0.1:47391` into
`window.lopsy` calls. Install Playwright's Chromium, save the driver below as
`lopsy-driver.mjs`, then start it (the last line) and leave it running:

```bash
mkdir lopsy-work && cd lopsy-work
npm init -y
npm install --save-exact playwright@1.58.2
npx playwright install chromium
node lopsy-driver.mjs > driver.log 2>&1 &
```

It is **local-only**: it listens on the loopback interface and refuses any
request a web page makes, so only programs on your machine can use it. Do
not expose its port (no tunnel, port forward or proxy).

- `POST /run` with a JSON body, one invocation or an array, runs it and
  answers with the result envelope. Each `base64` field in the result is
  written to `OUT_DIR` and replaced by `file`, its path; `POST /run?name=poster`
  names those files `poster-NNN.png` (a plain file name, never a path).
- `{ "$file": "path" }` anywhere in a request is replaced by that file's
  bytes as base64: use it wherever this guide writes `"<base64 of …>"`. The
  file must be inside the directory the driver runs in or `OUT_DIR` (after
  following symlinks): copy anything else in first.
- A failure comes back with the page's console errors since the request
  began, as `consoleErrors`. What the driver refuses (a body that is not
  JSON, a `$file` outside those directories, a bad `name`) is HTTP 400 with
  code `driver`, before anything runs; HTTP 500 with code `driver` means the
  browser or the driver failed (see `driver.log`).
- `GET /describe` lists every command with its summary; `?op=layer.effects`
  returns one command's schema, `?family=filter` a family's.
- `POST /quit` closes the browser and stops the driver; send it when you're
  done (`curl -s -X POST 127.0.0.1:47391/quit`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOPSY_URL` | `https://lopsy.art/` | Point at a local dev server instead (`http://localhost:5173/`). |
| `DRIVER_PORT` | `47391` | Change if the port is taken. |
| `OUT_DIR` | `./lopsy-out` | Where renders, exports and projects are written. `$file` can read from here and from the directory the driver runs in. |
| `HEADED` | unset | `1` shows the browser window, where a person can watch and work in the same document. Keep the editor the visible tab (see [Setup](#the-page-must-be-the-visible-tab)). |
| `REAL_GPU` | unset | `1` uses the GPU instead of SwiftShader (on Linux through ANGLE's GL/EGL backend). Much faster on a machine with a GPU. |

The driver prints the WebGL renderer at startup: if it names SwiftShader
under `REAL_GPU=1`, the GPU was not picked up. Edit `GPU_ARGS` for your
platform (on Linux, `--use-angle=vulkan --enable-features=Vulkan
--ignore-gpu-blocklist` is the other combination known to work).

Tested against lopsy.art with Playwright 1.58.2.

<!-- driver: lopsy-driver.mjs -->
```js
// lopsy-driver.mjs — keeps ONE Lopsy editor page open and runs the commands POSTed to it.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const LOPSY_URL = process.env.LOPSY_URL ?? 'https://lopsy.art/';
const PORT = Number(process.env.DRIVER_PORT ?? 47391);
const OUT = process.env.OUT_DIR ?? './lopsy-out';
fs.mkdirSync(OUT, { recursive: true });
// $file reads only from these: the directory the driver runs in, and OUT_DIR.
const READABLE = [process.cwd(), OUT].map((dir) => fs.realpathSync(dir));

// SwiftShader makes WebGL2 work on any headless/CI machine; a real GPU is much
// faster. Headless Chromium on Linux falls back to SwiftShader unless ANGLE is
// told to use the GPU's GL driver; elsewhere no flags pick the GPU.
const GPU_ARGS = process.platform === 'linux' ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] : [];
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: process.env.REAL_GPU === '1' ? GPU_ARGS : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
await page.goto(LOPSY_URL);
await page.waitForFunction(() => !!window.lopsy, null, { timeout: 60000 });
const RENDERER = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no WebGL2';
});
console.log(`renderer: ${RENDERER}`);
if (process.env.REAL_GPU === '1' && /SwiftShader/i.test(RENDERER)) {
  console.log('warning: REAL_GPU=1 but the browser fell back to SwiftShader; adjust GPU_ARGS (see SKILL.md)');
}

// Image and project bytes never come back to you: each `base64` field in a
// result is written to OUT_DIR and replaced by `file`, the path it went to.
let fileN = 0;
function saveFiles(value, name) {
  if (Array.isArray(value)) return value.map((v) => saveFiles(v, name));
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === 'base64' && typeof v === 'string') {
      const ext = plainName(String(value.ext ?? String(value.mime).split('/').pop()), 'the file extension');
      fileN += 1;
      const file = path.join(OUT, `${name}-${String(fileN).padStart(3, '0')}.${ext}`);
      fs.writeFileSync(file, Buffer.from(v, 'base64'));
      out.file = file;
    } else {
      out[key] = saveFiles(v, name);
    }
  }
  return out;
}
// The other way: { "$file": "path" } anywhere in a request is replaced by that
// file's bytes as base64, for doc.open and layer.add-image.
function loadFiles(value) {
  if (Array.isArray(value)) return value.map(loadFiles);
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.$file === 'string') return fs.readFileSync(readablePath(value.$file)).toString('base64');
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, loadFiles(v)]));
}
class DriverError extends Error {}
function readablePath(file) {
  let real;
  try { real = fs.realpathSync(file); } catch (err) { throw new DriverError(`$file ${file}: ${err.message}`); }
  if (READABLE.some((dir) => real === dir || real.startsWith(dir + path.sep))) return real;
  throw new DriverError(`$file ${file} is outside the driver's directory and OUT_DIR: copy it into one of them`);
}
// A name from a request becomes part of a file name in OUT_DIR, never a path.
function plainName(name, what) {
  if (/^[\w.-]+$/.test(name) && !name.includes('..')) return name;
  throw new DriverError(`${what} ${JSON.stringify(name)} must be letters, digits, '-', '_' and '.', with no path in it`);
}

// GET /describe: one line per command. ?op=layer.effects: that command's full
// schema. ?family=filter: every filter command's.
async function describe(query) {
  const all = await page.evaluate(() => window.lopsy.describe());
  const op = query.get('op');
  const family = query.get('family');
  if (op) return all.find((c) => c.id === op) ?? { error: `no command ${op}; GET /describe lists them` };
  if (family) return all.filter((c) => c.id.startsWith(`${family}.`));
  return all.map((c) => `${c.id}: ${c.summary}`).join('\n') + '\n';
}

// Only this machine may use the driver. It listens on 127.0.0.1, and refuses a
// request addressed to any other host name (a web page reaching it by DNS
// rebinding) or sent by a web page (browsers add Origin or Sec-Fetch-Site).
const HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
function isFromThisMachine(req) {
  const site = req.headers['sec-fetch-site'];
  return HOSTS.includes(req.headers.host) && req.headers.origin === undefined
    && (site === undefined || site === 'none' || site === 'same-origin');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  // Decoded once: a character split between two chunks would not survive decoding each.
  const body = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(body); } catch (err) { throw new DriverError(`the body is not JSON: ${err.message}`); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, body) => {
    const isText = typeof body === 'string';
    res.writeHead(status, { 'content-type': isText ? 'text/plain' : 'application/json' });
    res.end(isText ? body : JSON.stringify(body, null, 1) + '\n');
  };
  if (!isFromThisMachine(req)) return send(403, 'refused: the driver serves only requests from this machine, not web pages\n');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /describe') return send(200, await describe(url.searchParams));
    if (route === 'POST /quit') {
      send(200, 'bye\n');
      await browser.close();
      process.exit(0);
    }
    if (route !== 'POST /run') return send(['/run', '/quit', '/describe'].includes(url.pathname) ? 405 : 404, 'POST /run, POST /quit, GET /describe\n');
    // POST /run?name=poster names the files this request writes poster-NNN.<ext>.
    const name = plainName(url.searchParams.get('name') ?? 'out', 'name');
    const invocation = loadFiles(await readJson(req));
    consoleErrors = [];
    const outcome = saveFiles(await page.evaluate((inv) => window.lopsy.run(inv), invocation), name);
    if (!outcome.ok && consoleErrors.length > 0) outcome.consoleErrors = consoleErrors;
    send(200, outcome);
  } catch (err) {
    if (err instanceof DriverError) return send(400, { ok: false, error: { code: 'driver', message: err.message } });
    send(500, { ok: false, error: { code: 'driver', message: String(err?.stack ?? err) }, consoleErrors });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`lopsy driver on http://127.0.0.1:${PORT} → ${LOPSY_URL}`));
```

Send a stage as a JSON file, always with `--data-binary @file` (`--data`
strips newlines, and shell quoting mangles JSON):

```bash
cat > steps/01-sky.json <<'EOF'
[
  { "op": "doc.new", "width": 1200, "height": 800 },
  { "op": "color.set", "foreground": "#1b2a4a" },
  { "op": "paint.fill" },
  { "op": "view.render", "maxSize": 800 }
]
EOF
curl -s --data-binary @steps/01-sky.json 127.0.0.1:47391/run
```

The answer's last result holds `"file": "lopsy-out/out-001.png"`: open that
image and look at it.
