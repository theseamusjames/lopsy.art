---
title: Design a Ukiyo-e Great Wave Album Cover
description: Make a Hokusai-style woodblock album cover in Lopsy with a curling great wave, seigaiha sea pattern, paper lanterns, vertical Japanese type and a hanko seal.
published: 2026-09-27 21:00
updated: 2026-10-01
level: Intermediate
duration: 90
tags: ukiyo-e, album cover, woodblock, japanese, patterns, vertical text, typography, layer effects
related: etching-style-lighthouse-illustration, screen-print-restaurant-menu, tropical-jungle-restaurant-menu
cover: cover.jpg
coverAlt: Lopsy showing the finished Abyssal Lanterns album cover, a Hokusai-style great wave curling toward a full moon above a patterned night sea with glowing paper lanterns
finished: finished-abyssal-lanterns.webp
finishedAlt: The finished KURAGE Abyssal Lanterns album cover. A Prussian-blue great wave with white claw-shaped foam curls toward a cream full moon, with small Mount Fuji and stepped kasumi clouds on the horizon. Orange paper lanterns marked 灯 float on a seigaiha-patterned sea with wavy reflections. A cream cartouche holds the vertical title 深淵の灯籠, a carved red seal reads 海月, and a paper band at the bottom reads KURAGE ◆ ABYSSAL LANTERNS, all under a faint woodgrain texture
project: ukiyo-e-great-wave-album-cover.lopsy
---

Ukiyo-e prints are built from a few flat colours, one dark outline block and a
lot of pattern. You get Prussian-blue gradients (*bokashi*), stepped mist
bands (*kasumi*), and a cartouche and seal that carry the title.

In this tutorial you'll make **Abyssal Lanterns**, a 1500 × 1500 px album
cover for the band KURAGE (海月, "jellyfish"). It's a great wave in the style
of Hokusai curling toward a full moon, with floating *tōrō nagashi* paper
lanterns on a patterned night sea. Everything is drawn in Lopsy with lasso
and marquee fills, gradients, one pattern, a few filters and layer effects.

The palette:

- Sky: `#0A1532` → `#1B3764` → `#3F6190` → `#7D95B5`
- Wave: `#2F6FB5` → `#0E2A5C`, stripes `#6FA3DA`, trough `#0A2A5E`
- Foam and moon: `#F2EDE1`, `#F4E6C0`
- Lanterns: `#F5B04A`, `#C8541E`, `#FFE3A0`, frame `#2B160C`
- Ink `#0D1A33` / `#1A2340`, seal red `#C23A22`, paper `#EEE2C6`

## Set up the sheet and paint a bokashi sky

![A 1500 by 1500 document with a cream paper border and a night sky gradient from deep navy at the top to pale blue-grey at the horizon, with margin and centre guides](01-bokashi-night-sky.webp)

Choose **File → New**, set the unit to **Pixels**, and create a
**1500 × 1500** document with a white background.

Add the margins. The ruler shows a readout as you hover:

1. On the top ruler, click about **60** px in from each side, then [[Cmd]]-click the middle to drop a guide exactly on the centre line.
2. On the left ruler, click at about **60**, **900** (the horizon, three-fifths of the way down) and **1310** (the bottom of the picture area, which leaves room for a title band).

Select **Background**, choose **Select → All** and **Edit → Fill** it with paper
cream `#EEE2C6`.

Rename **Layer 1** to *Sky*. Marquee the picture area, from the top-left guide
crossing to where the right-hand guide meets the horizon. Pick the
**Gradient** tool, open **Advanced…** and set four stops:

- `#0A1532` at 0%
- `#1B3764` at 45%
- `#3F6190` at 80%
- `#7D95B5` at 100%

Drag a **Linear** gradient from the top guide straight down to the horizon.
Keep the horizon a cool blue-grey. A warm peach band reads as sunset and
fights the moon.

## Add the moon, Mount Fuji and kasumi clouds

![A cream full moon with a thin navy outline, a small navy Mount Fuji with a white snow cap on the horizon, and three pale blue-grey cloud ribbons with stepped rounded ends](02-moon-fuji-kasumi-clouds.webp)

Build these three pieces on new layers:

- **Moon.** [[Cmd]]-drag a 280 px Elliptical Marquee circle left of centre (its middle about three-eighths of the way across), with its top about 130 px below the top guide. Fill it `#F4E6C0`. Open **Layer effects** and add an **Outer Glow** (`#F3DDA6`, Size 34, Opacity 35) and a **Stroke** (`#0D1A33`, Width 2).
- **Fuji.** Lasso a low cone below the moon and slightly left of it: about 350 px wide at its base, which dips just under the horizon, rising about 160 px to a small flat peak. Fill it `#22406E`. Lasso a zigzag snow cap over the top, fill it `#EFE8DA`, and add the same 2 px Stroke.
- **Mist.** Kasumi are long ribbons whose ends step in as two rounded lobes: the upper lobe sticks out further than the lower one. Lasso three of them and fill them `#97A8C2` at 100% opacity:
  - one just under the moon, a little wider than it
  - a shorter one below that, shifted slightly left
  - a long one across Fuji's lower slopes, just above the horizon

  Give them the 2 px Stroke too.

> **Tip:** Keep every outline at the same 2 px weight. In a woodblock print one key block draws all the lines, so mixed weights look wrong.

## Draw a seigaiha tile

![A zoomed-in view of a 120 by 60 pixel seigaiha tile made from overlapping navy circles with light blue concentric rings, with a rectangular marquee around the tile](03-seigaiha-tile.webp)

Seigaiha ("blue ocean waves") is overlapping fans of concentric rings. Make
one tile on a scratch layer:

1. Rect Marquee a **120 × 60** box and fill it `#13294D`.
2. Circles are centred on the tile's four corners and its middle. Draw them in rows: top corners first, then the middle, then the bottom corners, so each row overlaps the one above.
3. For each circle, fill concentric Elliptical Marquee discs with radius 60 `#3E6899`, 56 `#13294D`, 46 `#3E6899`, 42 `#13294D`, 32 `#3E6899`, 28 `#13294D`, 18 `#3E6899` and 14 `#13294D`. Each smaller disc covers the last, which leaves 4 px light rings.

Marquee exactly the 120 × 60 tile, choose **Edit → Define Pattern**, then
delete the scratch layer.

## Fill the sea in receding zones

![The Pattern Fill dialog open over the bottom zone of the sea at Scale 100, with smaller seigaiha rows above it toward the horizon](04-pattern-fill-zones.webp)

Add a *Sea* layer. The pattern should get smaller toward the horizon, so fill
it in three bands with **Edit → Fill with Pattern…**. Marquee each band across
the picture width, from side guide to side guide:

- a 90 px band starting at the horizon at **Scale 50**
- the next 90 px at **Scale 75**
- everything from there down to the bottom guide at **Scale 100**

At those scales a tile row is 30, 45 and 60 px tall, so a 90 px band holds a
whole number of rows and the zone edges fall on tile edges.

> **Tip:** To get the band edges exact, click once with the Rectangular
> Marquee while nothing is selected and type the corners: **From** 60, 900
> **To** 1440, 990 for the first band, then 60, 990 to 1440, 1080, and
> 60, 1080 to 1440, 1310.

## Add depth and a broken moon path

![The seigaiha sea darkened toward the horizon, with a column of short, irregular cream glints below the moon that get wider toward the viewer](05-sea-depth-moon-path.webp)

**Depth.** Add a *Depth* layer. Marquee the sea and drag a vertical Linear
gradient from `#5B769C` at the horizon to white at the bottom. Set the layer to
**Multiply**. White multiplies to nothing, so only the far sea darkens.

**Moon path.** Add a *Moonpath* layer and lasso about a dozen thin, pointed
shards in `#F3E3B0` in a loose column straight below the moon:

- Near the horizon, make them about 20 × 3 px. Near the bottom, make them about 90 × 8 px.
- Vary the x-offset by ±15 px and use uneven gaps.
- Split a few into two pieces.

Set the layer to **Screen** at 70%. An evenly spaced stack reads as a ladder,
so irregularity is the point.

## Build the wave body and its stripes

![A great wave rising from the right side of the sea, filled with a blue gradient that is lighter under the crest, with light blue stripes following the crest line and tapering off toward the lip](06-wave-body-stripes.webp)

Add a *Wave* layer. Lasso the wave's outline:

1. Start on the right-hand guide, about halfway down the sea. Climb the back slope to a crest about two-thirds of the way across, level with the upper half of the moon.
2. Curl over and down to a lip that hooks inward, to the right of the moon and a little above Fuji's peak.
3. Run back up under the lip, then sweep down the concave face in a long curve, bowing to the right, to the bottom guide about two-fifths of the way across.

Fill the lasso with a vertical Linear gradient from `#2F6FB5` under the crest to
`#0E2A5C` at the base.

For the stripes, lasso seven thin bands (about 9 px wide, tapering to a point)
that follow the crest line at increasing depths inside the wave. Fill them
`#6FA3DA`. Let the outer ones run almost to the lip and end the inner ones
sooner, so they don't pinch together at the summit.

They'll spill outside the wave. To clip them, lasso the wave outline again,
choose **Select → Inverse** and press [[Delete]]. Then marquee the picture area
(from the top-left guide crossing to the bottom-right one), **Inverse**, and
[[Delete]] again to trim anything past the frame. Add a 2 px `#0D1A33` Stroke.

## Break up the trough

![The wave's concave face now has a darker navy band hugging its inner edge and four short light blue stripes curving with it](07-wave-trough.webp)

The face under the curl is a big empty slab. On a new *Trough* layer above
*Wave*:

- Lasso a band about 46 px wide that hugs the inside of the face. Fill it `#0A2A5E`.
- Lasso four short stripes, 5–6 px at their widest and tapering at both ends, at 64, 94, 124 and 154 px from the face. Fill them `#5FA0E0`.

Clip them to the wave the same way (lasso the wave, Inverse, Delete).

## Add the foam claws and spray

![A cream foam band running along the crest with scalloped inner edges, hooked claw fingers of different sizes reaching off the lip, and round spray droplets scattered above the crest](08-foam-claws-spray.webp)

On a *Foam* layer, use `#F2EDE1` for:

- **The foam band.** Lasso a band along the top of the crest that starts thin on the back slope, grows to about 40 px, and has a scalloped inner edge.
- **The claws.** Lasso a dozen or more curved, tapering fingers off the front of the crest. Give them different lengths (40–100 px) and bend angles, each ending in a small hook back toward the wave. Identical teeth look like a comb.
- **The spray.** Pick the **Brush** at Hardness 100 and click about 45 round droplets, Size 6–20, in a loose cloud outside the claws.

Trim to the frame and add a 2 px Stroke.

## Add a foreground swell

![A small curling swell with its own foam and claws in the bottom middle of the picture, overlapping the base of the big wave](09-foreground-swell.webp)

A second, smaller wave gives the big one scale. On a *Swell* layer:

1. Lasso a small curl in the bottom middle of the picture, overlapping the base of the big wave. Start just below the bottom guide, a little right of centre, rise to a crest about 110 px above the guide, then hook left to a tip about 300 px away, just above the bottom guide.
2. Give it the same blue gradient and three short `#6FA3DA` stripes, then clip it.
3. Add a thin foam band and a few small claws.

Trim to the frame and add the 2 px Stroke.

## Make one paper lantern

![A close-up of a square paper lantern with an orange front face, a darker side face, a pale glowing top opening, a dark wooden frame and base, and the kanji 灯 painted on the front](10-paper-lantern.webp)

On a *Lantern* layer near the bottom-left, draw a small box with flat colours
only, using Lasso and Rect Marquee fills:

- **Top opening:** `#FFE3A0`.
- **Front face:** 90 × 100 px in `#F5B04A`.
- **Side face:** a narrow parallelogram in `#C8541E`.
- **Frame:** 6 px posts and rails in `#2B160C`.
- **Base:** a two-tone board, `#3A2214` and `#24140B`.

For the character, select the **Text** tool. Pick **Shippori Mincho B1**,
ExtraBold (800), size 62, colour `#3A1208`. Click in empty space and paste
**灯** ("light"). Press [[Tab]] to commit, drag the glyph onto the centre of
the front face with the **Move** tool, and choose **Layer → Merge Down**. The
merge rasterizes the text for you.

## Clone and scale the flotilla

![A pasted copy of the lantern being scaled down with the Move tool's transform handles, overlapping another lantern in the sea](11-scale-lantern-copies.webp)

Marquee the lantern and press [[Cmd+C]], then [[Cmd+V]]. The copy pastes in
place on a new layer, already selected, with the **Move** tool ready.

1. Drag it to its spot.
2. Hold [[Cmd]] and drag the bottom-right corner handle to scale it uniformly.
3. Tilt a few by 3–5° with the rotate handle just outside the top-right corner.
4. Press [[Cmd+D]] to commit.

Make seven copies at 72%, 55%, 45%, 40%, 36%, 30% and 24%. Place the smallest
near the horizon and the largest toward the viewer.

## Merge the lanterns and make them glow

![Eight lanterns of decreasing size floating across the sea toward the horizon, each with a thin navy outline and a warm orange glow](12-lantern-flotilla.webp)

Select the top copy and run **Layer → Merge Down** seven times, so all eight
lanterns end up on one *Lanterns* layer. Add:

- a **Stroke** of `#0D1A33` at Width 2, the same key-block line as everything else
- an **Outer Glow** of `#FF9A3A` at Size 40, Opacity 45

## Paint wavering reflections

![Close-up of the lanterns with three wavy orange reflection strokes hanging below each one and soft orange light pooled on the water](13-lantern-reflections.webp)

**Spill.** On a *Spill* layer below the lanterns, set the marquee **Feather**
to 20. Fill a flat orange (`#E8782C`) ellipse under each lantern, then set
Feather back to 0. Set the layer to **Screen** at about 50%.

**Reflections.** On a *Reflections* layer, use the **Brush** (Hardness 100,
colour `#F2A04A`, Size about 5% of the lantern's width). Draw three short,
gently wavy vertical strokes under each lantern: a long one in the middle and
shorter ones at the sides. Set the layer to 80%. They double as jellyfish
tentacles, which fits a band called KURAGE.

Select the layers of each part and choose **Layer → Group Layers** to make
four groups: *Night Sky*, *Night Sea*, *Great Wave* and *Lantern Float*.

## Frame the print and add the cartouche

![A thin navy keyline framing the picture, a slightly darker paper band with navy rules at the bottom, and an empty cream cartouche with a red inner rule in the top-left corner](14-frame-band-cartouche.webp)

**Frame.** On a *Frame* layer at the top:

1. Marquee the picture area plus 4 px all round, so the marquee starts just outside the guides. Fill it `#1A2340`.
2. Choose **Select → Shrink…** 5 px and press [[Delete]], which leaves a crisp 5 px keyline.

**Band.** On a *Band* layer, fill a 140 px tall strip in `#E8D5AE` below the
picture, lined up with the frame's sides and leaving a gap of about 20 px
under it. For the 2 px `#1A2340` rules just inside its top and bottom edges,
pick the **Pencil** at Size 2, click at one end and [[Cmd+Shift]]-click the
other.

**Cartouche.** On a *Cartouche* layer, marquee a tall 136 × 480 px box in the
top-left corner of the picture, about 40 px in from the frame, and fill it
in rings using **Shrink**:

- `#1A2340`
- shrink 4, fill `#F3E9CF`
- shrink 6, fill `#C23A22`
- shrink 2, fill `#F3E9CF`

Add a soft **Drop Shadow** (Offset 2/3, Blur 5, Opacity 40).

## Set the vertical title

![A zoomed view of the cartouche with the vertical title 深淵の灯籠 in Shippori Mincho, the Text tool active and the vertical text toggle pressed in the options bar](15-vertical-title.webp)

Select the **Text** tool with the Cartouche layer active. Set:

- **Shippori Mincho B1**, ExtraBold, size **76**
- **Vertical** on (the stacked A-over-B toggle in the options bar)
- Letter spacing **8** (in vertical mode that's the gap between glyphs), Line height 1.4

Click inside the cartouche, paste **深淵の灯籠** ("lanterns of the abyss")
and press [[Tab]].

Centre it in the cartouche with the Move tool and arrow keys, so the gap to
the red rule is the same at the top and bottom (about 25 px) and on both
sides.

## Carve the hanko seal

![A zoomed view of the red square seal reading 海月 in cream with a rough carved edge and inner keyline, shown mid-rotation with the transform box](16-hanko-seal.webp)

On a *Seal* layer, lasso an 84 px square just below the cartouche, centred
under it. Drag slowly along each side and let the line
wander in by a pixel or two here and there, and add a couple of nicks, so the edge looks
rough-carved rather than ruled.
Fill it `#C23A22`. For the inner keyline, shrink 5 and fill `#F6EEDC`, then
shrink 2 and fill `#C23A22` again.

Add vertical text **海月** at size 32 in `#F6EEDC`. Centre it on the seal and
Merge Down.

To rotate the seal by −2°, marquee it and drag just outside the top-right
corner with the **Move** tool, then press [[Cmd+D]]. A stamp that's slightly
off square looks hand-pressed.

## Add a woodgrain texture

![The Fibers filter dialog with Variance 20 and Strength 48 over a grey layer covered in vertical wood-like streaks](17-woodgrain-fibers.webp)

Add a *Woodgrain* layer at the very top and fill it `#808080`.

1. Run **Filter → Fibers…** with Variance **20** and Strength **48**.
2. The fibers are vertical. With the Move tool and no selection, click **Rotate 90° CW** in the options bar to turn them into horizontal grain.
3. Run **Filter → Add Noise…**, Mono, Amount 24.
4. Set the layer to **Overlay** at 20%.

The grain now runs through the sky, the sea and the paper, like ink printed
from a cherry block.

## Set the band typography

![The finished cover in Lopsy: KURAGE in large bold capitals, a small red diamond, and ABYSSAL LANTERNS in smaller spaced capitals centred on the bottom paper band between the navy rules](18-title-band-final.webp)

The band name should lead:

- **KURAGE:** Shippori Mincho B1 ExtraBold, size 56, letter spacing 12
- **ABYSSAL LANTERNS:** Medium (500), size 34, letter spacing 10

Both are `#1A2340` and horizontal, so turn **Vertical** off. Before you set
up each one, click the *Band* layer, then click in empty space on the band
to type it. Then line them up:

1. Centre KURAGE's caps vertically between the band's rules.
2. Put ABYSSAL LANTERNS on the same baseline. With the Move tool, press [[Up]] or [[Down]] until the bottoms of the capitals line up.
3. Leave room between the words for a small diamond with about 35 px of space on each side of it.
4. [[Cmd]]-click both text rows in the Layers panel and nudge them sideways together until the whole line is centred on the centre guide.
5. On the *Band* layer, lasso a small `#C23A22` diamond in the middle of the gap. Finally, check
that *Woodgrain* is still the top layer, so the type is textured too, then
**File → Save Project** and **File → Quick Export PNG**.
