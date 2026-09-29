---
title: Design a Cartographic Map Emblem Logo
description: Build an antique sea-chart logo in Lopsy with contour-tinted fjords, waterlines, rhumb lines, a compass rose, a ribbon wordmark and seal text on a path.
published: 2026-09-29 01:30
level: Advanced
duration: 90
tags: logo design, cartographic, map, compass rose, vintage, badge, selections, text on a path, sunburst, branding
related: surrealist-cinema-logo, etching-style-lighthouse-illustration, cyberpunk-neon-dragon-logo
cover: cover.jpg
coverAlt: Lopsy showing the finished Uncharted Fjords emblem, a round antique sea chart with contour-tinted land, teal fjords, a compass rose, a red FJORDS ribbon and arched seal lettering, with the Layers panel on the right
finished: finished-uncharted-fjords-logo.webp
finishedAlt: The finished Uncharted Fjords Expedition Co. logo. It is a cream seal with UNCHARTED arched across the top and EXPEDITION CO. · EST. 1893 along the bottom. Inside a black-and-white degree border is a chart of a rocky coast with stepped tan contour tints, three teal fjords ringed by engraved waterlines, small islands, pale rhumb lines, a compass rose with a red north point, and a dotted red route up a fjord to an X. A red ribbon across the lower third reads FJORDS in old-style capitals.
---

Antique sea charts are full of ready-made graphic devices: rhumb lines fan
out of a compass rose, engraved waterlines ripple round every coast, contour
tints step up into the hills, and a chequered degree border frames it all.
In this tutorial you'll turn those devices into an emblem logo for an
imaginary outfitter, **Uncharted Fjords Expedition Co.**

The chart shows a rocky northern coast cut by three fjords. A dotted
expedition route runs up the longest one to an X. **UNCHARTED** arches over
the top, a red ribbon carries **FJORDS**, and the coordinates sit on the rim.

Almost every shape is a selection that you fill, grow, shrink or invert. The
**Sunburst** filter draws both the degree border and the rhumb lines, and the
Pen tool gives the seal lettering its curves.

The palette:

- Paper `#E9DDC3`, plate cream `#F2E7CB`, ink `#2B2118`
- Sea `#4F8591` → `#3A6B78` → `#1F404A`, waterlines `#CFE0DC`
- Land `#EFE2C0` stepping down to `#AD8E59`, contour ink `#6E5234`
- Ribbon red `#AE3A2E` / `#9A2E26`, route red `#B8322A`

Every face is **IM Fell English SC**, a revival of 17th-century type that
suits old maps. Its figures are old-style and its J drops below the baseline,
and you'll allow for both.

## Create the document and guides

![A blank 1200 by 1200 document with blue guides at x 420 and 600 and y 130, 600 and 1070](01-guides-new-document.webp)

Create a **1200 × 1200** document. Everything is centred on (600, 600), so
click the top ruler at x = `600` and the left ruler at y = `600` to drop a
centre cross. Add horizontal guides at y = `130` and `1070`, the top and
bottom of the emblem, and a vertical guide at x = `420`. That last one marks
the compass rose's centre, which sits at **(420, 624)**.

## Lay down the parchment

![The canvas filled with warm parchment and a faint cloudy mottle at 9% opacity](02-parchment-paper.webp)

Click `Background`, set the foreground to `#E9DDC3` and choose
**Edit → Fill**. Rename `Layer 1` to `Paper Mottle` and run
**Filter → Clouds…** at **Scale** `14`. Open its effects drawer, set the
blend mode to **Multiply**, and drop the layer to `9%` opacity. The result
is a quiet mottle, not a cloudy sky.

## Make the plate and its double rule

![A 940 px dark disc selected with marching ants over the parchment, with guides crossing its centre](03-plate-double-rule.webp)

Add a layer named `Plate`. With the **Elliptical Marquee**, drag from
(130, 130) to (1070, 1070) for a 470 px radius disc. Fill it with `#F2E7CB`.

Now build a double rule:

1. Choose **Select → Shrink…** `8` and fill with the ink `#2B2118`.
2. Choose **Select → Shrink…** `2` and fill with the cream again.

That leaves a 2 px ink ring 8 px inside the rim. Press [[Cmd+D]].

In the effects drawer, add these effects:

- **Stroke** `3` px in ink.
- **Inner Glow**, Size `46`, Opacity `45`, `#9C7A45`, for an aged rim.
- **Drop Shadow** with Offset Y `10`, Blur `26`, Opacity `45`, `#3A2A14`.

Click **Rasterize Layer Style** so the effects become pixels. Baked effects
keep a big document fast.

## Draw the degree bars with Sunburst

![The Sunburst filter drawing 72 cream wedges over a dark ink disc inside the plate](04-sunburst-degree-bars.webp)

Add a layer named `Neatline`. Select a disc from (212, 212) to (988, 988)
(radius 388) and fill it with ink. Set the foreground to the plate cream.

Choose **Filter → Sunburst…** with these settings, then click **Apply**:

- **Rays** `72`, **Width** `50`, **Taper** `0`
- **Center X** `50`, **Center Y** `50`

Half of every slot turns cream, so you get alternating wedges.

## Hollow out the neatline

![A thin chequered black and cream ring inside the plate, the classic degree border of a sea chart](05-chart-neatline.webp)

Select the radius 380 disc, from (220, 220) to (980, 980), and press
[[Delete]]. Only an 8 px band of alternating bars is left, like the degree
border of an old chart. Deselect, add a `2` px ink **Stroke**, and rasterize
the layer style.

## Fill the sea

![The inside of the neatline filled with a teal radial gradient that is lightest near the compass position](06-sea-radial-gradient.webp)

Add a layer named `Sea` and select the radius 380 disc again. Pick the
**Gradient** tool, set it to **Radial**, and open **Advanced…**. Set three
stops:

- `#4F8591` at 0%
- `#3A6B78` at 60%
- `#1F404A` at 100%

Drag from the compass centre (420, 624) to (980, 624), so the water is
lightest where the rose will sit. Deselect. Add an **Inner Glow** of Size
`40`, Opacity `55` in `#12272D` to darken the edge, then rasterize.

## Fan out the rhumb lines

![Thirty-two thin pale gold lines radiating from the compass point across the sea](07-rhumb-lines-sunburst.webp)

Add `Rhumb Lines`. Select a radius 378 disc so the lines stop at the border,
and set the foreground to `#D9BE84`. Run **Sunburst** again with these
settings:

- **Rays** `32`, **Width** `5`, **Taper** `50`
- **Center X** `35`, **Center Y** `52`

Taper 50 gives parallel-sided lines instead of wedges. The centre is 35% and
52% of 1200 px, which is exactly (420, 624). Deselect and set the layer to
`32%` opacity.

## Lasso the coastline

![A long ragged Lasso selection running diagonally from the upper left to the lower right of the canvas](08-coastline-lasso.webp)

Add a layer named `Land`. With the **Lasso**, draw a rocky coast that enters
at the left edge around y = 250. Pass through roughly these points, then close
the selection round the top-right corner, outside the canvas:

(250, 318), (425, 408), (552, 560), (700, 702), (885, 800), (1200, 905)

Keep the line nervous and jagged. Real coasts double back on themselves.

Choose **Select → Feather…** `1` to soften the stair-steps, then fill with
`#EFE2C0`.

## Cut the fjords

![A narrow tapering Lasso selection snaking from the coast up into the land, with the first fjord already cut](09-fjord-lasso.webp)

Fjords are long, narrow channels that get thinner toward their heads. For
each one, lasso a wiggling channel about 30–40 px wide at the mouth and
8 px wide at the head. Feather it by `1`, then press [[Delete]].

1. A short one from (272, 368) up to (452, 250).
2. The main fjord, from (508, 540) through (604, 440) and (690, 372) to its
   head at (792, 318).
3. One from (722, 752) through (842, 676) to (928, 596).

## Copy, rotate and scale the skerries

![A small island being rotated with the Move tool's rotation handle, with the marching ants turning with it](10-skerry-copy-rotate.webp)

Lasso a small ragged island, about 52 × 30 px, at (300, 470) on `Land` and
fill it. To make an archipelago:

1. Marquee the island and press [[Cmd+C]], then [[Cmd+V]]. The copy is
   pasted in place.
2. Drag the copy with the Move tool.
3. [[Cmd]]-click its thumbnail to select it, then turn it with a corner
   rotation handle and resize it with [[Cmd]] held on a corner scale handle.

Make three copies:

- 60° at 70% scale, at (252, 566)
- −35° at 125% scale, at (612, 752)
- 25° at 75% scale, at (668, 938)

Try [[Cmd+Z]] three times and [[Cmd+Shift+Z]] three times on the last one.
The skerry steps back through scale, rotate and move, then returns exactly.
Finally, **Layer → Merge Down** each copy into `Land`.

## Step the contours inland

![The coast selection shrunk inland, with marching ants tracing a line parallel to the shore](11-contour-shrink-selection.webp)

Contour tints (hypsometric tints) colour land by height. Here each band is
simply the coast pushed further inland.

First give `Land` a `2` px ink **Stroke** for the coastline and rasterize it.
Then repeat these steps for each band:

1. [[Cmd]]-click the previous layer's thumbnail.
2. Choose **Select → Shrink…** by the amount below.
3. Add a layer named `Contour 1`, `Contour 2` and so on.
4. Fill it, then give it a `1` px `#6E5234` **Stroke** and rasterize.

- `Contour 1`: Shrink `12`, fill `#E7D6AB`
- `Contour 2`: Shrink `14`, fill `#DDC895`
- `Contour 3`: Shrink `18`, fill `#D0B780`
- `Contour 4`: Shrink `24`, fill `#C1A36B`
- `Contour 5`: Shrink `30`, fill `#AD8E59`

## See the hills appear

![The land stepped in five increasingly dark tan bands, each edged with a thin brown contour line](12-hypsometric-contours.webp)

Because each band shrinks from the one before, the bands follow every
headland and fjord. The stroke on each band reads as an engraved contour line.

## Engrave the waterlines

![The coast grown 29 px out to sea, with marching ants following the shore at that distance](13-waterlines-grow-selection.webp)

Click `Rhumb Lines` and add `Shallows`. [[Cmd]]-click `Land`, choose
**Select → Grow…** `12` and fill with `#5A8E98`.

Add `Waterlines`. Each ring is made in two moves: grow and fill, then grow
2 px less and delete. Work from the outermost ring inward, because each
Delete clears everything nearer the coast.

1. Grow `46`, fill `#6E989F`
2. Grow `31`, fill `#8AAEB2`
3. Grow `19`, fill `#A9C6C6`
4. Grow `6`, fill `#CFE0DC`

Set the layer to `75%` opacity.

> **Tip:** Load the coast from `Land`'s own row: click `Land`, [[Cmd]]-click
> its thumbnail, then click back on `Waterlines` before you Grow. If you
> [[Cmd]]-click the thumbnail while `Waterlines` is active, [[Delete]] can
> wipe the whole layer instead of the grown area.

## Clip everything to the sea disc

![An inverted selection covering everything outside the chart circle, ready to trim the land and waterlines](14-clip-inverse-selection.webp)

The land and rings run far past the chart. Select the radius 380 disc and
choose **Select → Inverse**. Then click each of these layers and press
[[Delete]]:

- `Shallows`
- `Waterlines`
- `Land`
- `Contour 1` to `Contour 5`

Deselect.

## Draw a conic graticule

![Thin blue-grey meridians converging upward and gently curved parallels crossing both land and sea](15-conic-graticule.webp)

Old charts often use a conic projection. The meridians lean toward a pole
off the top of the map, and the parallels curve around it.

Add `Graticule` above `Contour 5` and select a radius 379 disc. Set the
**Brush** to Size `2`, Hardness `100`, Spacing `10`, colour `#9DB0B6`.

- **Meridians:** click at y = 200, then [[Shift]]-click at y = 1000. Each
  line points at (600, −1900) and crosses y = 600 at x = 300, 400 … 900.
- **Parallels:** draw them every 100 px with [[Shift]]-click chains that
  follow circles round the same point.

Set the layer to `55%` opacity.

## Build the compass degree ring

![A small chequered ring with a hairline inside it, centred on the rhumb lines' focal point](16-compass-degree-ring.webp)

Add `Rose Ring` and select a radius 84 disc on (420, 624). Fill it with
`#1E1812`.

Run **Sunburst** with **Rays** `64`, **Width** `50`, **Taper** `0`, and
**Center** `35` / `52`. Delete a radius 78 disc to leave the ticks.

For a hairline inside the ticks, select a radius 73 disc and fill it cream.
Then choose **Shrink** `2` and delete.

## Draw the cardinal star

![A four-pointed star with each point split into a cream half and a black half](17-cardinal-star.webp)

Add `Rose Cardinal`. Each point is two thin triangles, lassoed and filled:

- **Light half:** centre, tip, and a shoulder 16 px out at 45° on the left.
  Fill it cream.
- **Dark half:** the same on the right. Fill it `#1E1812`.

Make the points 104 px long, pointing north, east, south and west. The split
shading makes the star look faceted.

## Rotate a copy for the intercardinals

![The Move tool rotating a copy of the star with the marching ants turned 45 degrees](18-rotate-intercardinal.webp)

Marquee the star, press [[Cmd+C]] and [[Cmd+V]], and name the pasted copy
`Rose Cardinal` (it lands on top). Rename the original underneath
`Rose Intercardinal`.

[[Cmd]]-click its thumbnail, pick the **Move** tool, and drag a corner
rotation handle with [[Cmd]] held. [[Cmd]] snaps rotation to 15° steps, so
stop at exactly **45°**.

## Scale the intercardinals to 60%

![The rotated star being scaled down from a corner handle, now peeking between the main points](19-scale-intercardinal.webp)

Deselect and [[Cmd]]-click the thumbnail again. Hold [[Cmd]] and drag a
corner scale handle inward until the star is **60%** of its size. Nudge it
back onto (420, 624) with the arrow keys.

Select the top `Rose Cardinal` and give it effects:

- **Stroke** `1` px in cream.
- **Drop Shadow** with Offset `3`, `4`, Blur `6`, Opacity `60`, `#050D14`.

Rasterize the layer style.

## Add the red north point and hub

![The finished compass rose: a red north point, a cream-ringed hub and a serif N above the star](20-north-point-hub.webp)

Add `Rose North` and refill the north point's two halves in `#C8503E` and
`#7A2118`.

Build the hub from a radius 9 disc:

1. Fill it with `#1E1812`.
2. **Shrink** `2` and fill with cream.
3. **Shrink** `4` and fill with red.

Finally, set an **N** in IM Fell English SC at `34` px in `#F4E9CE`. Nudge
it so it's centred 22 px above the north tip.

## Group the rose and test a snapped move

![The Compass Rose group being dragged across the sea with a 16 px grid showing and Snap on](21-group-snap-drag.webp)

Click `Rose Ring`, [[Shift]]-click `Rose N`, and choose
**Layer → Group Layers**. Rename the group `Compass Rose`.

Turn on **View → Show Grid** and **View → Snap to Grid**. With the group
active, drag it with the Move tool. Every piece travels together and snaps to
the grid. Press [[Cmd+Z]] to put it back, because the rhumb lines are centred
on the original spot. [[Cmd+Shift+Z]] and [[Cmd+Z]] again check that the
move redoes and undoes cleanly. Turn the grid and snapping off.

## Plot the route and the summit

![A dotted red route running up the main fjord to a red X, and a black summit triangle labelled Skårtind 1834 m](22-route-summit.webp)

Add `Route` above `Graticule`. Set the **Brush** to Size `6`, Hardness
`100`, Spacing `200`. At 200% spacing every dab stands alone, so the stroke
becomes a dotted line.

In `#B8322A`, click (706, 790) and [[Shift]]-click your way through the sea,
past the compass, and up the fjord's centre to (772, 320).

Set Spacing back to `10` and draw a 30 px **X** centred on (792, 318). Give
the layer a `2` px cream **Stroke** so the dots read against the water, then
rasterize.

Add `Summit` and fill a 24 px triangle at (818, 470) with `#1E1812`. Under
it, set `Skårtind 1834 m` in IM Fell English SC at `18` px.

## Build the ribbon

![A cream inner rule marquee inside a red ribbon band, with folded tails behind both ends](23-ribbon-inner-rule.webp)

Click `Summit Label` so the new layers stay outside the Compass Rose group.

1. Add `Ribbon Tails` and lasso two swallow-tailed ends. Each one sits
   26 px lower than the band and reaches 84 px past it. Fill them `#6E1F1A`.
2. Fill the small fold triangles `#4A150F`.
3. Add a `3` px ink **Stroke** and rasterize.

Add `Ribbon` and marquee the band from (196, 782) to (1004, 898). Fill it
with a near-flat vertical gradient from `#AE3A2E` to `#9A2E26`.

For the inner rule:

1. **Shrink** `7` and fill cream.
2. **Shrink** `2` and repaint the gradient, leaving a hairline rule.

Add a `3` px ink **Stroke** and a soft **Drop Shadow**, then rasterize.

## Set and recolour the wordmark

![FJORDS highlighted with Select All in the text editor, ready to be recoloured](24-wordmark-recolor.webp)

With the **Text** tool at `64` px, IM Fell English SC and `#1E1812`, click
an empty corner of the canvas and type `FJORDS`. Press [[Tab]].

In the **Text** panel, set **Letter spacing** to `26`. Click into the word
again, press [[Cmd+A]], and change the colour to `#F6ECD2`. The selected
text updates as you pick. Press [[Tab]].

## Seat the wordmark in the ribbon

![FJORDS in cream capitals centred in the red ribbon, with the J descender clear of the inner rule](25-wordmark-seated.webp)

Centre the word on the **capitals**, not on its bounding box. The J hangs
about 0.28 em below the baseline, so a box-centred word would ride high.

Move it so the caps sit halfway between the inner rules, at y ≈ 840. The J
then clears the bottom rule by about 8 px, with about 25 px above and below
the caps. Add a crisp **Drop Shadow**: Offset `2`, `3`, Blur `0`, Opacity
`70`, `#3D0F0A`.

## Arch UNCHARTED over the top

![UNCHARTED set in IM Fell capitals along a blue Pen path that arcs over the chart, centred on the emblem](26-uncharted-on-path.webp)

Click `Plate` and set `UNCHARTED` at `54` px, letter spacing `16`, in
`#1E1812`. Press [[Tab]].

Pick the **Pen** tool. Text on a path starts at the path's first anchor, so
the first anchor sets where the word begins. Press at each anchor below and
drag to the handle point to pull out a smooth curve. Together they trace a
405 px circle round (600, 600):

1. (367, 269) → (407, 241)
2. (499, 208) → (546, 196)
3. (643, 197) → (691, 202)
4. (782, 238) → (825, 260)
5. (898, 325) → (931, 361)

Click ✓ **Commit path**. Select the `UNCHARTED` layer with the Text tool and
pick the path in the options bar's **Path** dropdown. The caps now sit
midway between the neatline and the plate's inner rule.

If the word lands a little off centre, deselect the path in the **Paths**
panel and draw a fresh arc a degree or two earlier or later. With the old
path selected, Pen clicks edit it instead of starting a new one.

## Set the bottom seal line

![EXPEDITION CO. · EST. 1893 curving along the bottom of the seal, reading left to right with its letters facing inward](27-bottom-seal-line.webp)

Set `EXPEDITION CO. · EST. 1893` at `25` px with letter spacing `5`. For
text along the bottom, the path must run **left to right**, so its letters
face inward and read the right way up. Its radius is 437 px, so the caps
fill the same band as UNCHARTED:

1. (380, 978) → (419, 1000)
2. (506, 1027) → (550, 1036)
3. (640, 1035) → (685, 1031)
4. (771, 1002) → (812, 985)
5. (885, 931) → (919, 902)

Commit the path and bind the text to it.

## Turn the coordinates upright

![A small latitude label selected and rotated a quarter turn with Rotate 90° CCW in the Move options bar](28-rotate-coordinates.webp)

Set `69°38'N` and `18°57'E` at `24` px with letter spacing `2`. IM Fell has
no prime sign, so use a straight apostrophe.

- **Latitude:** [[Cmd]]-click the label's thumbnail, pick the **Move** tool
  and click **Rotate 90° CCW** in the options bar. It now reads upward.
- **Longitude:** turn it the other way by dragging a rotation handle with
  [[Cmd]] held, which snaps it to exactly 90°.

Centre each label in the rim band, at (175, 600) and (1025, 600).

## Finish with shading and grain

![The finished emblem with a grain layer set to Overlay at 28% opacity in the Layers panel](29-grain-finishing.webp)

Select `Ribbon`, pick **Dodge/Burn** in **Burn** mode, and set Exposure `14`
and Size `18`. Click at (210, 885) and [[Shift]]-click at (990, 885) to shade
the foot of the ribbon.

Click `FJORDS` and add `Grain`. Fill it with `#808080`, then run
**Filter → Add Noise…** with **Mono**, **Gaussian** and Amount `24`. Set the
layer to **Overlay** at `28%`. The grain gives the flat fills a printed,
paper-like tooth.

## Export the logo

![The finished Uncharted Fjords emblem in Lopsy with guides hidden and the Move tool active](30-finished-in-editor.webp)

Turn off **View → Show Guides** and check the whole emblem. Choose
**File → Quick Export PNG** for the artwork.

A mark this detailed is for print, signage and hero use. For favicons and
social avatars, save a simplified version: hide the graticule, waterlines and
coordinates, and keep the compass rose and red X on the cream disc.
