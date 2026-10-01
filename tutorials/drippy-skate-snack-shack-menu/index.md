---
title: Design a Drippy Skate Snack Shack Menu
description: Make a skatepark snack-shack menu in Lopsy with grip-tape texture, a sunburst, melting title lettering, a flame-graphic skateboard and die-cut stickers.
published: 2026-09-26 08:30
updated: 2026-10-01
level: Intermediate
duration: 75
tags: restaurant menu, skate, typography, layer effects, symmetry, halftone, transforms, groups, spray, stickers
related: skate-style-restaurant-menu, screen-print-restaurant-menu, baroque-restaurant-menu
cover: cover.jpg
coverAlt: Lopsy showing the finished Mango Kickflip menu, with a drippy yellow MANGO title over a pink KICKFLIP bar, a pink sunburst on black grip tape, a two-column menu board with dotted leaders, and a pink-to-orange flame skateboard between orange checkerboard bands
finished: 01-finished-mango-kickflip-menu.webp
finishedAlt: The finished Mango Kickflip menu: orange and black checkerboard bands top and bottom, a pink sunburst on black grip tape, a melting yellow MANGO title with a hard pink shadow, a tilted pink KICKFLIP bar, a teal FRESH! starburst sticker, a black menu board listing GRINDS and SLURPS with prices and short descriptions, and a pink-to-orange skateboard with black flames and teal wheels
project: drippy-skate-snack-shack-menu.lopsy
---

Skate graphics borrow from the shop wall:

- grip-tape grain and Vans-style checkerboards
- loud title lettering with hard offset shadows
- flames on the deck
- stickers slapped on at an angle

In this tutorial you'll build a 1024 × 1408 menu for **Mango Kickflip**, a
snack shack at the skatepark. Along the way you'll use:

- **Add Noise**, **Halftone**, **Clouds** and **Threshold**
- copy and paste on a snapping grid
- a tapered brush with **Radial Symmetry**
- Google fonts, point text and right-aligned area text
- the **Move** tool's scale and rotate handles
- **Stroke**, **Drop Shadow**, **Outer Glow** and **Color Overlay** effects
- the **Spray** tool, a **Gradient** clipped by the **Magic Wand**, and a layer group

The palette:

- Grip black `#171717`
- Mango `#FFB321`
- Checker orange `#FFA51F`
- Hot pink `#FF2E88`
- Teal `#1FD6C1`
- Cream `#FFF6E6`

> **Tip:** Hard offset shadows, with **Blur** at 0, are what make this look read
> as skate rather than generic neon. Use them on every "sticker".

## Make a grip-tape background

![The Add Noise dialog set to Amount 45, Mono and Gaussian over a near-black canvas](02-grip-tape-noise.webp)

Open [Lopsy](/). In **New Document**, set **Width** `1024` and **Height**
`1408`, then click **Create**.

Rename `Layer 1` to `Grip Tape`. Set the foreground to `#171717` and choose
**Edit → Fill**. Then choose **Filter → Add Noise…**, pick **Mono** and
**Gaussian**, set **Amount** to `45` and click **Apply**. You get the fine
sandpaper grain of grip tape.

## Double a checker tile across the top

![A row of orange and black 32-pixel checks across the top of the canvas, with a 32 px grid shown](03-checker-tile-doubling.webp)

Choose **View → Show Grid** and drag the **Grid** slider in the options bar to
`32px`. **Snap** switches on with the grid, so every marquee lands on a
32 px cell.

Add a layer named `Checker`:

1. Marquee a strip two cells (64 px) tall across the whole top edge and fill it with `#FFA51F`.
2. At the left end, fill two black `#111111` cells: the top-left one and the one diagonally below and to the right of it. That's a 64 × 64 tile.
3. Marquee the tile, press [[Cmd+C]] then [[Cmd+V]], and drag the paste 64 px
   to the right. Pasting switches to the **Move** tool, and the grid snaps the
   paste into place.
4. Press [[Cmd+D]] and [[Cmd+E]] to merge it down.

Repeat with a 128, 256 and 512 px wide marquee. Four doublings fill the row.

## Duplicate the band to the bottom

![Orange checker bands at the top and bottom edges of the grip-tape canvas](04-checker-bands.webp)

Click **Duplicate Layer** in the Layers panel. With the **Move** tool, drag
the copy down until it snaps to the bottom edge of the
canvas. Rename it `Checker Bottom`.

## Paint a sunburst with radial symmetry

![Eighteen tapered hot-pink rays radiating from a point near the top of the canvas, with the symmetry centre marker](05-sunburst-radial-symmetry.webp)

Select `Grip Tape` and add a layer named `Rays`. Choose the **Brush** ([[B]]):

- **Size** `150`, **Hardness** `100`
- in the Brushes modal (click the brush tip at the left of the options bar), **Taper** `950` and **Spacing** `5` on the **Shape** tab

Click **Radial Symmetry** in the options bar and set **Segments** to `18`.
[[Cmd]]-click the canvas on its vertical centre line, a little under a fifth
of the way down, to move the symmetry centre there. The title will sit around
that point.

Set the foreground to `#FF2E88`. Drag one stroke from near the bottom of the
canvas straight up to the centre. The taper narrows each ray to a point.

Turn **Radial Symmetry** off, then set the `Rays` layer's opacity to `28%`.

## Add a halftone glow behind the title

![A field of orange halftone dots fading out from behind the title area over the dimmed pink rays](06-halftone-glow.webp)

Add a layer named `Halftone Glow`. Draw an **Elliptical Marquee** about
600 × 440 px, centred on the rays' centre point, fill it with `#FFB321` and
deselect.

Apply **Filter → Gaussian Blur…** at **Radius** `70`. Then apply
**Filter → Halftone…** with:

- **Dot Size** `16`
- **Density** `1`
- **Angle** `45`
- **Softness** `1`

The blurred edge turns into dots that shrink as they fade.

## Set the MANGO title

![The yellow MANGO title in Knewave with a black stroke and a hard pink drop shadow, and the Layer Effects drawer open](07-mango-title-effects.webp)

Choose the **Text** tool ([[T]]), set **Size** to `230` and the font to
**Knewave**, and set the foreground to `#FFB321`. Click in the upper left of the canvas,
just below the checker band, and type `MANGO`. Press [[Tab]] to commit, then drag it with **Move** until it's
centred.

Open the layer's effects with the sparkle (✦) button on its row:

- **Stroke**: `#111111`, **Width** `12`
- **Drop Shadow**: `#FF2E88`, **Offset X** `2`, **Offset Y** `6`,
  **Blur** `0`, **Spread** `10`, **Opacity** `100`

## Scale the KICKFLIP type

![KICKFLIP set in cream Bungee inside a scale box, with handles dragged to 130 percent](08-kickflip-scale.webp)

Add a layer named `Kickflip Strip` above `MANGO`, and fill a
700 × 112 px marquee with `#FF2E88`. Centre it across the canvas so its top
overlaps the bottom of MANGO.

Set cream `#FFF6E6` Bungee type at `92` and type `KICKFLIP` in empty space
lower down. Click **Rasterize Layer** at the bottom of the Layers panel.

Marquee the word, switch to **Move**, and [[Cmd]]-drag the bottom-right
handle out to about 130%. [[Cmd]] keeps the proportions. Press [[Cmd+D]] to
commit the scale.

## Merge and rotate the bar

![The pink KICKFLIP bar tilted a few degrees, rising to the right, inside a rotation box](09-kickflip-bar-rotate.webp)

Drag `KICKFLIP` onto the centre of the pink strip and press [[Cmd+E]] to
merge it down. Marquee the whole bar, then drag just outside a corner handle
to rotate it about 5° so it rises to the right. Press [[Cmd+D]].

The bar overlaps the bottom of MANGO like a slapped-on sticker.

## Style the bar and add a tagline

![The KICKFLIP bar with a teal offset shadow, and a teal Permanent Marker tagline reading SKATEPARK SNACK SHACK, star, EST. 2026](10-bar-effects-tagline.webp)

Give `Kickflip Strip` these effects:

- **Stroke**: `#111111`, **Width** `7`
- **Drop Shadow**: `#1FD6C1`, **Offset X** `-3`, **Offset Y** `5`,
  **Blur** `0`, **Spread** `6`

Then type the tagline in **Permanent Marker**, size `36`, colour `#1FD6C1`:
`SKATEPARK SNACK SHACK  ★  EST. 2026`. Paste it with [[Cmd+V]] so the ★
comes through. Centre it about 80 px under the bar, clear of the bar's teal
shadow.

## Make taped section headers

![A mango GRINDS tag and a teal SLURPS tag in black Bungee, each rotated 3 degrees in opposite directions](11-section-headers.webp)

For each header, add a layer and fill a 250 × 66 marquee a little below the
tagline. The two tags sit at the same height, one at the head of each menu
column:

- `Header Grinds` in `#FFB321`, about 64 px in from the left edge
- `Header Slurps` in `#1FD6C1`, starting about 32 px right of the canvas centre

Type the label in black Bungee `46` and drag it onto the tag.
Merge it down, then rotate the tag 3°: `GRINDS` counter-clockwise and
`SLURPS` clockwise.

## Set the items with area text

![Two columns of cream Permanent Marker menu items with right-aligned Bungee prices](12-area-text-menu-items.webp)

Open the **Text** panel from the right-hand toolbar. Select `Header Slurps`
before you set up each box. For each column, drag a text box instead of
clicking. That makes area text with a fixed width.

- **Names**: Permanent Marker `26`, **Line height** `2.3`, cream. Drag a box about 364 px wide under each header, starting just inside the header's left end, then paste four lines.
- **Prices**: Bungee `26`, **Line height** `2.3`, **Align right**. Drag a narrow box, about 60 px wide, at the right end of each column: the left one ending just short of the canvas centre, the right one ending about 60 px from the right edge. Start each at the same height as its names box.

Using the same size and line height keeps every price level with its item.

## Back the menu with a board

![A near-black board with an orange outline behind both menu columns](13-menu-board.webp)

Select `Halftone Glow` so the new layer lands beneath the type, and add a
layer named `Menu Board`. Fill a marquee with `#0C0C0C` that runs 40 px in
from each side and from just above the section headers down to about 30 px
below the last menu line. Give it an orange `#FFB321` **Stroke** with **Position** set to **inside**.

## Draw dotted leaders

![Teal dotted leader lines running from each menu item to its price](14-dotted-leaders.webp)

Add a layer named `Leaders` above the board. Choose the **Brush** with
**Size** `5` and **Hardness** `100`. In the Brushes modal, set **Taper** to
`0` and **Spacing** to its maximum, `200`, which spaces the dabs out into
separate dots.

For each row, click just after the item name, then [[Shift]]-click just before
the price. Each pair of clicks makes one straight dotted line. Set the layer
to `75%` opacity.

## Make the board solid and tilt it

![The menu board at 93 percent opacity, rotated about one degree with a thick orange outline and a hard pink offset shadow](15-solid-tilted-board.webp)

The rays showing through hurt legibility. Raise `Menu Board` to `93%`, set
its **Stroke** **Width** to `6`, and add a **Drop Shadow** of `#FF2E88` with
**Offset X** `9`, **Offset Y** `9` and **Blur** `0`.

Marquee the board and rotate it about 1° counter-clockwise. That's just
enough to look pasted on.

## Add descriptions and match the prices

![Each menu item now has a small cream Space Mono description underneath, and both price columns are mango orange](16-descriptions-price-overlay.webp)

Type each column's descriptions as area text in **Space Mono** `15`, colour
`#F5EBDC`. Set **Line height** to `3.9867`, which is 59.8 ÷ 15, so each line
lands under its item. With the **Move** tool, nudge each block so its first
line sits about 7 px below the first item. The arrow keys move 1 px at a
time. Set both layers to `70%`
opacity.

Give the pink price column a **Color Overlay** of `#FFB321`, so every price
reads as the same kind of information.

## Rasterize and enlarge MANGO

![The MANGO title in a scale box being enlarged about seven percent](17-scale-mango.webp)

Select `MANGO`, click **Rasterize Layer**, and marquee the lettering.
[[Cmd]]-drag the bottom-right handle out by about 7%, drag it back to centre,
and press [[Cmd+D]]. The Stroke and Drop Shadow effects stay live on
the raster layer.

## Melt the title with drips

![Thick mango-yellow drips with round ends hanging from the bottoms of the M, A and N](18-mango-drips.webp)

With `MANGO` still selected, choose the **Brush** with **Hardness** `100` and
the foreground `#FFB321`. Under the feet of the M, A and N:

1. Drag a short vertical stroke, 20 to 70 px long, at **Size** `13`–`18`.
2. Click a dab 9 px wider at the bottom for the drop.
3. Brush a wider, shorter stroke at the top so the drip flares into the
   letter.

Because the drips are painted on the title layer itself, its black stroke
and pink shadow wrap around them.

## Tuck spray bursts behind the bar

![A dense teal spray-paint burst behind the right end of the KICKFLIP bar and a pink burst behind its left end](19-spray-bursts.webp)

Select `MANGO` and add a layer named `Spray Paint`, which lands just under the
bar. Choose **Spray** ([[J]]) with **Size** `110`, **Density** `100` and
**Opacity** `95`. Spray a small pink `#FF2E88` burst behind the bar's left
end, and a teal `#1FD6C1` one behind its right end. Holding the pointer
still builds the paint up, so keep the bursts short.

## Shape the skateboard deck

![A pill-shaped skateboard deck filled with a pink-to-orange linear gradient inside a Magic Wand selection](20-deck-gradient.webp)

Select `Checker Bottom` and add a layer named `Deck`. The deck is a pill
about 740 × 170 px, roughly centred across the canvas a little above the bottom
checker band.

Pick the **Shape** tool ([[U]]), set **Shape** to **Rectangle** and
**Corner Radius** to `85`, half the height, so the ends are fully round. Set
the Fill to `#FF2E88` and remove the stroke. Click (don't drag) on the
canvas's centre line, a little above the bottom band, and enter **740 × 170**.
The Shape tool draws from the centre out.

Click the deck with the **Magic Wand** ([[W]]) to select the whole shape.
Choose the **Gradient** tool and click **Advanced…**. Type `FF2E88` and
`FFB321` into the two stops' hex fields, then drag across the deck from end to
end.

## Paint flames on the deck

![Ten black tapered flame tongues rising from the bottom edge of the gradient deck](21-deck-flames.webp)

Keep the selection active. It stops the brush from painting outside the
deck. Choose the **Brush**: **Size** `50`, **Taper** `170`, colour `#141414`.

Drag ten slightly curving strokes from below the deck's bottom edge upward.
Alternate their lengths between about 120 and 175 px. The taper turns each
stroke into a flame tip.

## Outline the deck and cast a hard shadow

![The flame deck with a black outline and a hard teal offset shadow](22-deck-outline-shadow.webp)

Deselect, then add these effects to `Deck`:

- **Stroke**: `#111111`, **Width** `6`
- **Drop Shadow**: `#1FD6C1`, **Offset X** `4`, **Offset Y** `4`, **Blur** `0`, **Spread** `4`

## Add trucks and wheels on their own layer

![Grey trucks with bolts and teal wheels sitting on top of the flame deck, with a soft shadow beneath the hardware](23-trucks-and-wheels.webp)

Add a layer named `Hardware`. Centre a truck about 120 px in from each end of
the deck, and build each one from:

- a `#9AA1A8` baseplate, 72 × 92
- a `#C9CED3` hanger bar, 24 × 212
- four `#5E656B` bolt dots on the baseplate
- 66 × 48 teal ellipse wheels past each edge of the deck
- a cream hub dot on each wheel

Give `Hardware` a black **Stroke** with **Width** `3` and a black
**Drop Shadow** with **Offset X** `2`, **Offset Y** `4`, **Blur** `4` and
**Opacity** `75`. The shadow makes the trucks sit *on* the
graphic instead of cutting through it.

## Merge and tilt the board

![The finished skateboard tilted about six degrees clockwise inside a rotation box above the bottom checker band](24-rotate-skateboard.webp)

Open the ✦ drawer on `Deck` and click **Rasterize Layer Style**, so its
outline and teal shadow stay around the deck alone. Then select `Hardware`
and press [[Cmd+E]] to merge it into `Deck`. Its stroke and shadow are baked
into the pixels as it merges, so the composite doesn't change.

Marquee the board, rotate it about 6° clockwise, and press [[Cmd+D]]. Add an
**Outer Glow** of `#FF8A1F` (**Size** `36`, **Spread** `8`, **Opacity** `45`)
for heat.

## Slap on a starburst sticker

![A teal fourteen-point starburst sticker reading FRESH! in black Titan One, rotated inside a transform box over the top-right corner](25-fresh-star-sticker.webp)

Add a layer named `Sticker Fresh`. In the top-right corner, overlapping the
checker band, draw a 14-point star with the **Lasso**: drag round through 28 corners that
alternate between an outer radius of about `100` px and an inner radius of
about `80` px, and let go back at the start. Fill it with `#1FD6C1`.

> **Tip:** For crisp, even points, click the 28 corners with the **Pen Tool**
> instead, click **Commit path**, then **Path to Selection** in the Paths
> panel.

Type `FRESH!` in black Titan One `38` in empty space, drag it onto the star
and merge it down. Add a cream **Stroke** with **Width** `7` for the die-cut
edge and a soft black **Drop Shadow**, then rotate the sticker 14°.

## Add a round badge

![A round cream badge with a pink ring reading 100% MANGO, tilted in the bottom-left corner](26-round-sticker.webp)

On a new layer, fill three concentric circles:

- cream, 160 px
- pink, 136 px
- cream, 122 px

Select the badge layer before you set up each word, and merge in `100%` in
black Bungee `34` and `MANGO` in pink Permanent Marker `26`. Add a drop
shadow, rotate the badge -14°, and park it in the bottom-left corner.

## Scatter small stickers

![A cream NO SKATING sticker struck through in pink on the board's bottom edge, and a small teal star on its top-right corner](27-small-stickers.webp)

Stickers look best stuck over edges:

- a cream `NO SKATING` label in Bungee `20`, struck through with a pink
  [[Shift]]-click brush line and tilted -7° over the board's bottom-left edge
- a small five-point teal star with a cream stroke on the board's top-right
  corner

## Make a worn-print grunge layer

![A full-canvas black and white blotchy mask made with Clouds, Add Noise and Threshold](28-grunge-threshold.webp)

Add a layer named `Grunge` at the top of the stack. Apply these filters in
order:

1. **Filter → Clouds…** at **Scale** `10`
2. **Filter → Add Noise…**: **Mono**, **Uniform**, **Amount** `70`
3. **Filter → Threshold…** at **Level** `175`

You get speckled white blotches.

## Group the stickers and finish

![The finished menu in Lopsy with the Stickers group expanded in the Layers panel and the Grunge layer at 9 percent on Screen](29-stickers-group-grunge.webp)

Open the ✦ drawer on `Grunge`, set **Blend** to **Screen**, and drop its
opacity to `9%`. It fades the ink in patches, like a worn screen print.

Click `Sticker Fresh`, [[Shift]]-click the other stickers, and choose
**Layer → Group Layers**. Rename the group `Stickers`. Now you can move all
the stickers at once, or hide them to check the layout underneath.

Hide the grid and guides, then export with **File → Quick Export PNG** and
save a `.lopsy` project so you can reprint the menu when the prices change.
