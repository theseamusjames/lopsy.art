---
title: Design a Vaporwave Venice Poster
description: Make a pastel vaporwave poster in Lopsy with a halftone sun, a perspective checkerboard floor, a neon gondola and a retro Windows-style dialog.
published: 2026-09-26 13:30
updated: 2026-10-01
level: Intermediate
duration: 60
tags: vaporwave, poster design, perspective transform, pattern fill, halftone, layer effects, text effects, retro
related: vaporwave-sunset-billboard, neon-glow-text-effect, maximalist-zine-cover
cover: cover.jpg
coverAlt: Lopsy showing the finished Pink Gondola vaporwave poster, a neon-outlined gondola floating on a pink and purple checkerboard floor in front of a pastel Doge's Palace and a halftone sun
finished: finished-pink-gondola.webp
finishedAlt: The finished Pink Gondola poster, with a pink Shrikhand headline over a teal-to-peach cloudy sky, a halftone pink sun behind a pastel Venetian palace with teal domes and a pink bell tower, a gondolier rowing a neon-outlined gondola across a perspective checkerboard floor, striped mooring poles and a tilted gondola.exe dialog window
project: vaporwave-venice-poster.lopsy
---

Vaporwave takes something familiar and makes it dreamlike. Here that's
Venice. In this tutorial you'll make **Pink Gondola**, a 1200 × 1600 poster
where a gondola floats across a checkerboard floor in front of a pastel Doge's
Palace. A halftone sun sets behind it, and a Windows-style `gondola.exe` dialog
reports that you're drifting to 1989.

Along the way you'll use:

- gradients with transparent stops
- the Clouds, Halftone and Pattern Fill filters
- the **Perspective** transform mode
- groups, Merge Down and rotations
- stroke, glow and drop-shadow effects
- three Google Fonts
- a root-level Vignette adjustment

Every piece stays on its own layer, so you can rearrange it later.

## Set up a pastel sunset gradient

![The Gradient Editor with four stops running from teal through lavender and pink to peach](01-sunset-gradient-stops.webp)

Choose **File → New**, set **Width** to `1200` and **Height** to `1600`, keep
a white background and click **Create**. Double-click `Layer 1` and rename it
`Sky`.

Pick the **Gradient** tool and click **Advanced…** to open the Gradient
Editor. Click the handle row to add stops. Select each stop and type its
colour into the hex field:

- teal `#2EC4C9` at 0 %
- lavender `#9D8CF0` at about 45 %
- pink `#FF8FC8` at about 80 %
- peach `#FFD1A8` at 100 %

Click **Done**.

## Paint the sky and place guides

![A teal-to-peach gradient filling the top of the canvas, with a vertical guide at the center and a horizontal horizon guide a little less than two-thirds of the way down](02-sky-and-guides.webp)

Place the guides first. [[Cmd]]-click the middle of the top ruler to drop a
vertical guide exactly on the centre line. Then click the left ruler at about
**1020** for the horizon, a little less than two-thirds of the way down (the
ruler shows a readout as you hover). You'll line up the sun, the palace and
the floor against these two guides.

Drag the gradient straight down from the top edge to the horizon guide.
Everything below it is peach for now.

## Render clouds

![The Clouds filter dialog at Scale 3 with Preview on, showing soft grey clouds over the whole canvas](03-clouds-filter.webp)

Click **Add Layer** and name the new layer `Clouds`. Choose
**Filter → Clouds…**, set **Scale** to `3` and tick **Preview**. Clouds is
randomized, so if you don't like the pattern, click the circular-arrow
**Regenerate** button next to Preview for a new one. Click **Apply**.

## Blend the clouds into the sky

![Soft white clouds screened over the sunset gradient, stopping cleanly at the horizon line](04-clouds-screen.webp)

Open the layer's effects drawer (the ✦ button on its row), set **Blend** to
**Screen** and close the drawer. Then set the row's opacity to **60 %**.
Screen only brightens, so the clouds glow over the gradient and don't go grey.

Rectangular-marquee everything below the horizon guide and press
[[Delete]]. Press [[Cmd+D]] to deselect.

## Draw the sun

![A circular selection at the top of the palace area filled with a gradient from pale yellow to hot pink, with marching ants and handles visible](05-sun-gradient.webp)

Add a layer named `Moon`. In the Gradient Editor, set three stops: pale yellow
`#FFF1B8`, pink `#FF9CC8` at 55 % and hot pink `#FF4F9E`.

With the **Elliptical Marquee**, [[Cmd]]-drag a 540 px circle centred on the
centre guide, with its top a little under a fifth of the way down the poster
and its bottom well above the horizon. Holding [[Cmd]] keeps it perfectly
round. Drag the gradient from the top of the circle to the bottom. Deselect.

> **Tip:** You'll need this exact circle again for the dots. Click once with
> the Elliptical Marquee while nothing is selected to type its corners:
> **From** 330, 290 **To** 870, 830. For the trim circle in the next step but
> one, use 334, 294 to 866, 826.

Open the effects drawer, enable **Outer Glow** in cream `#FFF4D6`, then set
**Size** `60`, **Spread** `10` and **Opacity** `70`.

## Add a halftone fade

![The Halftone dialog with Dot Size 14, Angle 0 and Softness 4, previewing pink dots that grow toward the bottom of the sun](06-halftone-dialog.webp)

Most vaporwave suns are cut into stripes. This one fades out in halftone dots
instead.

1. Add a layer named `Moon Dots` and set the gradient to plain white → black.
2. Re-draw the same circle and drag the gradient from about a third of the
   way down the sun to its bottom edge, then deselect.
3. Choose **Filter → Halftone…** and set **Dot Size** `14`, **Angle** `0` and
   **Softness** `4`. Dark areas become big dots and light areas become tiny
   ones. Click **Apply**.

## Recolor and trim the dots

![The sun covered in fine pink halftone dots that grow larger toward its lower edge](07-halftone-sun.webp)

Enable **Color Overlay** on `Moon Dots` in `#E23C93`, so every dot turns a
deep sunset pink.

Dots near the rim poke out past the circle. Draw a circle about 4 px inside
the sun's edge (about 532 px across), choose **Select → Inverse** and press
[[Delete]]. The edge is clean again.

## Make a checkerboard tile

![A 100 by 100 pixel pink and purple checker tile in the top-left corner of the canvas with a marquee around it](08-checker-tile.webp)

Add a temporary layer.

1. Marquee a 100 × 100 square in the top-left corner of the canvas and
   **Edit → Fill** it with deep purple `#3A1C71`.
2. Fill the top-left and bottom-right 50 px quarters with pink `#FF6EC7`.
3. Marquee the whole 100 × 100 tile and choose **Edit → Define Pattern**.

Delete the temporary layer.

## Tilt the floor with Perspective

![The checkerboard floor with the Perspective transform active, its bottom corners pulled far outside the canvas so the tiles converge toward the horizon](09-perspective-floor.webp)

Click the `Moon Dots` row, then add a layer named `Floor`. Marquee the whole
width of the canvas from the horizon guide down to the bottom edge. Choose
**Edit → Fill with Pattern…**, pick the checker tile and click **Apply**.

Zoom out with [[Cmd+-]] a couple of times so there's room around the canvas.
Keep the marquee, switch to the **Move** tool and click **Perspective** in the
Options bar. Drag the **bottom-left corner** far out to the left, almost a
full canvas width past the edge. The bottom-right corner mirrors it, so the
tiles now converge toward the horizon.

## Commit the floor

![The finished checkerboard floor running from the horizon to the bottom of the poster](10-floor-committed.webp)

Click **Free**, then press [[Cmd+D]] to commit the transform. Press
[[Cmd+0]] to fit the canvas back in the window. Anything pulled past the
canvas edge is simply cropped away.

## Fade the floor into haze

![A pale pink haze fading down from the horizon over the top rows of the checkerboard](11-haze-gradient.webp)

Add a layer named `Haze`. Set two gradient stops, both pale pink `#F8D8F2`.
Select the right-hand stop and drag the **Opacity** bar under the colour
picker all the way to transparent.

Marquee the floor area, then drag the gradient from the horizon down about
230 px, about two-fifths of the way to the bottom edge. The far rows now dissolve into mist. Because the haze fades out,
there's no hard seam between it and the floor.

## Block in the palace

![A pale lavender palace band along the horizon with pointed crenellations and a pink upper wall](12-palace-body.webp)

Click `Moon Dots` and add two layers: `Towers`, then `Palace` above it.

1. On `Palace`, marquee a full-width band about 220 px tall sitting on the
   horizon and fill it with `#F3E9FF`.
2. Crenellate the roofline with the **Lasso**: draw one small triangle every
   60 px along the band's top edge. Hold [[Shift]] as you start each triangle
   after the first, so it adds to the selection. Then choose **Edit → Fill**
   once to fill them all.
3. Fill a band about 85 px tall with pink `#FBD0E8`, starting just under the
   top edge. That's the Doge's Palace pink upper wall.

## Cut the arches

![The palace with tall windows, a row of small upper loggia arches and a row of large lower arches in purple](13-palace-arches.webp)

Each arch is a rectangle plus a circle on top, filled with the same colour.
Marquee the rectangle, then switch to the **Elliptical Marquee** and hold
[[Shift]] as you drag the circle, so one fill covers both. You can build a
whole row this way and fill it once:

- **Wall windows:** six tall windows in `#9C7FD6`, each a 40 × 45 rectangle
  under a 40 px circle.
- **Upper loggia:** small arches every 50 px, 26 px wide.
- **Lower arcade:** large 58 px arches every 86 px in deeper `#7E5DC4`.

Finish with a white 8 px cornice along the bottom of the pink wall. Then pick
the **Pencil** ([[N]]) at about **Size** `4` in `#7A4FB0`, click on the
horizon guide at the left edge and [[Cmd+Shift]]-click at the right edge for a
dead-level line. The line gives the palace a clean base.

## Add domes and the campanile

![Three teal onion domes with gold finials on the left and a tall pink bell tower with a teal spire on the right](14-domes-campanile.webp)

On `Towers`, which sits behind the palace:

- **Domes:** three teal `#3FC6C8` domes made from elliptical fills, with a
  small lasso triangle on each for the onion point. Add gold `#FFE08A`
  finials: a short upright Pencil line ([[Shift]]-click from the base to the
  top), topped with a single click of a hard Brush.
- **Campanile:** a pink `#F48CC0` shaft, about 96 px wide, near the right
  edge of the poster, with two darker
  pilaster strips, a lavender belfry with three arches, a lasso-filled teal
  spire, and a gold angel at the tip.

The tower sits far enough right to leave room for the subtitle later.

## Group the skyline

![The Layers panel showing a Venice group containing Palace and Towers, with the whole skyline shifted down during a group move](15-venice-group.webp)

Click `Towers`, [[Shift]]-click `Palace` and choose **Layer → Group Layers**.
Rename the group `Venice`.

To try it out, click the group and drag with the **Move** tool, and the whole
skyline moves together. Press [[Cmd+Z]] to put it back.

## Draw the gondola hull

![A long black crescent gondola hull with a curled stern and a comb-shaped ferro at the bow, drawn on the checkerboard](16-gondola-hull.webp)

Click `Haze` and add a layer named `Boat`. With the **Lasso**, trace a long
crescent that sits low in the middle and rises at both ends, and fill it with
near-black purple `#1B0E3A`. Add:

- a small circle for the stern curl
- a lasso blade for the bow **ferro**, with six short teeth drawn as 6 px
  Pencil lines (click, then [[Shift]]-click)

## Add the gondolier

![A gondolier in a pink and white striped shirt and straw boater standing on the stern, with a gold rail and a pink velvet seat on the hull](17-gondolier.webp)

1. Fill a pink `#FF4FA3` velvet seat in the middle of the boat.
2. Lasso a thin gold `#FFD27A` rail along the gunwale so it overlaps the
   bottom of the seat.
3. Build the gondolier from simple shapes:
   - two dark legs
   - a white torso with 8 px pink stripes every 17 px
   - small lasso arms
   - a round head
   - a straw boater: a gold brim ellipse and crown, with a teal ribbon
4. Press [[Cmd+D]] so no selection is left active.

## Outline it in neon

![The Layer Effects drawer with a cyan outside Stroke and a cyan Outer Glow applied to the gondola](18-neon-stroke-glow.webp)

Open `Boat`'s effects drawer:

- Enable **Stroke** in cyan `#5CF6FF` with **Width** `4`, and click the
  **outside** position.
- Enable **Outer Glow** in the same cyan with **Size** `28` and **Opacity**
  `75`.

The boat now reads like a neon sign against the busy floor.

Under the boat, add a `Gondola Shadow` layer. Set the marquee **Feather** to
`30`, fill a wide ellipse in `#2A1450` and set the layer to **Multiply** at
90 %. Reset Feather to `0`.

## Rock the boat

![A marquee around the gondola with transform handles, rotated three degrees counter-clockwise](19-rotate-gondola.webp)

Click `Boat` and marquee tightly around it, leaving a couple of spare pixels.
Switch to **Move**, then drag just outside the top-right corner handle to
rotate it about 3° counter-clockwise. Press [[Cmd+D]] to commit. The small
tilt makes the gondola look like it's afloat, not parked.

## Give the gondolier an oar

![The gondolier holding a long diagonal oar that dips past the hull into the floor](20-oar.webp)

With no selection active, pick the **Brush** at **Size** `9` and **Hardness**
`100` in the dark purple. Click above the gondolier's hands, then
[[Shift]]-click down past the hull to draw a straight oar.

> **Tip:** An active lasso or marquee clips brush strokes, so a stroke drawn
> right after a lasso fill can seem to vanish. Press [[Cmd+D]] first.

## Pattern-fill striped mooring poles

![A tall teal and white striped mooring pole filled from a stripe pattern at the left edge of the floor](21-pole-pattern.webp)

Venice's striped *pali* poles are just another pattern:

1. On a temporary layer, make a 40 × 40 tile: white on the bottom half, teal
   `#2FB8C0` on the top half. **Define Pattern**, then delete the layer.
2. Add a `Poles` layer. Marquee a 50 px-wide column at the bottom left and
   **Fill with Pattern…** with it.
3. Add two thinner poles on the right at **Scale** `50`, running from just
   above the horizon to about 400 px below it.
4. Cap each pole with a teal ellipse. Put soft feathered Multiply shadows at
   the base of the right-hand poles.

## Lean the foreground pole

![The left mooring pole selected with a marquee and rotated four degrees, with its transform handles visible](22-pole-rotate.webp)

Marquee just the left pole and rotate it about 4° clockwise with the Move
tool's rotate handle. Only the selected pixels turn, so the right-hand poles
stay upright. Press [[Cmd+D]] to commit.

## Set the Shrikhand headline

![Pink Gondola typed in large pink Shrikhand across the top of the sky](23-shrikhand-headline.webp)

Add an empty layer called `Type Anchor`, drag it to the top of the Layers
panel, and click it. New text lands above the active layer, so this puts the
type above everything else.

Pick the **Text** tool, set **Size** to `150`, choose **Shrikhand** in the
font browser and set the colour to `#FF3FA4`. Click near the top-left of the
sky and type `Pink Gondola`. Press [[Tab]] to commit, then centre it with the
Move tool's **Align center horizontally**.

## Style the headline

![The headline with a white outside stroke and a hard purple drop shadow](24-headline-effects.webp)

Open the headline's effects drawer:

- Enable an outside **Stroke** in white with **Width** `6`.
- Enable **Drop Shadow** in `#3A1C71` with **Offset X** and **Offset Y**
  `4`, **Blur** `0` and **Opacity** `100`.

The hard purple shadow stands out against the teal sky. A cyan shadow would
disappear into it.

## Add the full-width subtitle

![VENEZIA · NIGHT CRUISE · 1989 set in white DotGothic16 with a purple stroke, centred under the headline](25-full-width-subtitle.webp)

Vaporwave loves full-width characters. Copy
`ＶＥＮＥＺＩＡ　・　ＮＩＧＨＴ　ＣＲＵＩＳＥ　・　１９８９` to your clipboard.
Click `Type Anchor`, set **Size** `26`, choose **DotGothic16** and white,
click in empty sky, then paste with [[Cmd+V]] and press [[Tab]].

Give it an outside `#3A1C71` **Stroke** of `3`, so the thin letters stay
readable over the scanlines you'll add later. Then drag it with **Move** until
it's centred under the headline, clear of the spire.

## Scatter sparkles

![White four-point sparkles with a soft white glow scattered across the sky](26-sparkles.webp)

Click `Moon Dots` and add a `Sparkles` layer. Lasso a few eight-point
four-pointed stars in white, in a few sizes. Keep them in open sky, away from
the type. Enable **Outer Glow** in white, **Size** `18`, **Opacity** `90`.

## Build a retro dialog window

![A lavender dialog window with bevelled edges, a gradient title bar, minimize, maximize and close buttons, a pink progress bar and an OK button](27-window-frame.webp)

Click `Type Anchor` and add a `Window` layer. Marquee a 520 × 175 box in the
lower right of the poster, starting just left of the centre guide and
finishing about 25 px above the bottom edge. Fill it with lavender
`#DCD3F5`. Fake the bevel with the **Pencil** at **Size** `3` in white:
click the bottom-left corner, then [[Cmd+Shift]]-click the top-left and the
top-right corners. Switch to dark `#4B3A86` and keep going: [[Cmd+Shift]]-click
the bottom-right corner and then the bottom-left. Keep every click a pixel or
two inside the box, so the lines don't hang over its edge.

Then add the details:

- a navy-to-pink gradient title bar
- three small bevelled buttons, with a bar, a box and two crossed Pencil
  lines for the × symbol
- a progress bar with ten pink blocks
- an OK button

## Label the dialog

![gondola.exe in white VT323 in the title bar, a DotGothic16 line reading ゴンドラ Now drifting to 1989 and an OK label on the button](28-window-text.webp)

Click `Window` before you set up each text layer:

- `gondola.exe` in **VT323** 28 white, in the title bar
- `ゴンドラ  Now drifting to 1989...` in **DotGothic16** 26 dark purple
  (paste it)
- `OK` in VT323 on the button

Then click each text layer from the top down and choose **Layer → Merge Down**
until everything is flattened into `Window`.

## Tilt the dialog

![The merged dialog window selected with a marquee and rotated two degrees counter-clockwise](29-rotate-window.webp)

Marquee the window, switch to **Move**, and drag just outside a corner handle
to rotate it about 2° counter-clockwise. A slight tilt
makes it look dropped onto the poster, not printed on it. Press [[Cmd+D]].

## Drop a hard shadow under the dialog

![The tilted dialog with a hard dark purple drop shadow offset down and to the right](30-window-shadow.webp)

Enable **Drop Shadow** on `Window` in `#2A1A5E`, with offset `10`/`10`,
**Blur** `0` and **Opacity** `90`. It's the same flat, hard shadow as the
headline, which ties the two together.

## Add CRT scanlines

![The Pattern Fill dialog previewing thin dark horizontal scanlines across the whole poster](31-scanlines.webp)

Click the headline row and add a `Scanlines` layer on top.

1. Fill an 8 × 2 strip in the top-left corner of the canvas with `#1B0E3A`.
2. Marquee 8 × 6 and **Define Pattern**. The transparent rows are part of the
   tile.
3. Deselect and **Fill with Pattern…** the whole layer.
4. Set the layer to **Multiply** at **14 %**, for a faint old-monitor texture.

## Finish with a vignette

![The Project adjustments drawer with a Vignette node at 35 darkening the corners of the finished poster](32-vignette.webp)

Choose **Layer → Adjustment Layer…** (click **Got it** on the info dialog).
Click **Add Adjustment → Vignette** and set it to `35`. The corners darken
slightly, which pulls the eye into the centre and gives the pastel palette a
little more depth.

Save your project with **File → Save Project**, then **File → Quick Export
PNG** to export your poster.
