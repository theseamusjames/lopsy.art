---
title: Make an 8-Bit Pixel Art Album Cover with Goblin Sprites
description: Design a chiptune album cover as an NES title screen in Lopsy, with Pencil sprites on a 16 px grid, a brick pattern, palette swaps and a banded pixel logo.
published: 2026-10-29 09:00
updated: 2026-10-29
level: Advanced
duration: 180
tags: pixel art, 8-bit, album cover, chiptune, retro game, sprites, pencil, symmetry, pattern fill, magic wand, typography, blend modes, scanlines
related: 8-bit-pixel-art-data-visualization-poster, ascii-art-dot-matrix-diner-menu, vaporwave-sunset-billboard
cover: cover.jpg
coverAlt: Lopsy with the finished Goblin Quartet album cover on the canvas, the Move tool active and the Layers panel showing Side A, Side B, Glow, Scanlines, Menu Box and the collapsed Logo and Band groups
finished: finished-goblin-quartet.webp
finishedAlt: The finished Goblin Quartet album cover in 8-bit pixel art. On a starry night sky, the word GOBLIN is set in big blocky letters striped yellow to red, over QUARTET striped white to blue, both with black outlines and a purple drop shadow, above the line DUNGEON SESSIONS. Below is a purple brick castle wall with battlements, an arched window showing a yellow moon over banded purple sky, and two wall torches with warm light around them. Four pixel goblins stand on a wooden stage. A green bard in a red feathered cap plays a lute, an ochre goblin plays a red drum, a teal goblin plays a golden horn and a lime goblin in a gold crown plays a red accordion. At the bottom, a black game menu box with a white border reads SIDE A and SIDE B, with a cursor arrow pointing at SIDE A
project: 8-bit-goblin-band-album-cover.lopsy
---

Chiptune bands make music on old game consoles, so their album covers often
borrow the look of the games: a big striped logo, a little scene of sprites
and a menu waiting for you to press Start. In this tutorial you'll make the
cover for **Goblin Quartet: Dungeon Sessions** as if it were the title screen
of a forgotten 1987 cartridge.

The canvas is 2048 × 2048 px, but you'll treat it as a 128 × 128 screen. Every
"pixel" of the art is a 16 × 16 px cell. The grid shows the cells, and the
Pencil at 16 px paints one cell per click when you click in the middle of
one. Lines are a click and a [[Shift]]-click, as usual. You'll build the wall from one
brick tile and a pattern fill. You'll paint one goblin with mirror symmetry
and turn it into a band of four with duplicates and Magic Wand palette swaps.
Then you'll set the logo in a pixel font and give it NES-style colour bands,
an outline and a drop shadow.

Nothing in this picture is rotated or scaled. Free rotation and scaling
resample pixel art and blur its edges, so everything is placed with
whole-cell moves and nudges, and recoloured with colour swaps.

The palette:

- Night sky `#0C0820`, stars `#BCD8FC` / `#FCFCFC`
- Bricks `#1E1446` / `#34247A` / `#5040A8`
- Battlements `#241860` / `#4A3A9A` / `#6A5AC0` / `#8C7CE4`
- Window frame `#7464D0` / `#1E1446`, sill `#9C90E0`
- Window sky `#120A3C` / `#2A1878` / `#5030A8` / `#9048B8`
- Moon `#FCFCA0` / `#F8D840` / `#C89818`
- Torch iron `#141018` / `#5C5C70`, flame `#F83800` / `#FC9838` / `#FCE4A0`
- Torch light `#B0507C` / `#F08830` (Color layer)
- Torch warmth `#3C2C48` / `#784020` (Screen layer)
- Stage `#A8641C`, lip `#E8A848`, seams `#6C3C10`, front edge `#3C1C08`
- Goblin skin `#00702A` / `#28B830` / `#8CE868`, outline `#000000`, eyes `#F8E070`, tongue `#D82800`
- Goblin tunic `#5C2C00` / `#9C4A00` / `#D07818`, buckle `#F8B800`
- GOBLIN stripes `#FCF0A0` / `#F8D000` / `#F89C00` / `#F05800` / `#C82800`
- QUARTET stripes `#FCFCFC` / `#A8E4FC` / `#3CBCFC` / `#0078F8` / `#0050C0` / `#003494`
- Logo shadow `#5A30B0`, subtitle `#E0D8FC`
- Wall shade `#FFFFFF` / `#C8C0E8` / `#9888C8` (Multiply)

## Set up a 16 px grid and guides

![A 2048 by 2048 canvas filled with near-black navy, covered by a fine 16 px grid, with a vertical guide down the middle and horizontal guides about two-fifths and four-fifths of the way down](01-grid-guides.webp)

Choose **File → New**, make a **2048 × 2048** document and click **Create**.
Select the **Background** layer, set the colour to `#0C0820` in the Color
panel and choose **Edit → Fill**. Rename **Layer 1** to **Stars**.

Turn on **View → Show Grid**. In the options bar, drag the **Grid** slider to
**16px** and make sure **Snap** is ticked. Marquees and Move drags now land
on whole cells.

Hold [[Cmd]] and click the middle of the top ruler. Cmd-clicking a ruler
snaps the guide to a layout fraction, so this one lands exactly on the centre
line at 1024. Then add two horizontal guides on the left ruler, at **832**
(the top of the castle wall) and **1648** (the top of the stage). Guides beat
the grid when a marquee snaps, so they must be exact. Zoom to 100%, and watch
the Y readout in the status bar until it shows 832 (then 1648) before you
click.

> **Tip:** The Pencil doesn't snap to the grid. Its square is centred on
> the pixel under the pointer, so aim for the middle of a cell. Zoom to
> 400% or more for sprite work. Each cell is then 64 screen pixels wide,
> and a click near its centre is easy. The X/Y readout should end in 8
> after a multiple of 16, such as 856 or 1224.

## Scatter pixel stars

![The navy sky dotted with single light-blue pixel stars and a few white plus-shaped twinkles around the edges of the canvas](02-stars.webp)

Pick the **Pencil** (N) and set its **Size** to **16** in the options bar.
The Pencil paints hard square dabs, so one click in the middle of a cell
fills that cell. On the **Stars**
layer, click single stars in `#BCD8FC` along the very top of the canvas and
down both sides. Keep the middle of the top half empty, because the title
goes there.

For a twinkle, switch to `#FCFCFC`, click a cell, then click the cells
directly above, below, left and right of it to make a small plus. Make
three: one near the top-left corner, one near the top-right corner and one a
little lower on the left.

> **Tip:** Keep every star at least two cells away from where the lettering
> will be. A dot next to a letter reads as part of the letter.

## Copy a cluster of stars to the other side

![A marquee around the lower-left stars was copied, pasted and dragged to the right edge, so a matching cluster now sits on the right with the new Stars Copy layer selected](03-stars-copied.webp)

Pick the **Rectangular Marquee** (M) and drag a box around the stars in the
lower-left corner of the sky: the left 18 cells, from y 384 down to the top
of the wall area at 768. Press [[Cmd+C]], then [[Cmd+V]]. The paste lands in place on a
new layer. Rename it **Stars Copy** and press [[Cmd+D]].

Switch to the **Move** tool (V) and drag the copy to the right until it sits
against the right edge (1760 px across, at the same height). Snap keeps it
on the grid. Choose **Layer → Merge Down** to fold it back into **Stars**.

## Paint one brick tile

![A small brick tile in the top-left corner of the canvas: two courses of purple bricks with light top and left edges, dark bottom edges and dark mortar](04-brick-tile.webp)

Add a layer called **Brick Tile**. Old consoles drew backgrounds from small
tiles, and you'll do the same.

With the Rectangular Marquee, drag a box in the top-left corner from 0, 0 to
256, 128. That's 16 × 8 cells. Fill it with `#0C0820` for the mortar and
deselect.

With the Pencil, paint two courses of bricks:

- Each brick is 7 cells wide and 3 cells tall, with a 1-cell mortar gap on
  its right and below it.
- The top course starts at the left edge.
- The bottom course is offset 4 cells to the right, and wraps round the
  tile's edge.
- Fill each brick with `#34247A`.
- Paint its top row, except the last cell, in `#5040A8` for the lit edge.
- Paint its bottom row, except the first cell, and the last cell of its
  middle row in `#1E1446` for the shadow.

## Define the tile as a pattern

![The finished brick tile with a marquee exactly around it, ready for Define Pattern](05-tile-marquee.webp)

Drag the marquee from 0, 0 to 256, 128 again so it hugs the tile, and choose
**Edit → Define Pattern**. Press [[Cmd+D]], then delete the **Brick Tile**
layer with the trash button at the bottom of the Layers panel. The pattern is
kept.

## Fill the wall with the brick pattern

![The Pattern Fill dialog showing the brick tile selected, with a marquee across the canvas between the two horizontal guides](06-pattern-fill.webp)

Select **Stars** and add a layer called **Wall**. Drag a marquee from the
left edge at the 832 guide to the right edge at the 1648 guide.

Choose **Edit → Fill with Pattern…**, click the brick tile and leave Scale at
100 and every offset at 0. Click **Apply** and deselect. The pattern is
lined up with the document's top-left corner, and 832 is a multiple of one
brick course (64 px), so the wall starts cleanly on a mortar line.

## Add battlements

![A pale purple ledge runs along the top of the brick wall, with sixteen stubby merlons standing on it against the night sky](07-battlements.webp)

Add a layer called **Battlements**. With the Pencil:

1. In `#6A5AC0`, click the left end of the top row of the wall (y 832) and
   [[Shift]]-click the right end. That's the coping ledge.
2. On the two rows above the ledge, paint 16 merlons, each 4 cells wide with
   a 4-cell gap. Start the first one 2 cells in from the left edge.
   - Each merlon's top row is `#8C7CE4`.
   - Its bottom row is `#4A3A9A`.
   - The right-hand cell of the bottom row is `#241860`.

The light top and shaded side make the merlons read as solid stone, not as
one more course of bricks.

## Draw the window frame

![A stepped arched window frame in light and dark purple in the middle of the wall, with a light sill underneath](08-window-frame.webp)

Add a layer called **Window Frame**. The window opening is 36 cells wide,
from x 736 to 1312, centred on the middle guide. Its round top peaks at
y 880 and its sides are straight from y 960 down to y 1136.

Every arch is painted as rows centred on the middle guide, one
[[Shift]]-click run per row. Work from the top down.

1. The outer frame, in `#7464D0`, starts two cells above the opening, at
   y 848. Its rows are 14, 22, 28, 32, 34, 36 and 38 cells wide, then 40
   cells on every row from y 960 down to y 1136.
2. The dark rim, in `#1E1446`, goes over it, starting one cell lower at
   y 864. Its rows are 14, 22, 28, 32, 34 and 36 cells wide, then 38 from
   y 960 down.

That leaves a light outer frame and a dark inner rim.

For the sill, paint a `#9C90E0` row from x 688 to 1360 along the bottom of
the window (y 1136), then a `#1E1446` row under it.

## Fill the window with flat sky bands

![The window opening filled with four flat horizontal bands from deep navy at the top to violet at the bottom, with the selection still active](09-sky-gradient.webp)

Add a layer called **Sky** and paint the opening itself in white with
Pencil runs. It starts at y 880, and its rows are 14, 22, 28, 32 and 34
cells wide, then 36 from y 960 to the sill. [[Cmd]]-click the **Sky** thumbnail to select the opening.

Pick the **Gradient** tool from the toolbox, keep **Linear**, and open
**Advanced…**. Click the bar to add a stop, drag it while the readout
shows its position, and type its colour in the **Hex** field. Pair the
stops two percent apart, so the gradient comes out as four nearly flat
bands, the way an NES sky is banded:

- `#120A3C` at 0% and 37%
- `#2A1878` at 39% and 61%
- `#5030A8` at 63% and 80%
- `#9048B8` at 82% and 100%

Click **Done**, then drag straight down from the top of the window to the
bottom.

## Snap the sky bands to the pixel grid

![The window sky after Pixelate: each band edge is now a clean step on the 16 px grid](10-sky-pixelated.webp)

Press [[Cmd+D]]. Choose **Filter → Pixelate…**, set **Block Size** to **16**
and click **Apply**. Each block becomes one flat cell. Where a soft band
edge fell inside a cell, it becomes a single in-between row, like the
stepped colour ramps in old game skies. The sky now sits on the same grid
as everything else.

## Paint the moon

![A round yellow pixel moon in the upper right of the window, lit from the top left, with a few white stars around it](11-moon.webp)

Add a layer called **Moon**. In the right half of the window, paint an
11-cell-wide round moon centred around x 1144, y 984:

- Rows of 3, 7, 9, 9, 11, 11, 11, 9, 9, 7 and 3 cells, from top to bottom.
- `#FCFCA0` on the upper-left side.
- `#F8D840` through the middle.
- `#C89818` on the lower-right rim.

Click eight single white stars around the moon, keeping them inside the
window.

## Hang two torches

![Two pixel torches on the wall, one either side of the window, each a dark iron bracket under a red, orange and cream flame](12-torches.webp)

Add a layer called **Torches**. On each side of the window, centred on
x 384 and x 1664, paint an iron bracket 7 rows tall, starting at y 1008.
From the top, its rows are 4, 6, 4, 2, 2, 4 and 2 cells wide. That's a cup
on a narrow stem with a small foot. Use `#5C5C70` with `#141018` for the
shadowed cells.

Add a layer called **Flames**. Just above each bracket, starting at y 896,
paint a flame 7 rows tall. Its rows are 1, 3, 4, 6, 7, 7 and 5 cells wide,
leaning slightly to the left. It's red `#F83800` on the outside, orange
`#FC9838` inside, and a `#FCE4A0` core with one `#FCFCA0` hot cell near the
bottom.

## Paint stepped light pools

![Two stepped discs around the torches, an outer pink ring and an inner orange disc, painted flat over the bricks](13-light-discs.webp)

Select **Battlements** and add a layer called **Torch Light**. It lands just
above Battlements.

With the Pencil, paint a stepped disc in `#B0507C` around each torch,
centred on x 384 and x 1664. Start at y 864, one cell below the ledge,
with rows 10, 12, 14, 14, 16, 16, 16, 16, 16, 14, 14, 12, 10 and 8 cells
wide.

Then paint a smaller `#F08830` disc on the same centres, starting at y 896,
with rows 6, 8, 10, 10, 10, 10, 10, 8 and 6 cells wide.

## Recolour the bricks with the Color blend mode

![The light discs now recolour the bricks: the outer ring shows dusky mauve bricks and the inner disc shows dark orange-brown bricks, with the brick pattern still visible](14-light-color-blend.webp)

Open the **Torch Light** layer's effects button and set the **Blend** to
**Color**. A Color layer keeps the brightness of the bricks underneath and
only changes their hue. The bricks inside the rings turn warm, but every
mortar line and highlight stays.

## Brighten the light with a Screen copy

![The torch light pools are now brighter: warm orange bricks around each flame fading to mauve bricks at the edge](15-light-screen.webp)

The Color layer recoloured the bricks but left them as dark as before, so
they look scorched rather than lit. Choose **Layer → Duplicate Layer**,
click the copy's row in the Layers panel, and rename it **Torch Warmth**.

Pick the **Magic Wand** (W), set **Tolerance** to **0** and untick
**Contiguous**. On **Torch Warmth**:

1. Click a pink cell. Both outer rings are selected. Fill them with
   `#3C2C48`.
2. Click an orange cell and fill both inner discs with `#784020`.

Deselect, and set this layer's blend mode to **Screen**. Screen only ever
lightens, so the bricks inside the rings brighten by steps.

## Give the flames a glow

![Both flames now have a soft orange outer glow spilling onto the bricks around them](16-flame-glow.webp)

Select **Flames**, open its effects and turn on **Outer Glow**: colour
`#FC7820`, **Size** 40, **Opacity** 70. This is the only soft effect in the
scene, so keep it on the flames themselves.

## Lay the wooden stage

![A wooden stage across the full width of the canvas below the wall, with a light lip, a dark seam between two planks, plank joints and a few nail heads](17-stage.webp)

Select **Flames** and add a layer called **Stage**. With the Rectangular
Marquee, drag from the left edge at the 1648 guide down eight cells to
y 1776, across the full width. Fill it with `#A8641C` and deselect.

With the Pencil, draw three full-width lines. Click a cell at the left edge
and [[Shift]]-click the same row at the right edge:

- The lip on the top row (y 1648) in `#E8A848`.
- A seam between the planks on the fifth row (y 1712) in `#6C3C10`.
- The front edge on the bottom row (y 1760) in `#3C1C08`.

Add short vertical plank joints in `#6C3C10`, three cells tall in the top
plank and two in the bottom one, staggered. Click a few `#E8A848` nail heads
near the joints.

## Plan the goblin sprite

![A pattern chart of the goblin sprite on a grid: the left half in full colour and the right half dimmed, with a red line down the centre marking the mirror axis](18-goblin-chart.webp)

This chart is the goblin, cell for cell. It's 22 cells wide and 27 tall, and
it's symmetrical, so you only need to paint the left half. The dimmed right
half is what the mirror will paint for you.

From the top down:

- **Head:** a tuft and the ears in three greens.
- **Face:** an angry brow, yellow `#F8E070` eyes with black pupils, a long
  nose and a black grin with a white fang and a red `#D82800` tongue at the
  centre.
- **Body:** a brown tunic with a gold `#F8B800` belt buckle, then two thin
  legs and feet.

Every shape has a one-cell black outline.

## Paint half a goblin with symmetry

![The Pencil's Symmetry Vertical button is on, and the goblin's green head and yellow eyes are painted on both sides of the centre guide at once](19-symmetry-half.webp)

Select **Stage** and click **New Group** at the bottom of the Layers panel.
Name the group **Band**. With **Band** selected, click **Add Layer**. The new
layer goes inside the group. Name it **Goblin 1**.

Pick the Pencil and turn on **Symmetry Vertical** in the options bar. Every
dab is now mirrored across the centre line of the canvas, your guide at
1024.

Paint the left half of the chart. Paint each colour run with a click and a
[[Shift]]-click. The sprite's left edge is at x 848 and its top at y 1216,
so its feet land on the stage lip. Start with the greens and the eyes. The
right half appears as you go.

## Finish the first goblin

![One complete goblin standing on the stage in the centre: green skin, yellow eyes, a fanged grin, a brown tunic with a gold buckle, and a black outline all round](20-goblin-body.webp)

Work through the remaining colours: eyes, teeth, tongue, tunic and buckle.
Do the black outline last. Then turn **Symmetry Vertical** off again.

## Duplicate the goblin into a quartet

![Four identical goblins spaced evenly across the stage, each standing on the stage lip](21-four-goblins.webp)

Choose **Layer → Duplicate Layer** three times. After each duplicate, click
the copy's row so the copy is the active layer. Name the copies **Goblin 2**,
**Goblin 3** and **Goblin 4**.

With the **Move** tool and Snap on, drag each goblin sideways to its spot.
Keep each one at the same height:

- **Goblin 1** goes 768 px left, so its left edge is at x 80.
- **Goblin 2** goes 256 px left, to x 592.
- **Goblin 3** goes 256 px right, to x 1104.
- **Goblin 4** goes 768 px right, to x 1616.

## Palette-swap the goblins

![The first two goblins after palette swaps: the left one has a red tunic, the second has ochre skin and a blue tunic, and the Magic Wand is active](22-palette-swap.webp)

NES games reused one sprite in different colours. You'll do the same with
the **Magic Wand**, still at Tolerance 0 with Contiguous off. Select a
goblin's layer and:

1. Click one cell of a colour. Every cell of that exact colour is selected.
2. Set the new colour and choose **Edit → Fill**.
3. Press [[Cmd+D]] and move on to the next colour.

The tunic colours are `#9C4A00` (mid), `#D07818` (light) and `#5C2C00`
(dark). The skin colours are `#28B830`, `#8CE868` and `#00702A`.

- **Goblin 1:** a red tunic, `#C02000` / `#F86040` / `#701000`.
- **Goblin 2:** a blue tunic, `#0050D8` / `#4CA0FC` / `#002080`, and ochre
  skin, `#C08A28` / `#F0CC70` / `#704C00`.
- **Goblin 3:** a teal tunic, `#008878` / `#38D8C0` / `#004840`, and teal
  skin, `#20B898` / `#80F0C8` / `#006858`.
- **Goblin 4:** a purple tunic, `#7038D0` / `#A880FC` / `#3A1C80`, and lime
  skin, `#88C800` / `#C8F070` / `#406800`.

## Plan the instruments

![A chart of the four finished goblins: a bard in a red feathered cap with a lute, a drummer with two sticks raised over a red drum, a horn player and an accordion player in a gold crown](23-band-chart.webp)

Each instrument goes on its own layer above its goblin, with the arms that
hold it. That way the body underneath stays untouched. The chart shows each
goblin with its instrument on the same 16 px cells. Line each instrument up
with the goblin's eyes and feet on the canvas. The chart's darker lines
fall every 4 cells.

- **Lute:** a round `#D07818` body with a dark sound hole, held low on the
  left, and a gold neck rising to the right to a brown pegbox. Also a red cap
  with a `#3A1C80` brim and a white feather.
- **Drum:** a red drum with gold zig-zags and a white head, in front of the
  legs, and two `#D89838` sticks raised outward with white tips.
- **Horn:** a gold horn running from the mouth to a flared bell on the right,
  with three `#BCBCBC` valves.
- **Accordion:** red and `#3A1C80` bellows in stripes between two brown end
  boards, with white buttons on the left. Also a gold crown with a red and a
  `#3CBCFC` jewel.

## Paint the lute and the drum

![The bard now holds a lute and wears a feathered cap, and the drummer has a red drum and raised sticks; the Drum layer is selected](24-lute-drum.webp)

Select **Goblin 1**, add a layer called **Lute** and paint the lute, the
cap and the two arms from the chart. The arms are two cells thick, in
`#28B830` with a `#8CE868` highlight on each hand. Outline everything in
black.

Select **Goblin 2**, add a layer called **Drum** and paint the drum, the
sticks and the arms. The arms on the chart are green, so recolour them to
this goblin's skin with the Magic Wand on the **Drum** layer:

- `#28B830` becomes `#C08A28`.
- `#8CE868` becomes `#F0CC70`.

## Paint the horn and the accordion

![All four goblins now hold instruments: lute, drum, horn and accordion, and the accordion player wears a gold crown](25-horn-accordion.webp)

Select **Goblin 3**, add a **Horn** layer and paint the horn and arms. Then
wand-swap the arms to `#20B898` / `#80F0C8`.

Select **Goblin 4**, add an **Accordion** layer and paint the accordion, the
crown and the arms. Then wand-swap the arms to `#88C800` / `#C8F070`.

Collapse the **Band** group with its arrow. If you ever need to move the
whole band, select the group with the **Move** tool active. An arrow key
then moves all eight layers by one cell.

## Type the title in a pixel font

![The word QUARTET typed in white Silkscreen Bold in the empty sky at the top left of the canvas, with the Text tool options showing Silkscreen, Bold and size 256](26-type-title.webp)

With **Band** still selected and collapsed, click **New Group** and name it
**Logo**. Click **Add Layer** to put a layer inside it, and name it
**Logo Outline**. Keep it selected, so the type you add next lands above
it.

Pick the **Text** tool (T). In the options bar, choose **Silkscreen**, set
**Font weight** to **Bold** and **Size** to **256**, and set the colour to
white. Silkscreen is drawn on a 5-pixel-tall grid, so at 256 px each of its
pixels is exactly two cells. Click in the empty sky near the top left, type
**QUARTET** and press [[Tab]] to commit. Then click **Rasterize Layer** at
the bottom of the Layers panel.

Type **GOBLIN** the same way at **384** px, which is three cells per font
pixel, and rasterize it too.

## Line the title up on the grid

![GOBLIN and QUARTET in white, centred across the top of the canvas, with QUARTET under GOBLIN](27-title-placed.webp)

With the **Move** tool and Snap on, drag **GOBLIN** until the top-left
corner of its letters sits at **144, 80**. That leaves a four-cell margin
above it, counting the outline you'll add. Drag **QUARTET** to **320, 416**.
Snap puts the letters' pixels exactly on the grid.

## Select one stripe of the letters

![GOBLIN with marching ants around just its second row of font pixels: the letters' shape intersected with a horizontal band](28-band-selection.webp)

NES logos were often coloured in horizontal stripes, one colour per row of
pixels. GOBLIN's letters are five font pixels tall, and each is 48 px, so it
gets five stripes.

[[Cmd]]-click the **GOBLIN** thumbnail to select the letters. Pick the
Rectangular Marquee. Hold [[Shift+Alt]] and drag a band across the whole
canvas from y 80 to y 128. [[Shift+Alt]] intersects, so only that stripe of
the letters stays selected. Fill it with `#FCF0A0`.

The screenshot shows the next round: the first stripe is already pale
yellow, and the letters have been reselected and intersected with the second
band, y 128 to 176.

## Stripe the whole title

![GOBLIN striped pale yellow, yellow, orange, red-orange and red from top to bottom, and QUARTET striped white, pale blue, sky blue, blue and navy](29-title-bands.webp)

Repeat for the other four stripes of GOBLIN, 48 px each, reselecting the
letters each time with [[Cmd]]-click:

- y 128–176 in `#F8D000`
- y 176–224 in `#F89C00`
- y 224–272 in `#F05800`
- y 272–320 in `#C82800`

QUARTET's font pixels are 32 px tall. Give it six stripes from y 416. The
sixth is the tail of the Q.

- `#FCFCFC`
- `#A8E4FC`
- `#3CBCFC`
- `#0078F8`
- `#0050C0`
- `#003494`

## Fill the outline layer

![The Logo Outline layer filled black in the letter shapes and duplicated, with the copy nudged one cell left so a black edge peeks out on the left of every letter](30-outline-nudge.webp)

Select **Logo Outline** and set the colour to black:

1. [[Cmd]]-click the **GOBLIN** thumbnail and choose **Edit → Fill**.
2. [[Cmd]]-click the **QUARTET** thumbnail and fill again.
3. Deselect.

You now have black copies of both words hidden under the letters.

A pixel outline should have square corners. The Stroke effect and
**Select → Grow** round them off, so spread the black by whole cells
instead. Choose **Layer → Duplicate Layer**, click the copy's row, and with
the **Move** tool press [[Left]] once. With the grid on, one press moves
exactly one cell. Choose **Layer → Merge Down**.

## Finish the square outline

![Every letter of GOBLIN and QUARTET now has an even one-cell black outline with square corners](31-outline.webp)

Repeat the duplicate, nudge and merge three more times: once with [[Right]],
once with [[Up]] and once with [[Down]]. The black now extends one cell past
the letters on every side. The corners come out square because each copy
moves in a straight line.

## Drop an extruded shadow

![A purple shadow sits two cells below and one cell right of the black outline, giving GOBLIN QUARTET a chunky 3D look](32-logo-shadow.webp)

Duplicate the outline layer once more. The copy, **Logo Outline copy**,
stays on top as the outline. You can rename it **Logo Outline** if you
like, but the screenshots keep the default name. Click the original **Logo Outline** underneath
and rename it **Logo Shadow**.

[[Cmd]]-click its thumbnail, fill it with `#5A30B0` and deselect. With the
**Move** tool, press [[Down]] twice and [[Right]] once.

## Set the subtitle

![The words DUNGEON SESSIONS in pale lavender Silkscreen centred under the logo, two cells above the battlements](33-subtitle.webp)

Select **GOBLIN**, so the subtitle lands inside the **Logo** group. Then
pick the **Text** tool:

- Font **Silkscreen**, **Font weight** **Regular**, **Size** **128**.
- At 128 px, one font pixel is one cell.
- Colour `#E0D8FC`.

Type **DUNGEON SESSIONS** in empty sky, press [[Tab]] and rasterize it.
Rename the layer **Subtitle** and drag it to **304, 688**.

There are now two cells between QUARTET's shadow and the subtitle, and two
cells between the subtitle and the merlons.

## Draw the menu box

![A rectangular marquee drawn across the empty strip below the stage, snapped to the grid, ready to fill](34-box-marquee.webp)

Collapse the **Logo** group and, with it selected, click **Add Layer**. A
new layer next to a collapsed group goes above the group, not inside it.
Name it **Menu Box**.

With the Rectangular Marquee, drag from **128, 1808** to **1920, 1984**.
That's 112 × 11 cells, with two cells of space below the stage and four
cells above the bottom edge of the canvas.

## Give the box a rounded pixel border

![A black menu box with a one-cell white border and rounded pixel corners, and a white cursor arrow on the left inside it](35-box-border.webp)

Fill the marquee with white. Choose **Select → Shrink…**, enter **16** and
fill again with black. That leaves a white border one cell wide. Deselect.

Round the corners the way game menus do. With the Pencil:

- Click each of the box's four outer corner cells in `#0C0820`, so they
  disappear.
- Click the four cells diagonally inside them in white, so the border turns
  the corner.

For the cursor, paint a small white arrow pointing right. It's five rows of
1, 2, 3, 2 and 1 cells, starting at x 384 and y 1856.

## Write the menu

![SIDE A and SIDE B in white Silkscreen inside the menu box, with the cursor arrow a full letter space before SIDE A, the group centred with equal padding](36-box-text.webp)

With **Menu Box** selected, use the Text tool with Silkscreen Regular at
**128**, white, to type **SIDE A** and **SIDE B** as two separate layers.
Rasterize both, and name the layers **Side A** and **Side B**.

Drag **SIDE A** to **528, 1856** and **SIDE B** to **1216, 1856**. This
gives:

- six cells (96 px) between the cursor and the S, so it reads as a cursor
  and not as part of the word;
- equal padding left and right inside the box: 15 cells on each side;
- two cells above and below the letters.

## Shade the lower wall

![The lower part of the brick wall is darker in two flat steps, so the goblins stand out against it](37-wall-shade.webp)

Select **Wall** and add a layer called **Wall Shade**. Marquee the wall,
from the 832 guide to the 1648 guide across the full width.

With the Gradient tool, make hard stops:

- `#FFFFFF` at 0% and 56%
- `#C8C0E8` at 58% and 77%
- `#9888C8` at 79% and 100%

Drag from the top of the wall to the stage. Deselect and set the layer's
blend mode to **Multiply**. White leaves the bricks alone, and the two
lilac steps darken the lower wall behind the band.

## Make a scanline tile

![The Rectangular Selection dialog open over the canvas with From 0, 0 and To 16, 8 typed in](38-scan-tile.webp)

Select **Menu Box** and add a layer called **Scan Tile**. Untick **Snap** in
the options bar, because this tile is smaller than one cell.

With the Rectangular Marquee and nothing selected, click the canvas once
without dragging. The **Rectangular Selection** dialog opens.

1. Enter From **0, 0** To **16, 8**, click **Select** and fill with white.
2. Open the dialog again, enter From **0, 6** To **16, 8**, and fill with
   black.
3. Select **0, 0** to **16, 8** once more and choose **Edit → Define
   Pattern**.
4. Deselect and delete the **Scan Tile** layer.

## Lay the scanlines over the scene

![Fine horizontal scanlines over the whole picture, two dark rows in every eight](39-scanlines.webp)

Add a layer called **Scanlines**. Choose **Select → All**, then **Edit →
Fill with Pattern…**, pick the new 16 × 8 tile and click **Apply**. Deselect,
set the blend mode to **Multiply** and the layer opacity to **14%**. Tick
**Snap** again.

The new layer sits just above **Menu Box**, so the scanlines cover the
whole picture except the **Side A** and **Side B** text, which stays crisp
on top.

Keep it subtle. Strong scanlines chop each cell into stripes and muddy small
details like the goblins' faces.

## Add a phosphor glow

![The finished cover with a faint soft glow around the bright title, flames and moon, like an old CRT screen](40-glow.webp)

With **Scanlines** selected:

1. Choose **Select → All**, then **Edit → Copy Merged**, and deselect.
2. **Edit → Paste** puts a flat copy of the whole picture on a new layer.
   Rename it **Glow**.
3. Choose **Filter → Gaussian Blur…** with **Radius** **24**.
4. Set the blend mode to **Screen** and the opacity to **30%**.

The bright colours now bloom softly, like an old TV. The pixels underneath
stay sharp.

Choose **File → Quick Export PNG** to export the cover, and **File → Save
Project** to keep the layers.
