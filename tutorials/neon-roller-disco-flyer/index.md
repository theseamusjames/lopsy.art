---
title: Design a Neon Sign Roller Disco Flyer
description: Build a glowing neon sign flyer in Lopsy with tube outlines, Inner and Outer Glow, a patterned brick wall and colored light spill.
published: 2026-09-27 09:30
updated: 2026-09-30
level: Intermediate
duration: 60
tags: neon, flyer design, event flyer, layer effects, text effects, pattern fill, glow, typography
related: neon-glow-text-effect, vaporwave-sunset-billboard, liquid-chrome-text-billboard
cover: cover.jpg
coverAlt: Lopsy showing the finished Saturn Skate Night flyer, with pink neon script, an amber neon planet with a cyan ring, cyan SKATE NIGHT lettering and a violet roller skate on a dark brick wall
finished: finished-saturn-skate-night.webp
finishedAlt: The finished Saturn Skate Night flyer. A pink neon script Saturn hangs over an amber neon planet with a tilted cyan ring and five warm sparkles. Cyan neon SKATE NIGHT sits below, then a violet roller skate beside the date, hours and address, all glowing on a dark aubergine brick wall washed with colored light
project: neon-roller-disco-flyer.lopsy
---

A real neon sign is a thin glass tube with a white-hot core. Colored light
bleeds around it, it throws a shadow on the wall, and it tints everything
nearby. In this tutorial you'll fake all of that in Lopsy for **Saturn
Skate Night**, a 1200 × 1600 px flyer for a roller disco.

You'll draw tubes with marquee fills and **Select → Shrink**, and cut gaps
where tubes cross, just as a sign bender would. Each tube gets three layer
effects: Inner Glow, Outer Glow and Drop Shadow. Pools of blurred colored
light finish the effect.

The palette:

- Brick wall `#452738`, mortar `#0B070D`, background `#140E18`
- Hot pink `#FF2D95`, amber `#FF9A1F`, cyan `#16D9FF`, violet `#A64DFF`
- Tube cores `#FFD3EE` / `#FFE2B0` (pale tints, so the Inner Glow can color the edges)

## Draw a brick tile

![A 160 by 80 pixel brick tile selected with the Rectangular Marquee in the top-left corner of a new 1200 by 1600 document, with a vertical centre guide and four horizontal guides](01-brick-tile.webp)

Choose **File → New**, set the unit to **Pixels**, and create a **1200 × 1600**
document. Add guides by clicking the rulers (a single click drops a guide):

- [[Cmd]]-click ([[Ctrl]]-click) the middle of the top ruler. Holding [[Cmd]]
  snaps the guide to the exact centre line.
- On the left ruler, click at about **145**, **760**, **1075** and **1276**.
  The ruler shows a readout as you hover, so you can land close to each
  one. These mark the top of the headline, the planet's centre, the top of
  SKATE NIGHT and the top of the information block.

Fill the **Background** with `#140E18`. On **Layer 1** (rename it
*Bricks*), build one 160 × 80 tile of a running bond in the top-left corner
using the **Rectangular Marquee** and **Edit → Fill**:

1. Fill the whole 160 × 80 rectangle with the mortar colour `#0B070D`.
2. Fill three bricks with `#452738`, leaving 4 px of mortar between them:
   a full 156 × 36 brick across the top row, then two half-bricks in the
   bottom row: 76 × 36 from the left edge, and 80 × 36 from the middle to
   the right edge.
3. Fill a 3 px strip of `#603B4E` along the top of each brick. This catches
   the light.

> **Tip:** Exact rectangles are easiest with the corner dialog. With
> nothing selected, click once (no drag) with the **Rectangular Marquee**
> and type **From** and **To** values, for example `0`, `40` → `76`, `76`
> for the left half-brick.

## Tile it across the wall

![The Pattern Fill dialog with the new 160 by 80 brick pattern selected and the brick wall previewed across the whole canvas](02-pattern-fill.webp)

Select exactly the tile, **0, 0 → 160, 80**. Turn **Snap** off if the grid
is on. Choose **Edit → Define Pattern**.

Press [[Cmd+D]] to deselect, then choose **Edit → Fill with Pattern...**,
pick the 160 × 80 brick pattern and click **Apply**. With nothing selected,
the pattern covers the whole layer.

## Add grain to the bricks

![The Add Noise dialog set to Mono and Gaussian at Amount 24, adding fine grain to the brick wall](03-brick-noise.webp)

Flat bricks look like vector art. With **Bricks** active, choose **Filter → Add
Noise...**, click **Mono** and **Gaussian**, set **Amount** to **24** and
apply.

## Darken the wall

![The brick wall darkened toward the edges by a radial gradient layer, with the guides still visible](04-dark-wall.webp)

Neon only glows against darkness.

1. Add a layer called *Grime* and run **Filter → Clouds...**. Set its blend
   mode to **Screen** at **14%** opacity, which gives the bricks a faint uneven
   sheen.
2. Add a layer called *Shade* and select the **Gradient** tool with **Type**
   set to **Radial**.
3. In **Advanced...**, set both stops to `#0A0610`, with about **30%** opacity
   on the left stop and **93%** on the right.
4. Drag from the middle of the wall, near where the centre guide crosses the
   760 guide, about 1050 px outward, past a corner. The centre stays
   readable and the corners drop away.

## Bend the planet tube

![An amber-cream circular tube 10 pixels thick centred on the 760 guide](05-planet-tube.webp)

Every tube in this flyer is built the same way. Fill a shape, shrink the
selection by the tube width, then delete the middle.

Add a layer called *Planet*. With the **Elliptical Marquee**, hold [[Cmd]] and
drag a 420 px circle centred on the point where the centre guide crosses the
760 guide. Fill it with the pale amber core colour `#FFE2B0`. Choose
**Select → Shrink…**, set **10** px, click **Apply**, and press [[Delete]].
What's left is a 10 px ring.

## Clip each latitude band

![A curved half-ellipse band on its own layer, with the selection inverted around a 372 pixel circle so everything outside the planet can be deleted](06-band-clip.webp)

Saturn's bands should curve around the sphere instead of running straight
across it. For each band, add a new layer and draw a flat elliptical ring
the same way (fill, **Shrink 9**, [[Delete]]). Then:

1. Marquee the top half of that ellipse and press [[Delete]]. That leaves
   the lower arc, a "smile" that reads as a line of latitude.
2. [[Cmd]]-drag a 372 px circle centred on the planet, 24 px inside its
   outer edge, and choose **Select → Inverse**. Press [[Delete]] so the band
   stops 14 px inside the outline.
3. Choose **Layer → Merge Down** to merge the band into *Planet*.

Use three bands: two above the middle of the planet and one near the
bottom.

## Check the bands

![The amber planet with three curved latitude bands, two in the upper half and one near the bottom](07-planet-bands.webp)

The bands follow the curve of the sphere and stop short of the outline at
both ends. The gap in front of them is where the ring will pass.

## Cut the ring's back arc

![A cyan elliptical ring tube around the planet, with a semicircular lasso selection over the part of the ring that passes behind the planet](08-ring-back-arc.webp)

Add a layer called *Ring* and make a 760 × 192 elliptical tube (**Shrink 9**)
in pale cyan `#C8F8FF`, centred on the planet.

On a real sign the back of the ring is hidden behind the planet. With the
**Lasso**, trace a half-circle just outside the planet's outline over the top
half, then press [[Delete]]. The back arc disappears inside the planet, and
the ring ends leave a small gap before the outline.

## Leave gaps where tubes cross

![The ring passing in front of the planet, with small gaps cut into the planet's outline where the front of the ring crosses it](09-crossing-gaps.webp)

Neon tubes never overlap. A bender leaves a gap where one tube passes in front
of another. Click the *Planet* row, draw two small 34 px circles where the
front of the ring crosses the outline, and press [[Delete]] in each.

## Tilt the planet and ring together

![The planet layer inside a rotated transform box, turned 14 degrees counter-clockwise to match the ring](10-rotate-planet.webp)

Rotate each layer with the same marquee so they share a pivot. Press
[[Cmd+D]], then click once with the **Rectangular Marquee** and enter
**From** `190`, `530` and **To** `1010`, `990`. That's an 820 × 460 box
centred on the planet. Select the **Move** tool, drag the rotate handle
outside the top-right corner **14°** counter-clockwise, and press [[Cmd+D]]
to commit. Click the other layer and repeat with the identical marquee.
The gaps you cut line up perfectly again.

## Smooth the tube edges

![The Gaussian Blur dialog at Radius 2 softening the edges of the planet tube](11-antialias-blur.webp)

Marquee fills are hard-edged, so the tubes look slightly jagged. Run **Filter
→ Gaussian Blur...** at **Radius 2** on each tube layer. This works as
anti-aliasing without making the tube look blurry.

## Light the tubes

![The Layer Effects drawer with Drop Shadow, Outer Glow and Inner Glow enabled on the Ring layer](12-tube-effects.webp)

Open the layer effects (the sparkle button on the layer row) and enable
three effects:

- **Inner Glow:** the tube colour (`#FF9A1F` for the planet, `#16D9FF` for
  the ring), Size **5**, Spread **30**, Opacity **100**. This colours the
  edges and leaves the pale core looking white-hot.
- **Outer Glow:** the same colour, Size **26**, Spread **18**, Opacity
  **85**.
- **Drop Shadow:** near-black `#050208`, **Offset X** **7**, **Offset Y**
  **11**, Blur **7**, Opacity **70**. The tube now seems to stand off the
  wall.

## See the planet light up

![The amber neon planet with its cyan ring glowing on the dark brick wall](13-neon-planet.webp)

That's the whole neon recipe: a pale core, a coloured edge, a halo and a
shadow. Everything else in the flyer reuses it.

## Set the script headline

![Pink neon Saturn script in the Neonderthaw font at 314 pixels near the top of the flyer](14-saturn-script.webp)

Click *Ring* first. The new text layer is added above the active layer, and
while a text layer is active, changing the Text settings restyles it. Select
the **Text** tool and choose **Neonderthaw** (a Google font drawn as single
tube strokes). Set **314** px and the colour `#FFD3EE`, then click in the
empty space at the top and type *Saturn*.

Give it the same three effects in hot pink `#FF2D95`: Inner Glow Size
**4**, Outer Glow Size **30**, Spread **20**.

## Tilt the script

![The Saturn text layer inside a rotated transform box, turned 7 degrees counter-clockwise](15-rotate-saturn.webp)

Script neon looks livelier with a slight upward lean. Marquee around the word,
switch to **Move**, and drag the rotate handle **7°** counter-clockwise. Press
[[Cmd+D]], then use the arrow keys to nudge it until the pink core is centred
on the centre guide with its top on the 145 guide. The text stays editable.

## Track out SKATE NIGHT

![The Text panel with Letter spacing set to 10 px for the new SKATE NIGHT line](16-letter-spacing.webp)

Click a raster layer such as *Ring* again, so your new settings don't
restyle *Saturn*. Type **SKATE NIGHT** in **Tilt Neon** at **150** px in
`#D8FBFF`, clicking just above the 1075 guide. In the **Text** panel, set
**Letter spacing** to **10** px so the capitals don't touch.

## Centre it and make it glow

![Cyan neon SKATE NIGHT centred under the planet, sitting on the 1075 guide](17-skate-night.webp)

With the **Move** tool, click **Align center horizontally** in the options
bar. Add the tube effects in cyan `#12D6FF` (Inner Glow **6**, Outer Glow
**30** / Spread **20**).

## Draw the roller skate

![A lasso-drawn roller skate boot outline with the selection shrunk by 9 pixels, ready to delete the inside](18-skate-outline.webp)

Add a layer called *Skate*. Trace the boot with the **Lasso**: a tall cuff, a
curved instep down to a rounded toe, and a flat sole. Fill it with lilac
`#F1E4FF`, then **Shrink 9** and press [[Delete]] to leave the outline.

Add two wheel rings (48 px circles, **Shrink 9**). Fill short 8 px stubs
joining each wheel to the sole. Fill capsules for two laces and a side
stripe: a rectangle with a circle at each end.

## Light the skate

![A violet neon roller skate tilted 12 degrees, with its toe kicked up](19-neon-skate.webp)

Run **Gaussian Blur** at **Radius 2** on the skate, then add the tube
effects in violet `#A64DFF`. Marquee it and rotate it **12°**
counter-clockwise with the **Move** tool so the toe kicks up, then press
[[Cmd+D]].

## Add the event details

![Date, hours and address lines in Righteous next to the skate, with equal spacing between the lines](20-info-text.webp)

Create the lines **bottom-up** in empty canvas, so a new click doesn't land
inside an existing text box:

- `THE ORBIT RINK · 1200 GALAXY AVE`: Righteous **36** px, `#EDE3FF`
- `8PM – 1AM · ALL AGES`: Righteous **46** px, `#FFE0F2`
- `FRIDAY · OCT 17`: Righteous **76** px, `#FFF0CC`, Letter spacing **6**

> **Tip:** Type characters such as `·` and `–` by pasting them with
> [[Cmd+V]].

Line up the left edges, and nudge until the gaps between the lines are equal
(about 28 px). The block should sit centred on the skate icon. Give each line
a small tube in its colour: Inner Glow **2–3**, Outer Glow **10–18**.

## Group the information block

![The Layers panel with the skate and three text layers grouped into Info, keeping their order](21-group-layers.webp)

Click the top text layer, then [[Shift]]-click **Skate** to select all four.
Choose **Layer → Group Layers** and rename the group *Info*.

## Centre the group

![The Info group moved left so the skate and text together are centred on the 600 guide](22-center-group.webp)

With *Info* active, drag with the **Move** tool to move the whole group at
once, until the block from the skate to the end of the date is centred on the
centre guide.

## Scatter a few stars

![Five four-point sparkles with warm glows around the planet, one large hero sparkle at upper right](23-stars.webp)

On a layer called *Stars* above the ring, lasso five four-pointed sparkles in
`#FFF7D1`. Make one large (about 100 px across) and the rest small. Place
them unevenly so no two mirror each other. Blur them by 2 and add an Outer
Glow in `#FFC93C`.

## Paint pools of colored light

![A black layer with feathered ellipses of pink, amber, teal and violet placed behind each neon element](24-spill-shapes.webp)

Neon tints the wall around it. Add a *Spill* layer above *Shade* and fill it
completely with **black**, which disappears in Screen mode. Set the
Elliptical Marquee's **Feather** to **60**. Fill ellipses behind each sign in
a darker version of its colour:

- dark pink behind *Saturn*
- brown-amber in a large pool around the planet
- teal along the ring and under SKATE NIGHT
- violet at the skate
- amber and pink behind the text

Reset Feather to **0** afterwards.

## Soften the light into the wall

![The light spill blurred and set to Screen, washing the bricks in pink, amber, cyan and violet](25-light-spill.webp)

Run **Gaussian Blur** at **90** on *Spill*, set its blend mode to **Screen**
and its opacity to **65%**. Screen ignores the black completely, so only the
coloured light is added, and the heavy blur melts the pools into the bricks.

## Add a wide halo

![Gaussian Blur at radius 63 applied to a pasted copy of the whole flyer](26-wide-glow.webp)

Click the top layer, choose **Edit → Copy Merged**, then press [[Cmd+V]].

1. Name the paste *Haze*. Blur it at **26**, set it to **Lighten** at
   **80%**.
2. Paste again and name it *Glow Wide*. Blur it at **63**, set it to
   **Screen** at **18%**.

This adds the soft bloom a camera sees around bright neon.

## Finish and export

![The finished Saturn Skate Night flyer in Lopsy with all layers, the Info group and the haze layers in the Layers panel](27-haze.webp)

Hide the guides with **View → Show Guides** if you like, then choose
**File → Quick Export PNG** for the flyer and **File → Save Project** to keep
an editable `.lopsy` copy.

To make another night, double-click the date or venue text and retype it.
Then repeat the Copy Merged haze step so the glow matches the new words.
