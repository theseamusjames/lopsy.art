---
title: Make a Tardigrade Propaganda Zine Cover
description: Build a retro propaganda zine cover in Lopsy. A posterized NASA Earth, a hand-drawn tardigrade, tilted type, a text-on-path badge and a paper grain.
published: 2026-10-01 13:00
updated: 2026-10-01
level: Advanced
duration: 180
tags: zine cover, propaganda, sunburst, posterize, gradient map, halftone, text on path, layer effects, groups, transforms, undo redo, guides, photo and illustration
related: halftone-iceland-geyser-poster, constructivist-zine-cover, propaganda-poster-party-invitation
cover: cover.jpg
coverAlt: Lopsy editing the finished TARDIGRADE zine cover. A red and peach sunburst radiates behind a blue-grey posterized Earth, with a chunky ochre tardigrade carrying a flag in front of it, a black title band across the top and a footer slogan along the bottom
finished: finished-tardigrade-insurgency.webp
finishedAlt: The finished zine cover inside a cream frame. A black band across the top carries TARDIGRADE in huge cream Anton capitals, with INSURGENCY on a slightly tilted ochre bar beneath it. Red and peach sunburst rays radiate behind a duotone blue-grey Earth with halftone shading and a warm glow. In front of it a big ochre tardigrade with black outlines, black segment lines, a red beret with a star and a raised arm waves a black flag with a cream star on a brown pole. A round ochre badge on the left reads RESIST, ENDURE around its rim with a black and cream star in the middle. A black band at the bottom reads SMALL, EIGHT-LEGGED, UNSTOPPABLE with a small monospace line beneath it, and a fine paper grain covers everything
project: tardigrade-insurgency-zine-cover.lopsy
---

Propaganda posters were printed in a few loud inks. Red rays burst out of
the page, a heroic figure stood in front of them, and a block of heavy
capitals shouted the message. This tutorial builds that look in Lopsy for
**TARDIGRADE INSURGENCY**, an imaginary zine cover for the Water Bear
Liberation Front, on a 1100 × 1700 px page.

It is a **hybrid project**. The planet is a real photograph, the public-domain
NASA picture [The Earth seen from Apollo 17](https://commons.wikimedia.org/wiki/File:The_Earth_seen_from_Apollo_17.jpg)
(the "Blue Marble") from Wikimedia Commons. You'll cut it out, posterize it
and recolour it into a duotone so it sits in the same print world as the
drawn parts. The tardigrade, flag, type and badge are all drawn and typeset
in Lopsy.

Along the way you'll use:

- the **Sunburst** filter, **Posterize**, **Halftone** and **Add Noise**
- a **Gradient Map** adjustment on a group
- **Lasso**, **Elliptical** and **Rectangular Marquee** fills, and the **Magic Wand**
- the **Brush** with [[Shift]]-click straight lines
- **Stroke** and **Drop Shadow** layer effects
- **Text**, **Text Path** binding with **Selection → Path**, and rotating rasterized text
- **groups**, group moves and scaling with the **Move** tool, **guides**, **undo / redo**
- **blend modes** (Multiply, Overlay) and feathered selections

The palette is a handful of warm inks:

- Propaganda red `#B82A1C`
- Sunburst peach `#E9D6A8`
- Cream `#F1E3BD`
- Ink black `#1A1511`
- Ochre `#E0A030` and warm body ochre `#E8A62E`
- Dark ochre `#A8661A`
- Beret red `#8F1D14`
- Earth blue-grey `#24394A` and `#4A6A7C`
- Pole brown `#5A3216`
- Glow `#F6D98A`
- Shade brown `#7A3A10`

## Start a new document

![A new blank 1100 by 1700 pixel document with a white Background layer](01-new-document.webp)

Choose **File → New**, set the units to **Pixels**, make the document
**1100 × 1700** and click **Create**.

## Fill it red

![The Background layer filled with propaganda red](02-red-background.webp)

Set the foreground colour to `#B82A1C`, select the **Background** layer and
choose **Edit → Fill**. The whole page turns red.

## Add the sunburst

![The Sunburst dialog over the red page, with Rays 40, Width 55, Center Y 44 and Taper 0, previewing peach rays fanning out from behind the middle of the page](03-sunburst-settings.webp)

Add a new layer, name it *Sunburst* (delete any empty spare layer the app adds above it) and set the foreground to `#E9D6A8`.
Choose **Filter → Sunburst**. Set **Rays** to **40**, **Width** to **55**,
**Center Y** to **44** and **Taper** to **0**, so the rays start a little
above the middle of the page. Click **Apply**.

## Lower the sunburst opacity

![The finished sunburst: peach rays over the red background, with the layer opacity lowered so the red shows between them](04-sunburst.webp)

Drop the *Sunburst* layer opacity to **65%** so the red glows through and
the rays stop looking quite so flat.

## Bring in the Earth

![The NASA Earth photograph pasted onto its own layer, large and sitting at the top left of the page](05-earth-pasted.webp)

Open the Apollo 17 photograph in your browser, copy it, and press [[Cmd+V]] in Lopsy. It lands on a new layer.

## Place the Earth

![The Earth dragged into the upper middle of the page, committed in place](06-earth-placed.webp)

With the **Move** tool, drag the picture so the globe sits in the upper middle
of the page, leaving room for the tardigrade below it. Press [[Enter]] to commit the paste, then double-click the layer name and rename it *Earth*.

## Cut the Earth out of its space

![An elliptical marquee drawn tightly around the globe, with marching ants hugging its edge](07-earth-ellipse.webp)

Pick the **Elliptical Marquee** and drag a circle that follows the edge of
the globe. Hold [[Shift]] for a perfect circle, and keep the ants just inside the edge of the globe. Then choose **Select → Inverse**.

## Delete the black space

![The black space around the Earth deleted, leaving only the round planet on the sunburst](08-earth-cut.webp)

Press [[Delete]] to remove the black sky, then **Select → Deselect**. The
planet floats cleanly over the rays.

## Posterize the planet

![The Posterize dialog with Levels set to 5 and a preview of the Earth broken into flat bands of tone](09-earth-posterize.webp)

Choose **Filter → Posterize**, set **Levels** to **5**, and leave
**Preview** on while you check that the clouds still read as clouds. Click
**Apply**. Flat bands of tone are what make a photograph feel printed
instead of photographed.

## Group the planet

![The Layers panel with the Earth layer dragged inside a new Planet group](10-planet-group.webp)

Click the **New Group** button in the Layers footer, name it *Planet*, and
drag the *Earth* layer onto it so it sits inside. Putting the photo in a
group lets you recolour it as a unit without touching the pixels.

## Recolour it with a Gradient Map

![The Gradient Map just added to the Planet group, still on its default black-to-white stops](11-gradient-map-added.webp)

With the *Planet* group selected, open the **Adjustments** panel and add a
**Gradient Map**. A short tip appears the first time you do this; dismiss it
with **Got it**.

## Set the Gradient Map stops

![The Gradient Map editor with three colour stops: dark blue-grey on the left, mid blue-grey in the middle and cream on the right](12-gradient-map-stops.webp)

Click the left stop to open its colour picker and type `#24394A` into the hex field. Do the same for the right stop with `#F1E3BD`. Click the middle of the gradient bar to add a third
stop, and set it to `#4A6A7C`. Dark tones now map to deep blue-grey, midtones
to a cooler grey, and highlights to cream.

## The duotone planet

![The planet recoloured as a blue-grey and cream duotone, sitting on the red and peach rays](13-duotone-planet.webp)

The Earth is now a duotone that belongs to the same palette as the page. The
photograph is done. Everything from here is drawn.

## Start the hero group

![A new Hero group above the Planet group in the Layers panel](14-hero-group.webp)

Select the *Planet* group, click **New Group** so the new group appears above
it, and name it *Hero*. Every layer of the tardigrade goes inside this group,
so you can move or scale the whole character later.

## Draw the legs

![Two back legs drawn as stubby shapes in dark ochre, low on the page](15-legs-back.webp)

Add a layer in *Hero* named *Legs back*, set the foreground to `#A8661A` and
use the **Lasso** to draw two rounded stumps for the back legs. Choose **Edit → Fill**.

## Draw the front legs

![The front pair of legs drawn in brighter ochre in front of the dark back pair](16-legs-front.webp)

Add *Legs front* above it, set the foreground to `#E0A030`, and lasso and fill
the front two legs in the same way, a little apart from the back pair. The
lighter colour reads as nearer the viewer.

## Draw the body

![A rounded oval lassoed with marching ants over the lower half of the page, above the legs](17-body-lasso.webp)

Add a layer named *Body*. With the **Lasso**, draw a fat, rounded oval over the legs, wide enough to fill most of the page width. Fill it with `#E0A030`.

## Outline everything

![The Body, Legs front and Legs back layers all given thick black outlines using the Stroke layer effect](18-outlines.webp)

Select *Body* and open its layer effects with the **fx** button. Switch on
**Stroke**, set the colour to `#1A1511` and the width to **8**. Do the same for
*Legs front* and *Legs back*. A consistent heavy outline is a big part of the
propaganda look.

## Add the segment lines

![Five curved black lines across the body, drawn inside the shape to suggest the tardigrade's segments](19-segment-lines.webp)

Add a layer named *Segments*. Hold [[Cmd]] and click the *Body* thumbnail to
load the body as a selection, so the lines can't spill past its edge. Pick the
**Brush**, size **7**, hardness **100**, and colour `#1A1511`. For each
segment, click at the top edge of the body, then [[Shift]]-click at the bottom
edge. Space the five lines evenly. For a curved ring, add a middle [[Shift]]-click point so each line bends gently, like hoops around a barrel. Deselect when you're done.

## Draw the head

![An ochre head lassoed and filled at the right of the body](20-head.webp)

Add a layer named *Head*, lasso an oval to the right of the body, fill it with
`#E0A030` and give it the same **Stroke** effect (`#1A1511`, width **8**).

## Give it a face

![A tiny black eye and a larger cream-and-black snout ring on the head](21-face.webp)

Add a layer named *Face*. Use the **Elliptical Marquee** and **Edit → Fill**
to fill a small black eye. For the snout, fill a bigger black oval at the front of the head, switch to cream and fill a smaller oval inside it, then switch back to black for a small pupil.

## Plant the flag

![A brown pole beside the head carrying a black flag with a cream star, hanging over the right edge of the globe](22-banner.webp)

Add a layer named *Pole* and draw a tall vertical line with the **Brush** at
size **13** in `#5A3216`: click at the bottom, then [[Shift]]-click at the top.
Add a *Flag* layer, and lasso a wavy rectangle at the top of the pole; fill it
`#1A1511`. Add *Flag star*, lasso a five-pointed star in the middle of the flag
and fill it `#F1E3BD`. Keep the pole just left of the head, so the flag hangs over the right edge of the globe.

## Raise an arm

![A tapered ochre arm with a rounded fist gripping the pole, outlined in black](23-arm.webp)

Add *Arm*. Lasso a tapered limb that reaches up from the body to the pole and
add an oval fist on the end. Fill it `#E0A030` and give it the outline effect
(**8** px, `#1A1511`).

## Add a beret

![A deep red beret with a pom-pom perched on the head, with a cream star on it](24-beret.webp)

Add *Beret*. Lasso a flattened oval on top of the head with a little pom on
the crown, and fill it `#8F1D14` with the same outline. Add *Beret star* above
it and lasso a small cream star on the front.

## Sharpen the claws

![Short black claw strokes at the foot of each leg](25-claws.webp)

Add a layer named *Claws*. Use the **Brush** at size **10** in `#1A1511`, and
for each foot click, then [[Shift]]-click a short distance to draw a small claw.

## Shade the body

![The Gradient tool dragged from the bottom of the body up toward the middle, painting a dark gradient over the body selection](26-shade-gradient.webp)

Add a layer named *Body shade* (make sure it's the selected layer), then load the *Body* as a selection with [[Cmd]]-click on its thumbnail. Set the foreground to `#7A3A10` and the
background to white. With the **Gradient** tool, drag from the bottom of the
body up toward the middle.

## Set it to Multiply

![The shading layer set to Multiply at 45 percent, so the underside of the body is a darker, warmer ochre](27-shade-multiply.webp)

Set the layer's blend mode to **Multiply** and its opacity to **45%**. The
belly darkens and the body feels round. Deselect.

## Frame the page

![A rectangle marquee dragged slightly past the canvas on every side, then shrunk inward, leaving a thin border selected](28-frame-selection.webp)

Add a new group above *Hero* named *Layout*. Everything from here on (frame, bands, type and badge) goes in this group. Inside it, add a layer named *Frame*. Drag a **Rectangular Marquee** larger than the canvas,
choose **Select → Shrink** with **34** px, then **Select → Inverse**.

## Fill the frame

![A cream frame around the whole cover](29-frame.webp)

Set the foreground to `#F1E3BD` and choose **Edit → Fill**. Deselect. You now
have a cream border to keep the type off the edge.

## Title band

![A rectangular marquee across the top of the page, inset a little from the cream frame](30-title-band-marquee.webp)

Add a layer *Title band*. Drag a **Rectangular Marquee** across the top of the frame, inset a little from the cream border and tall enough to hold the title. Fill it
with `#1A1511` and deselect.

## Set the title

![TARDIGRADE in huge cream capitals centred in the black band](31-title.webp)

Pick the **Text** tool, choose **Anton**, set the size to **190** and the
colour to `#F1E3BD`, click in the band and type **TARDIGRADE**. Use the
align buttons to centre it horizontally, then drag it with the **Move** tool so it sits inside the band with even margins.

## Subtitle

![INSURGENCY in black Anton capitals on an ochre bar under the title, overlapping the bottom of the band](32-subtitle.webp)

Add a layer *Sub bar* and fill an ochre `#E0A030` rectangle just under the title, narrower than the band and overlapping its bottom edge. Then type
**INSURGENCY** in **Anton** at **100** px in `#1A1511`, and centre it on the
bar.

## Tilt the labels

![The sub bar and its text selected with a marquee, then rotated about three degrees counter-clockwise with the Move tool's rotate handle](33-slanted-label.webp)

Click **Rasterize Layer** on the subtitle text so the rotation is baked into pixels. Select the bar and its text with a marquee, pick the **Move** tool, and drag just outside a corner handle to rotate about **−3°**. The title stays straight. Press [[Cmd+D]] to commit. A slight tilt makes the lockup feel
stamped on.

## Footer band

![A second black band along the bottom of the page, inside the frame](34-footer-marquee.webp)

Add *Foot band* and fill an ink rectangle across the bottom of the frame, roughly a tenth of the page tall.

## Slogan

![SMALL · EIGHT-LEGGED · UNSTOPPABLE in cream Anton capitals centred in the footer band](35-slogan.webp)

With the **Text** tool in **Anton** at **46** px and `#F1E3BD`, type
**SMALL · EIGHT-LEGGED · UNSTOPPABLE**. Centre it horizontally and place it in
the band.

## Small print

![A tiny line of Space Mono beneath the slogan: WATER BEAR LIBERATION FRONT, EST. 530 MYA, NO. 08](36-footer-details.webp)

Add one more line with **Space Mono Bold** at **16** px in cream: **WATER BEAR
LIBERATION FRONT // EST. 530 MYA // NO. 08**. Centre it and drag it with the **Move** tool so it sits neatly under the slogan, with equal space above and below.

## Make a badge

![A circular marquee on the left of the page, just overlapping the edge of the globe](37-badge-marquee.webp)

Add a layer named *Badge*. With the **Elliptical Marquee**, draw a circle on the left of the page, a little below the title, big enough to hold a ring of text.

## Fill the badge

![An ochre disc with a thick black outline, ready for text](38-badge-disc.webp)

Fill it with `#E0A030`, deselect, and give the layer a **Stroke** effect in
`#1A1511` at **6** px.

## Text around the rim

![A smaller circle inside the badge, selected with an elliptical marquee](39-ring-marquee.webp)

Draw a smaller circle inside the badge, leaving a margin for the outline, and choose **Select → Selection to Path**. A circular path appears in the Paths panel.
Deselect.

## Bind the text to the path

![RESIST · ENDURE · RESIST · ENDURE running around the badge in Space Mono, following the circular path](40-ring-text.webp)

Pick the **Text** tool, choose **Space Mono Bold** at **17** px in `#1A1511`,
and type **RESIST · ENDURE · RESIST · ENDURE ·** (with a final space). In the
Text options, set the **Path** dropdown to *Path 1*. The words wrap
around the rim of the badge.

## A star for the middle

![A black star with a smaller cream star on top, in the centre of the badge](41-badge-star.webp)

Add a layer named *Badge star* and lasso a five-pointed star in the middle of
the badge in `#1A1511`. Add *Badge star inner* above it with a smaller cream
`#F1E3BD` star centred on top.

## Drop shadows

![The badge, sub bar and title band with hard drop shadows falling down and to the right](42-shadows.webp)

Open the effects for the *Badge*, *Sub bar* and *Title band* in turn and add a
**Drop Shadow**: offset about **7 / 8** px, a tight **Blur**, `#1A1511` at 85% for the badge and bar, and `#5A3216` at 80% for the title band. A crisp, offset shadow looks like a second ink pass.

## Move the whole hero

![The Hero group selected and dragged upward with the Move tool](43-hero-drag.webp)

Select the *Hero* group in the Layers panel, pick the **Move** tool and drag the tardigrade up a little, so its feet clear the footer band. Moving the group moves every layer inside it,
the flag, the beret and the shade included.

## Undo it

![The Layers panel after pressing undo: the move is undone and the character is back at its old position](44-undo.webp)

Press [[Cmd+Z]]. The hero snaps back to where it was. Press
[[Cmd+Shift+Z]] to redo it.

## Redo it

![After redo the hero is back in the higher position](45-redo.webp)

Checking undo and redo on a group move is a quick way to confirm nothing was left behind, flag and beret included.

## Guides

![A vertical guide down the middle of the page and a horizontal guide at the top of the footer band, both pulled from the rulers, with the title, globe and hero lined up against them](46-guides.webp)

Drag a vertical guide out of the left ruler and park it down the middle of the title and the globe, then pull a horizontal guide out of the top ruler and set it through the centre of the globe. Use them to check that the title, the planet and the badge line up, and that the hero sits comfortably below the globe's centre.

That is a complete cover. Choose **File → Quick Export PNG** to save a
first version, then keep going: the second pass tightens the character and
adds the print texture.

## Scale the hero up

![Dragging a corner handle of the hero's transform box outward while holding Cmd to scale it uniformly](47-hero-scale-drag.webp)

Select the *Hero* group and pick the **Move** tool. Hold [[Cmd]] and drag a
corner handle outward to scale the whole group by about a tenth. The character
now fills the lower half of the page and overlaps the Earth more.

## Commit the scale

![The scaled hero committed; the tardigrade is bigger and sits higher over the globe](48-hero-scaled.webp)

Press [[Cmd+D]] to commit.

## Select the body

![The Magic Wand with Tolerance 110 clicking on the body in the Body layer](49-wand-body.webp)

Select *Body*, pick the **Magic Wand**, set **Tolerance** to **110** and click the body. The whole body shape is selected, including its outline.

## Fill the body

![The body filled with a slightly warmer ochre, #E8A62E](50-body-flat.webp)

Set the foreground to `#E8A62E` and choose **Edit → Fill** to give the body a slightly warmer ochre than the legs and head, which separates the pieces. Deselect.

## Posterize the shading

![The Posterize dialog on the Body shade layer with Levels set to 3](51-shade-posterize.webp)

Select *Body shade* and choose **Filter → Posterize** with **Levels** at
**3**, then **Apply**.

## Set the shade opacity

![The body shade now in hard bands instead of a smooth gradient, with its opacity raised to 55 percent](52-shade-banded.webp)

Raise the layer opacity to **55%**. The soft gradient is now crisp bands, like a three-colour screen print.

## Shade the planet with halftone

![A black-to-white gradient dragged across an elliptical selection of the planet on a new layer called Earth shade](53-earth-shade-gradient.webp)

Select the *Earth* layer inside the *Planet* group, add a layer named *Earth shade*, and make an **Elliptical Marquee** that hugs the globe. Set the foreground to black and
the background to white. Using the **Gradient** tool, drag from the lower right
of the planet up toward the upper left.

## Run the halftone

![The Halftone dialog with Dot Size 12, showing the gradient turned into dots](54-halftone.webp)

Choose **Filter → Halftone**, set **Dot Size** to **12**, and click **Apply**.

## Multiply the dots

![The halftone dots on the planet, multiplied so only the dark dots show on the lower right](55-earth-halftone.webp)

Set the layer's blend mode to **Multiply**. Dots swell in the shadow and
vanish in the light.

## Give the planet a glow

![A big feathered ellipse of pale gold behind the planet](56-glow-fill.webp)

Add a layer named *Earth glow* directly above *Sunburst*. Draw an **Elliptical Marquee** a good deal larger than the planet, centred on it. Set **Feather** to a big soft value (about **90**), and fill it with `#F6D98A`.

## Soften the glow

![The glow at 70 percent, a warm halo around the globe that melts into the sunburst](57-glow-soft.webp)

Set the layer's opacity to **70%**. The planet now glows against the rays.

## Paper grain

![A new top layer filled with mid-grey and the Add Noise dialog open, with Amount 70](58-noise.webp)

At the very top of the *Project* group, add a layer named *Paper grain*. Deselect, fill it with `#808080`, then choose **Filter → Add Noise** and raise **Amount** to **70**.

## Overlay the grain

![The grain layer set to Overlay at 35 percent, giving the whole cover a fine printed-paper texture](59-paper-grain.webp)

Set the blend mode to **Overlay** and the opacity to **35%**. Overlay leaves
the middle grey untouched and only lets the speckle through, so every colour
underneath picks up a soft print grain.

Zoom in and out one last time and check the planet, the type edges and the
badge at 100%. Then choose **File → Quick Export PNG** to save the finished
cover.
