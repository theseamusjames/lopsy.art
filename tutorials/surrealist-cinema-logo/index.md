---
title: Design a Surrealist Cinema Logo
description: Make a Magritte-style logo in Lopsy with a keyhole of daytime sky in a night disc, a floating bowler hat, marquee bulbs and curved seal text.
published: 2026-09-25 23:55
updated: 2026-09-30
level: Intermediate
duration: 45
tags: logo design, surrealism, selections, layer effects, text on a path, radial symmetry, branding
related: etching-style-lighthouse-illustration, liquid-chrome-text-billboard
cover: cover.jpg
coverAlt: Lopsy showing the finished Xanadu Cinema logo, with a navy night disc, a keyhole of blue daytime sky holding a floating bowler hat, a terracotta ring of marquee bulbs, curved seal text, and the XANADU CINEMA wordmark
project: surrealist-cinema-logo.lopsy
---

Surrealist logos work by showing something impossible, drawn with plain,
confident shapes. This one borrows two ideas from René Magritte:

- *The Empire of Light*, a daytime sky above a night street
- the floating bowler hat

In this tutorial you'll build an emblem for an imaginary arthouse cinema,
**Xanadu Cinema**. A navy night disc has a keyhole cut into it, and through
the keyhole you see a bright blue sky where a bowler hat floats. One cloud
escapes past the edge of the badge. Theatre marquee bulbs ring it, and a
curved seal line reads *Ceci n'est pas un film*, a nod to Magritte's
*This is not a pipe*.

You'll use selections, gradients, the brush, copy and paste, transforms,
layer effects, radial symmetry, the Pen tool, text on a path, filters, blend
modes, and a group adjustment.

## Set up the paper, guides and night disc

![A 1000 by 1000 cream canvas with a vertical centre guide, horizontal guides at the top and bottom margins and at the badge's center, and a large navy circle centered where they cross](01-night-disc-guides.webp)

Open [Lopsy](/) and create a **1000 × 1000** document with a white
background. Click the `Background` layer, set the foreground color to
`#EEE4CF` in the Color panel's hex field, and choose **Edit → Fill** to get a
warm paper tone.

[[Cmd]]-click the middle of the top ruler to drop a vertical guide exactly
on the centre line. Then click the left ruler three times for horizontal
guides: about 66 px from the top and 66 px from the bottom for the margins,
and at about 430, a little above halfway, for the center of the badge.

Double-click `Layer 1` and rename it `Ink Disc`. Pick the **Elliptical
Marquee** and [[Cmd]]-drag a circle about 568 px across, centered on the
guide crossing. Set the foreground to `#1B2340` and choose **Edit → Fill**.
Press [[Cmd+D]] to deselect.

> **Tip:** To center the disc exactly, click once with the Elliptical Marquee
> while nothing is selected, and type the corners `216, 146` to `784, 714`.

## Draw the keyhole with the Lasso

![A navy disc with a white circle for the top of the keyhole, a lasso trapezoid below it, and the Feather Selection dialog set to 1 px](02-keyhole-lasso-feather.webp)

Click **Add Layer** and name it `Keyhole`. This white shape is a stencil
you'll use to cut other layers, and you'll delete it at the end.

1. Set the foreground to `#FFFFFF`. With the Elliptical Marquee, draw a
   circle about 220 px across, centered on the vertical guide, with its
   middle about 40 px above the badge's center guide. Choose
   **Edit → Fill** for the round top. Press [[Cmd+D]].
2. Pick the **Lasso** and drag straight through four corners for the
   keyhole's tapered bottom: a narrow top edge about 90 px wide, just inside
   the lower half of the circle, then a wider base about 190 px wide, around
   200 px further down. Keep both edges centered on the vertical guide, then
   let go back at the start point to close it.

## Fill the keyhole stencil

![A crisp white keyhole on the navy disc](03-keyhole-template.webp)

Choose **Edit → Fill** to fill the trapezoid white, then press [[Cmd+D]].
The two white shapes overlap at the neck, so they read as one keyhole.

## Build a daylight sky gradient

![The Gradient Editor with three stops running from deep cerulean through soft sky blue to almost white](04-sky-gradient-editor.webp)

Click **Add Layer** and name it `Sky`. Pick the **Gradient** tool and click
**Advanced…**. In the **Gradient Editor**, click the bar at about 55% to add
a middle stop. Select each stop and pick its color in the square and hue
strip:

1. A deep cerulean, about `#295C9E`, at 0%
2. A soft sky blue, about `#7CB1D6`, at 55%
3. A pale haze, about `#DFEDF2`, at 100%

Click **Done**, then drag straight down the vertical guide, from the top of
the keyhole to its bottom. The sky runs from deep blue at the top to pale
haze at the base.

## Clip the sky to the keyhole

![The sky gradient covers the whole canvas and a selection outlines everything except the keyhole shape](05-clip-sky-inverse-selection.webp)

The sky covers the whole canvas, so cut it down to the stencil:

1. Click the `Keyhole` layer and pick the **Magic Wand**. Click inside the
   white keyhole to select it.
2. Click the `Sky` layer and choose **Select → Inverse**. Everything *except*
   the keyhole is now selected.
3. Press [[Delete]], then [[Cmd+D]].

Now the daytime sky only shows through the keyhole.

## Outline the keyhole in cream

![The keyhole of blue sky now has a thin cream outline, with the Layer Effects drawer open showing Stroke settings](06-keyhole-cream-stroke.webp)

A thin light edge makes the keyhole read as a cut-out, even at small sizes.
With `Sky` active, open its **Layer effects** (the sparkle icon on the layer
row) and turn on **Stroke**. Set the color to `#F1E4CC`, the position to
**Outside** and **Width** to `2`.

## Paint Magritte-style clouds

![Three puffy white clouds with soft blue-gray undersides floating in the keyhole sky](07-painted-clouds.webp)

Click **Add Layer** and name it `Clouds`. Pick the **Brush** and set
**Hardness** `80` and **Opacity** `100`. Each cloud is five or six
overlapping round dabs, so click instead of dragging.

1. Set the foreground to `#A9BED3` and click the underside of each cloud,
   a few pixels lower than where the white will go.
2. Set the foreground to `#FFFFFF` and click the same spots again, about
   6 px higher and at full size. The blue dabs that peek out below become
   the soft shadow on each cloud's belly.

Vary the **Size** between `20` and `52` so the puffs look natural. Paint a
cloud in the upper left of the keyhole, one on the right edge, one small
cloud at the neck and one in the stem. It's fine for clouds to spill past
the keyhole edge, because you'll trim them in a moment.

## Copy a cloud to let it escape

![A rectangular marquee drawn around the upper-left cloud](08-copy-cloud-marquee.webp)

Here's the surreal move: one cloud slips out of the keyhole and drifts off
the badge. With the **Rectangular Marquee**, drag a snug box around the
upper-left cloud. Press [[Cmd+C]], then [[Cmd+V]]. The copy is pasted in
place on a new layer. Rename it `Drifter`.

## Move the escaping cloud

![The copied cloud dragged out to the upper right of the disc, with transform handles around it](09-move-escaping-cloud.webp)

Draw the same marquee again over the copy and press [[V]] for the **Move**
tool. Drag from inside the selection up and to the right, until the cloud
sits across the top-right edge of the disc, half on the navy and half out
on the paper.

## Scale and rotate the cloud

![The escaping cloud, now larger, tilted about 10 degrees with the rotation handle](10-rotate-escaping-cloud.webp)

Press [[Cmd+D]] to drop the moved cloud. Draw a marquee around it again, and
use these steps:

1. [[Cmd]]-drag the bottom-right corner handle out until the cloud is
   about 1.45× its size. [[Cmd]] keeps its proportions. Press [[Cmd+D]].
2. Marquee the bigger cloud once more. Drag the round **rotation handle**
   just outside the top-right corner counterclockwise by about 10°.
3. Press [[Cmd+D]] to commit.

> **Tip:** Commit with [[Cmd+D]] between moving, scaling and rotating. Each
> transform then starts from a fresh box whose handles match what you see.

## Trim the clouds to the keyhole

![The clouds inside the keyhole now stop cleanly at the keyhole edge while the drifting cloud stays outside](11-clip-clouds-to-keyhole.webp)

Repeat the clipping trick on `Clouds`:

1. Magic Wand the `Keyhole` stencil.
2. Click `Clouds` and choose **Select → Inverse**.
3. Press [[Delete]], then [[Cmd+D]].

`Drifter` is on its own layer, so it stays outside the keyhole.

## Build the floating bowler hat

![A navy bowler hat with a red-orange band floating in the round top of the keyhole, with a flat ellipse marquee for the brim](12-bowler-hat-marquees.webp)

The hat is the hero, so make it big. Click the `Clouds` layer and then
**Add Layer**, and name the new layer `Bowler`. Set the foreground to
`#15182B` and build the hat from simple marquee fills. Press [[Cmd+D]]
between shapes.

1. **Crown top:** an Elliptical Marquee about 122 × 104 px, centered on
   the vertical guide in the round top of the keyhole, then **Edit → Fill**.
2. **Crown sides:** a Rectangular Marquee the same width as the crown,
   from its middle down about 38 px, then **Fill**. This gives the dome
   straight sides.
3. **Band:** a Rectangular Marquee the same width, about 18 px tall, across
   the bottom of the crown. Set the foreground to `#D9481C` and **Fill**.
4. **Brim:** set the foreground back to `#15182B`. A flat Elliptical Marquee
   about 244 × 30 px, twice the crown's width and centered under it,
   overlapping the bottom of the band. **Fill**.

> **Tip:** A hat has to be symmetrical, so it helps to type exact corners.
> Click once with either marquee while nothing is selected. The corners used
> here are crown `439, 330` to `561, 434`, sides `439, 381` to `561, 419`,
> band `439, 399` to `561, 417` and brim `378, 409` to `622, 439`.

The brim pokes out past the keyhole onto the night sky. That's a second
small paradox: the hat is in the daytime and the night at once.

## Give the hat form and an outline

![The bowler hat with a subtle blue inner glow on its crown and a thin cream outline that makes the brim visible against the night](13-bowler-hat-effects.webp)

Open the **Layer effects** for `Bowler`:

- **Inner Glow**: color `#4B5A8C`, **Size** `16`, **Opacity** `70`. It adds a
  soft sheen to the crown.
- **Stroke**: color `#F1E4CC`, **Outside**, **Width** `2`. This matches the
  keyhole outline and makes the brim visible where it crosses the navy disc.

## Add a crescent moon and stars

![A cream crescent moon with a warm glow in the upper left of the disc and small cream stars scattered across the navy](14-crescent-moon-stars.webp)

Click `Ink Disc` and then **Add Layer**, so the new layers sit under the sky.
Name the new layer `Moon`.

1. Set the foreground to `#F4E7C6`. In the upper left of the disc, well
   clear of the keyhole, draw a small circle about 72 px across and
   **Fill**.
2. Marquee a slightly smaller circle, shifted up and to the right by about
   a quarter of its width, and press [[Delete]] to bite out a crescent.
3. Give the moon an **Outer Glow** in `#F6D58E` with **Size** `22` and
   **Opacity** `55`.

Add another layer, `Stars`. Click about 30 small brush dabs across the disc
with **Size** `3`, `4` and a few `7`. Keep them away from the keyhole, the
moon and the escaping cloud.

## Trail the cloud out of the keyhole

![A trail of three small clouds, growing in size, stepping from the keyhole's upper right edge to the big escaping cloud](15-cloud-trail.webp)

The big cloud should look like it came *through* the keyhole. Click
`Drifter`, add a layer called `Puffs`, and paint three tiny clouds with the
same shadow-then-white dabs. They step from the keyhole's upper-right edge
toward the big cloud and get bigger as they go, from dabs of about
**Size** `14` up to `30`.

Give `Drifter` a soft **Drop Shadow** in `#1B2340`, with Offset X `6`,
Offset Y `8`, Blur `10` and Opacity `35`, so it floats above the badge.

## Frame it with a terracotta ring

![A terracotta ring around the disc, shown while a circular marquee selects its inside before Delete](16-terracotta-ring.webp)

Click `Bowler` and **Add Layer** so the ring sits below the drifting clouds.
Name it `Ring`.

1. Set the foreground to `#C2552F`. Draw a circle 30 px bigger than the
   disc on every side, centered on the same guide crossing, then **Fill**.
2. Marquee a circle exactly the size of the disc and press [[Delete]] to
   hollow it out.
3. For a gold hairline, set the foreground to `#F3B35A`. Marquee a circle
   5 px bigger than the disc all round and **Fill**, then one 3 px bigger
   and press [[Delete]].

> **Tip:** Concentric circles are easiest with **Select → Grow…**.
> [[Cmd]]-click the `Ink Disc` thumbnail to load the disc as a selection. Use
> it as it is for step 2, or grow it by `30`, `5` or `3` px for the others.

This leaves a thin gold line on the inside of the terracotta and a sliver of
cream between the gold and the navy.

## Place 32 marquee bulbs with radial symmetry

![Thirty-two evenly spaced warm yellow bulbs around the terracotta ring, with the radial symmetry center marker in the middle of the disc](17-radial-symmetry-bulbs.webp)

Add a layer named `Bulbs` and pick the **Brush**.

1. Click the **Radial Symmetry** button in the options bar and set
   **Segments** to `32`.
2. [[Cmd]]-click the center of the disc, where the guides cross, to move
   the symmetry center there.
3. Set the foreground to `#F8DB94`, **Size** `11` and **Hardness** `95`.
   Click once on the middle of the terracotta ring, straight above the
   center on the vertical guide.

One click stamps all 32 bulbs. Turn **Radial Symmetry** off again, then give
`Bulbs` an **Outer Glow** in `#FFD27A` with **Size** `10` and **Opacity**
`70`.

## Delete the stencil and group the emblem

![The Layers panel showing a new Emblem group containing Ink Disc, Moon, Stars, Sky, Clouds, Bowler, Ring, Bulbs, Drifter and Puffs](18-emblem-group.webp)

You don't need the stencil any more. Click the `Keyhole` layer and click
**Delete Layer**.

Click `Ink Disc`, then [[Shift]]-click `Puffs` to select everything in
between. Choose **Layer → Group Layers** and rename the group `Emblem`. Now
you can move the whole badge in one drag or adjust it as a unit.

## Make the seal float with a soft shadow

![The emblem casting a soft navy shadow onto the cream paper below and to the right](19-floating-seal-shadow.webp)

Floating objects that cast shadows are a staple of surrealism. Click
`Background` and add a layer called `Seal Shadow`.

1. Set the foreground to `#1B2340`. Marquee a circle about the size of the
   ring, shifted about 12 px right and 10 px down from the badge, and
   **Fill**.
2. Choose **Filter → Gaussian Blur…**, set **Radius** to `22` and click
   **Apply**.
3. Marquee a circle centered on the badge, just inside the ring's outer edge,
   and press [[Delete]]. Only the shadow outside the ring is left, so it
   doesn't gray out the cream sliver.
4. Set the layer's blend mode to **Multiply** and its opacity to `28%`.

## Set the wordmark

![XANADU in heavy navy serif capitals centered under the badge, with CINEMA in thin letterspaced terracotta capitals between two navy rules with red dots](20-wordmark-lockup.webp)

With `Seal Shadow` still active (so you don't restyle another text layer),
pick the **Text** tool:

- **XANADU**: font **Playfair Display**, weight **Black**, size `116`.
  Set **Letter spacing** to `4` in the Text panel and the color to
  `#1B2340`. Click in empty canvas, type `XANADU`, press [[Tab]], then
  **Move**-drag it so it's centered on the vertical guide, with its top
  about 55 px below the ring.
- **CINEMA**: font **Italiana**, size `34`, **Letter spacing** `24`, color
  `#B84A26`. Center it just under XANADU.

Add a `Rules` layer. With the **Brush** at **Size** `3` and **Hardness**
`100`, click and then [[Shift]]-click to draw a navy line on each side of
CINEMA, matching XANADU's width. Finish each outer end with a single
**Size** `8` terracotta dot.

## Draw an arc with the Pen tool

![A smooth blue Bezier arc with handles, running around the left and top of the ring about 28 pixels outside it](21-pen-tool-arc.webp)

The seal text will run along a circle concentric with the ring, about
28 px outside it. Pick the **Pen** tool and place four smooth anchors on
that imaginary circle. Press at each point and drag along the circle to pull
out handles about 122 px long:

1. Bottom left, at about half past seven on a clock face
2. Left, at about nine o'clock
3. Top left, at about eleven o'clock
4. Top right, at about one o'clock

Click the ✓ **Commit path** button to store it as a path.

## Put the seal text on the path

![CECI N'EST PAS UN FILM, a star, and EST. MCMXXIX set in navy capitals curving around the upper left of the ring](22-text-on-path.webp)

Click the `Rules` layer so you start from a raster layer. Set the Text tool to
**Cinzel**, weight **SemiBold**, size `24`, **Letter spacing** `9`, color
`#1B2340`. Click in empty canvas near the top-left corner and type:

`CECI N’EST PAS UN FILM  ✦  EST. MCMXXIX`

Press [[Tab]]. Then set the **Path** dropdown in the options bar to your new
path. The line wraps around the badge, and the ✦ lands at about ten-thirty.

## Add film grain

![The Add Noise dialog set to Mono, Gaussian, Amount 40 over a gray noise layer](23-film-grain-noise.webp)

Add a layer called `Grain`, set the foreground to `#808080` and choose
**Edit → Fill**. Choose **Filter → Add Noise…**, pick **Mono** and
**Gaussian**, set **Amount** to `40` and click **Apply**.

Set `Grain` to **Overlay** at `30%` opacity. Collapse the `Emblem` group, then
drag `Grain` by its grip to the top of the Layers panel so it covers
everything.

## Warm the badge with a Photo Filter

![The Emblem group's adjustments drawer with a Photo Filter at density 10 giving the clouds and ring a warm vintage cast](24-photo-filter-adjustment.webp)

Open the `Emblem` group's effects drawer, click **Add Adjustment** and choose
**Photo Filter**. Set **Density** to `10`. The warm filter turns the white
clouds a creamy color and gives the terracotta a vintage-print feel, without
touching the type.

## Export the finished logo

![The finished Xanadu Cinema logo in Lopsy, with the keyhole sky, floating bowler hat, escaping cloud trail, marquee bulbs, curved seal text and wordmark](25-finished-xanadu-cinema-logo.webp)

Toggle **View → Show Guides** off to check the composition. Choose
**File → Quick Export PNG** for the artwork, and **File → Save Project** to
keep the layered `.lopsy` file.

For favicons and small sizes, save a simplified variant as well: hide the
seal text and cut the bulbs down to 16. The keyhole and hat still read at
64 px.
