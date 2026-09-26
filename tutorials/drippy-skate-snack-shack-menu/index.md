---
title: Design a Drippy Skate Snack Shack Menu
description: Make a skatepark snack-shack menu in Lopsy with grip-tape texture, a sunburst, melting title lettering, a flame-graphic skateboard and die-cut stickers.
published: 2026-09-26 08:30
level: Intermediate
duration: 75
tags: restaurant menu, skate, typography, layer effects, symmetry, halftone, transforms, groups, spray, stickers
related: skate-style-restaurant-menu, screen-print-restaurant-menu, baroque-restaurant-menu
cover: cover.jpg
coverAlt: Lopsy showing the finished Mango Kickflip menu, with a drippy yellow MANGO title over a pink KICKFLIP bar, a pink sunburst on black grip tape, a two-column menu board with dotted leaders, and a pink-to-orange flame skateboard between orange checkerboard bands
---

## Look at the finished menu

![The finished Mango Kickflip menu: orange and black checkerboard bands top and bottom, a pink sunburst on black grip tape, a melting yellow MANGO title with a hard pink shadow, a tilted pink KICKFLIP bar, a teal FRESH! starburst sticker, a black menu board listing GRINDS and SLURPS with prices and short descriptions, and a pink-to-orange skateboard with black flames and teal wheels](01-finished-mango-kickflip-menu.webp)

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

The palette is grip black `#171717`, mango `#FFB321`, checker orange
`#FFA51F`, hot pink `#FF2E88`, teal `#1FD6C1` and cream `#FFF6E6`.

> **Tip:** Hard offset shadows, with **Blur** at 0, are what make this look read
> as skate rather than generic neon. Use them on every "sticker".

## Make a grip-tape background

![The Add Noise dialog set to Amount 45, Mono and Gaussian over a near-black canvas](02-grip-tape-noise.webp)

Open [Lopsy](/). In **New Document**, set **Width** `1024` and **Height**
`1408`, then click **Create**.

Rename `Layer 1` to `Grip Tape`. Set the foreground to `#171717` and choose
**Edit → Fill**. Then choose **Filter → Add Noise**, pick **Mono** and
**Gaussian**, set **Amount** to `45` and click **Apply**. You get the fine
sandpaper grain of grip tape.

## Double a checker tile across the top

![A row of orange and black 32-pixel checks across the top of the canvas, with a 32 px grid shown](03-checker-tile-doubling.webp)

Choose **View → Show Grid** and drag the **Grid** slider in the options bar to
`32px`. **Snap** switches on with the grid.

> **Tip:** Adjust the Grid slider with the mouse. Pressing the arrow keys
> while it has focus nudges the active layer instead.

Add a layer named `Checker`:

1. Marquee the strip from `0,0` to `1024,64` and fill it with `#FFA51F`.
2. Fill two black `#111111` squares: `0,0` to `32,32` and `32,32` to `64,64`.
   That's a 64 × 64 tile.
3. Marquee the tile, press [[Cmd+C]] then [[Cmd+V]], and drag the paste 64 px
   to the right with the **Move** tool ([[V]]). The grid snaps it into place.
4. Press [[Cmd+D]] and [[Cmd+E]] to merge it down.

Repeat with a 128, 256 and 512 px wide marquee. Four doublings fill the row.

## Duplicate the band to the bottom

![Orange checker bands at the top and bottom edges of the grip-tape canvas](04-checker-bands.webp)

Click **Duplicate Layer** in the Layers panel, then click the copy's row. With
the **Move** tool, drag it down until it snaps to the bottom edge (`y = 1344`).
Rename it `Checker Bottom`.

## Paint a sunburst with radial symmetry

![Eighteen tapered hot-pink rays radiating from a point near the top of the canvas, with the symmetry centre marker](05-sunburst-radial-symmetry.webp)

Select `Grip Tape` and add a layer named `Rays`. Choose the **Brush** ([[B]]):

- **Size** `150`, **Hardness** `100`
- in the Brushes modal, **Taper** `950` and **Spacing** `5`

Click **Radial Symmetry** in the options bar and set **Segments** to `18`.
[[Cmd]]-click the canvas at about `512,260` to move the symmetry centre there.

Set the foreground to `#FF2E88`. Drag one stroke from near the bottom of the
canvas straight up to the centre. The taper narrows each ray to a point.

Turn **Radial Symmetry** off, then set the `Rays` layer's opacity to `28%`.

## Add a halftone glow behind the title

![A field of orange halftone dots fading out from behind the title area over the dimmed pink rays](06-halftone-glow.webp)

Add a layer named `Halftone Glow`. Draw an **Elliptical Marquee** from about
`212,70` to `812,510`, fill it with `#FFB321` and deselect.

Apply **Filter → Gaussian Blur** at **Radius** `70`. Then apply
**Filter → Halftone** with:

- **Dot Size** `16`
- **Density** `1`
- **Angle** `45`
- **Softness** `1`

The blurred edge turns into dots that shrink as they fade.

## Set the MANGO title

![The yellow MANGO title in Knewave with a black stroke and a hard pink drop shadow, and the Layer Effects drawer open](07-mango-title-effects.webp)

Choose the **Text** tool ([[T]]), set **Size** to `230` and the font to
**Knewave**, and set the foreground to `#FFB321`. Click near `110,100` and type
`MANGO`. Press [[Tab]] to commit, then drag it with **Move** until it's
centred.

Open the layer's effects with the ✦ button on its row:

- **Stroke**: `#111111`, **Width** `12`
- **Drop Shadow**: `#FF2E88`, **Offset X** `14`, **Offset Y** `18`,
  **Blur** `0`, **Spread** `10`, **Opacity** `100`

## Scale the KICKFLIP type

![KICKFLIP set in cream Bungee inside a scale box, with handles dragged to 130 percent](08-kickflip-scale.webp)

Select a raster layer, add a layer named `Kickflip Strip`, and fill a
marquee from `162,392` to `862,504` with `#FF2E88`.

Set cream `#FFF6E6` Bungee type at `92` and type `KICKFLIP` in empty space
lower down. Click **Rasterize Layer** at the bottom of the Layers panel.

Marquee the word, switch to **Move**, and [[Shift]]-drag the bottom-right
handle out to about 130%. Press [[Cmd+D]] to commit the scale.

> **Tip:** Press [[Cmd+D]] after every scale or rotation, before you move the
> layer.

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
- **Drop Shadow**: `#1FD6C1`, **Offset X** `-10`, **Offset Y** `12`,
  **Blur** `0`, **Spread** `6`

Then type the tagline in **Permanent Marker**, size `36`, colour `#1FD6C1`:
`SKATEPARK SNACK SHACK  ★  EST. 2026`. Paste it with [[Cmd+V]] so the ★
comes through. Centre it under the bar at about `y = 584`.

## Make taped section headers

![A mango GRINDS tag and a teal SLURPS tag in black Bungee, each rotated 3 degrees in opposite directions](11-section-headers.webp)

For each header, add a layer and fill a 250 × 66 marquee at `y = 650`:

- `Header Grinds` at `x = 64` in `#FFB321`
- `Header Slurps` at `x = 544` in `#1FD6C1`

Type the label in black Bungee `46`, rasterize it, and drag it onto the tag.
Merge it down, then rotate the tag 3°: `GRINDS` counter-clockwise and
`SLURPS` clockwise.

## Set the items with area text

![Two columns of cream Permanent Marker menu items with right-aligned Bungee prices](12-area-text-menu-items.webp)

Open the **Text** panel from the right-hand toolbar. For each column, drag a
text box instead of clicking. That makes area text with a fixed width.

- **Names**: Permanent Marker `26`, **Line height** `2.3`, cream. Drag from
  `68` to `432` (left) and `548` to `912` (right), then paste four lines.
- **Prices**: Bungee `26`, **Line height** `2.3`, **Align right**. Use boxes
  `420`–`480` and `912`–`962`.

Using the same size and line height keeps every price level with its item.

## Back the menu with a board

![A near-black board with an orange outline behind both menu columns](13-menu-board.webp)

Select `Halftone Glow` so the new layer lands beneath the type, and add a
layer named `Menu Board`. Fill a marquee from `40,624` to `984,1014` with
`#0C0C0C`. Give it an orange `#FFB321` **Stroke** set to **inside**.

## Draw dotted leaders

![Teal dotted leader lines running from each menu item to its price](14-dotted-leaders.webp)

Add a layer named `Leaders` above the board. Choose the **Brush** with
**Size** `5` and **Hardness** `100`. In the Brushes modal, set **Taper** to
`0` and **Spacing** to `300`, which spaces the dabs out into dots.

For each row, click just after the item name, then [[Shift]]-click just before
the price. Each pair of clicks makes one straight dotted line. Set the layer
to `75%` opacity.

## Make the board solid and tilt it

![The menu board at 93 percent opacity, rotated about one degree with a thick orange outline and a hard pink offset shadow](15-solid-tilted-board.webp)

The rays showing through hurt legibility. Raise `Menu Board` to `93%`, set
its **Stroke** **Width** to `6`, and add a **Drop Shadow** of `#FF2E88` at
offset `9,9` with **Blur** `0`.

Marquee the board and rotate it about 1° counter-clockwise. That's just
enough to look pasted on.

## Add descriptions and match the prices

![Each menu item now has a small cream Space Mono description underneath, and both price columns are mango orange](16-descriptions-price-overlay.webp)

Type each column's descriptions as area text in **Space Mono** `15`, colour
`#F5EBDC`. Set **Line height** to `3.9867`, which is 59.8 ÷ 15, so each line
lands under its item. Move each block 7 px below the first item. Use
[[ArrowUp]] / [[ArrowDown]] for 1 px nudges. Set both layers to `70%`
opacity.

Give the pink price column a **Color Overlay** of `#FFB321`, so every price
reads as the same kind of information.

## Rasterize and enlarge MANGO

![The MANGO title in a scale box being enlarged about seven percent](17-scale-mango.webp)

Select `MANGO`, click **Rasterize Layer**, and marquee the lettering.
[[Shift]]-drag the bottom-right handle out by about 7%, then press [[Cmd+D]]
and drag it back to centre. The Stroke and Drop Shadow effects stay live on
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
end, and a teal `#1FD6C1` one behind its right end.

> **Tip:** Drag in quick, large moves. A slow drag currently leaves only one
> cloud at the starting point.

## Shape the skateboard deck

![A pill-shaped skateboard deck filled with a pink-to-orange linear gradient inside a Magic Wand selection](20-deck-gradient.webp)

Select `Checker Bottom` and add a layer named `Deck`. Build the pill shape
with three fills:

- a rectangle from `271,1100` to `841,1270`
- 170 px circles at each end, `186,1100` and `756,1100`

Click it with the **Magic Wand** ([[W]]) to select the whole shape. Choose
the **Gradient** tool and click **Advanced…**. Set the stops to `#FF2E88` and
`#FFB321` with the hue strip and colour square, then drag across the deck
from end to end.

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
- **Drop Shadow**: `#1FD6C1`, offset `10,10`, **Blur** `0`, **Spread** `4`

## Add trucks and wheels on their own layer

![Grey trucks with bolts and teal wheels sitting on top of the flame deck, with a soft shadow beneath the hardware](23-trucks-and-wheels.webp)

Add a layer named `Hardware`. For trucks centred at `x = 306` and `x = 806`:

- a `#9AA1A8` baseplate, 72 × 92
- a `#C9CED3` hanger bar, 24 × 212
- four `#5E656B` bolt dots on the baseplate
- 66 × 48 teal ellipse wheels past each edge of the deck
- a cream hub dot on each wheel

Give `Hardware` a black **Stroke** of `3` and a **Drop Shadow** of black at
offset `5,7`, **Blur** `4`, `75%`. The shadow makes the trucks sit *on* the
graphic instead of cutting through it.

## Merge and tilt the board

![The finished skateboard tilted about six degrees clockwise inside a rotation box above the bottom checker band](24-rotate-skateboard.webp)

Press [[Cmd+E]] to merge `Hardware` into `Deck`. Merge Down bakes both
layers' effects into the pixels, so the composite doesn't change.

Marquee the board, rotate it about 6° clockwise, and press [[Cmd+D]]. Add an
**Outer Glow** of `#FF8A1F` (**Size** `36`, **Spread** `8`, **Opacity** `45`)
for heat.

## Slap on a starburst sticker

![A teal fourteen-point starburst sticker reading FRESH! in black Titan One, rotated inside a transform box over the top-right corner](25-fresh-star-sticker.webp)

Add a layer named `Sticker Fresh`. Draw a 14-point star with the **Lasso**
(outer radius `100`, inner radius `80`) around `898,138`. Fill it with
`#1FD6C1`.

Type `FRESH!` in black Titan One `38` in empty space, rasterize it, drag it
onto the star and merge it down. Add a cream **Stroke** of `7` for the die-cut
edge and a soft black **Drop Shadow**, then rotate the sticker 14°.

## Add a round badge

![A round cream badge with a pink ring reading 100% MANGO, tilted in the bottom-left corner](26-round-sticker.webp)

On a new layer, fill three concentric circles:

- cream, 160 px
- pink, 136 px
- cream, 122 px

Merge in `100%` in black Bungee `34` and `MANGO` in pink Permanent Marker
`26`. Add a drop shadow, rotate the badge -14°, and park it in the
bottom-left corner.

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

1. **Filter → Clouds** at **Scale** `10`
2. **Filter → Add Noise**: **Mono**, **Uniform**, **Amount** `70`
3. **Filter → Threshold** at **Level** `175`

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
