---
title: Design a Mid-Century Modern Atomic Album Cover
description: Make a 1959-style space-age exotica LP cover in Lopsy with a sunburst sky, halftone textures, an atomic pleasure-dome, script lettering and text on a path.
published: 2026-11-18 20:00
updated: 2026-11-18
level: Advanced
duration: 120
tags: mid-century modern, album cover, retro, sunburst, halftone, layer masks, text on path, pen tool, groups, transforms, layer effects, blend modes, text
related: exotica-tropical-album-cover, mid-century-modern-nesting-season-magazine-cover, halftone-jazz-album-cover
cover: cover.jpg
coverAlt: Lopsy with the finished Atomic Xanadu album cover open at fit-to-screen zoom. The Layers panel shows Grain, the Atom and HiFi Badge groups, Far Minaret and Minarets
finished: finished-atomic-xanadu.webp
finishedAlt: The finished Atomic Xanadu album cover. A cream onion dome striped in vermilion sits on an orange drum with five black arched windows and a mustard plinth. Three cream orbit rings with mustard electrons circle it like an atom. Pale rays fan out from the dome across a dark teal sky with four-point stars, a mustard sun with halftone shading at top right and a round orange HI-FI LONG PLAYING badge at top left. Pink minarets stand either side, with a dark teal silhouette of a distant tower on the right. A scalloped teal edge leads into a cream band holding the word Atomic in orange script with a teal shadow, a hairline rule, the tagline EXOTIC SOUNDS FOR THE ATOMIC AGE, the word XANADU in huge black capitals, and THE KUBLA KHAN QUINTET and STEREO XLP-1959 along the bottom, with STEREO in orange
project: tutorials/mid-century-modern-atomic-xanadu-album-cover/c6fdb50fec43/mid-century-modern-atomic-xanadu-album-cover.lopsy
---

Record covers from the late 1950s sold space-age exotica with flat cut-paper
shapes, sunbursts, boomerang stars and a cheerful mix of script and geometric
sans type. The colours were few, the printing was a little off-register, and
everything had a fine grain from the paper and the halftone screen.

In this tutorial you'll make the cover of **Atomic Xanadu**, an imaginary 1959
LP by The Kubla Khan Quintet. Kubla Khan's pleasure-dome becomes the nucleus
of an atom: an onion dome with three orbiting rings, under a sunburst sky. The
finished cover has:

- a teal **sunburst sky** that radiates from the dome, faded with a **layer mask** and textured with **halftone dots**
- a mustard **sun** with halftone shading
- an **onion dome** cut from Lasso selections, with stripes printed slightly **out of register**
- two minarets and a distant tower made with **copy, paste and scale**
- three **orbit rings** made from one ring, duplicated and **rotated**, grouped into an atom
- four-point **atomic stars** and a **scalloped edge** between the sky and the title band
- a **type lockup** in Yellowtail, Jost and Josefin Sans, with a pencil hairline
- a **HI-FI badge** with its small print set **on a curved path**
- overall **grain** and a warm **Photo Filter** to make it feel printed

You don't need any photos: everything is drawn in Lopsy.

The tools you'll use:

- **Rulers and guides**, with Cmd-click to drop a guide on the centre
- the **Rectangular** and **Elliptical Marquee**, the **Lasso**, [[Shift]] to add, [[Alt]] to subtract and [[Shift]]+[[Alt]] to intersect
- **Select → Shrink**, **Edit → Fill**, **Copy**, **Paste** and **Duplicate Layer**
- the **Gradient**, **Shape**, **Pen**, **Pencil** and **Text** tools
- **Filter → Sunburst, Halftone** and **Add Noise**
- **layer masks**, **groups**, the **Move** tool's rotate and scale handles, and arrow-key nudges
- **Drop Shadow**, **Stroke** and **Color Overlay** effects, **Copy effects** and **Paste effects**
- the **Multiply** and **Overlay** blend modes and the **Photo Filter** group adjustment

The palette:

- Paper `#EEE3C7`, ink `#2A2420`
- Sky `#3A8A80` → `#1F5E5A` → `#143A3F`
- Rays `#F2D58A`
- Sun `#F4C04A` → `#E3762C`
- Dome cream `#F7EEDB`, vermilion `#D4572A`, mustard `#E3A72F`
- Minarets `#E9A69A`, far tower `#2E5F5B`
- Electrons `#F4C04A`
- Photo filter `#E8901C`

> **Tip:** Positions are written as `x, y` in document pixels from the top-left corner. Watch the X and Y readout in the status bar at the bottom left as you move the pointer. The landmarks are the **horizon** at `y 950`, and the **margins** at `x 100` and `x 1400`. The dome sits left of the `x 750` centre guide on purpose, to balance the sun on the right.

> **Tip:** Every blend mode and effect in this tutorial is set from the layer's **Layer effects** button (the sparkle icon on its row in the Layers panel). The blend-mode menu is at the top of that drawer. Opacity is the percentage on the layer's row: click it and drag the slider.

> **Tip:** Key names are Mac keys. On Windows and Linux, use Ctrl for Cmd. Filter dialogs open with their default values each time, so set every value a step lists.

## Set up the document and guides

![A 1500 by 1500 cream canvas with blue guides at x 100, 750 and 1400 and at y 100, 950 and 1380, with rulers along the top and left edges](01-guides.webp)

1. Open [Lopsy](/). In the **New Document** dialog, set **Width** and **Height** to `1500`, then click **Create**.
2. Click the **Background** layer, set the foreground colour to `#EEE3C7` and choose **Edit → Fill**.
3. If you can't see rulers along the top and left, choose **View → Show Rulers**.
4. Click the top ruler at `100` and again at `1400` to drop two vertical margin guides. Hold Cmd and click the top ruler near the middle: the guide snaps to exactly half the width, `750`.
5. Click the left ruler at `100`, `950` and `1380` to drop three horizontal guides. The one at `950` is the horizon, and the one at `1380` is where the bottom line of type will sit.

A square 1500 px canvas is a 12-inch LP sleeve at 125 dpi, which is plenty for a cover you'll share online.

## Paint the sky with a radial gradient

![The top of the canvas filled with a teal radial gradient that is lightest just above the centre-left, where the dome will go, and darkens to deep teal at the edges, ending exactly on the horizon guide](02-sky-gradient.webp)

1. Double-click **Layer 1** in the Layers panel and rename it `Sky`.
2. Pick the **Rectangular Marquee** (`M`) and drag from just outside the top-left corner of the canvas down to the right edge, ending on the horizon guide at `y 950`. The marquee snaps to the guide when you get close.
3. Pick the **Gradient** tool, set **Type** to **Radial** and click **Advanced...** to open the Gradient Editor. Set three stops: `#3A8A80` at the left end, `#1F5E5A` in the middle and `#143A3F` at the right end. Click **Done**.
4. Drag from about `560, 600`, where the middle of the dome will be, straight up past the top of the canvas.

The bright spot behind the dome is subtle, but it pulls the eye to the centre of the cover before anything is drawn there.

## Fan sunburst rays out from the dome

![Pale cream rays fanning out across the whole sky from a point at the centre-left, with dark teal gaps between them](03-sunburst-rays.webp)

1. Keep the sky selection active. Click **Add Layer** at the bottom of the Layers panel and rename the new layer `Rays`.
2. Set the foreground colour to `#F2D58A`.
3. Choose **Filter → Sunburst...** and set **Rays** `32`, **Length** `110`, **Width** `45`, **Taper** `0`, **Fade** `60`, **Rotation** `0`, **Center X** `37.33`, **Center Y** `38.33` and **Opacity** `30`. Click **Apply**.
4. Press [[Cmd+D]] to deselect.

The centre is set as a percentage of the canvas, so `37.33` and `38.33` put it at `560, 575`, the middle of the atom you'll draw later. A length over 100% makes sure the rays reach every corner.

## Fade the rays with a layer mask

![The Rays layer in mask edit mode, with a blue overlay showing the hidden lower part of the canvas. The rays are full strength near the top and fade out toward the horizon. The Layers panel shows a black-to-white mask thumbnail under Rays](04-rays-mask.webp)

1. With **Rays** selected, click **Add Mask** at the bottom of the Layers panel. Lopsy switches to editing the mask.
2. Pick the **Gradient** tool, set **Type** to **Linear**, open **Advanced...** and set the stops to white `#FFFFFF` on the left and black `#000000` on the right.
3. Drag from `750, 420` straight down to the horizon at `750, 950`.
4. Click the **Rays** layer name to leave mask editing.

Black in a mask hides and white shows, so the rays now fade out before they reach the buildings. The blue tint only shows while you're editing the mask.

## Add a halftone texture to the sky

![The sky now covered with a faint diagonal grid of halftone dots that get larger toward the horizon, on a layer named Sky Dots at 18% opacity](05-sky-halftone.webp)

1. Click **Add Layer** and rename it `Sky Dots`.
2. With the Rectangular Marquee, select the sky again, from the top-left corner down to the horizon guide.
3. With the **Gradient** tool still set to white and black, drag from `750, 150` down to `750, 950`. Press [[Cmd+D]].
4. Choose **Filter → Halftone...** and set **Dot Size** `10`, **Angle** `45` and **Softness** `0.4`. Click **Apply**.
5. Set the **Sky Dots** blend mode to **Multiply** and its opacity to `18%`.

Halftone turns the grey gradient into dots that grow as it darkens. Multiply makes the white disappear, so only the dots darken the sky, a little more near the horizon.

## Draw the sun

![A circular marquee at the top right of the sky, centred at 1170, 290, with the sun's orange gradient filling it](06-sun-marquee.webp)

1. Click **Add Layer** and rename it `Sun`.
2. Pick the **Elliptical Marquee** and drag a circle from `1020, 140` to `1320, 440`.
3. With the **Gradient** tool set to **Linear**, open **Advanced...** and set the stops to `#F4C04A` and `#E3762C`.
4. Drag from the top of the circle straight down to the bottom of it.

Keep the selection: you'll use the same circle for the shading in the next step.

## Shade the sun with halftone dots

![The mustard sun with a band of rust-coloured halftone dots across its lower half, getting larger toward the bottom](07-sun-halftone.webp)

1. Click **Add Layer** and rename it `Sun Dots`. The circle is still selected.
2. Use the **Gradient** tool with white and black stops again, and drag from just above the middle of the sun down to its bottom edge.
3. Choose **Filter → Halftone...** and set **Dot Size** `12`, **Angle** `45` and **Softness** `0.4`. Click **Apply**, then press [[Cmd+D]].
4. Set the **Sun Dots** blend mode to **Multiply** and its opacity to `30%`.

## Draw the onion dome

![A Lasso selection in the shape of an onion dome, wide and rounded at the bottom and pinched to a sharp point at the top, outlined with marching ants over the sky](08-dome-lasso.webp)

1. Click **Add Layer** and rename it `Dome`.
2. Pick the **Lasso** (`L`). Start at the bottom-left of the dome at about `350, 770` and draw the outline in one stroke:
   - bulge out slightly to the left, to about `x 325` at `y 700`
   - curve in toward the top, so the dome is about half as wide at `y 580`
   - narrow into a sharp point at `560, 390`
   - come back down the right side as a mirror image to `770, 770`, and release
3. Set the foreground colour to `#F7EEDB`, choose **Edit → Fill** and press [[Cmd+D]].

Take your time with the Lasso and redo it with [[Cmd+Z]] if one side looks lopsided. The classic onion shape is fattest about a quarter of the way up.

## Cut the stripes with Alt-subtract

![Two Lasso outlines on the dome: an outer narrower onion shape and an inner even narrower one subtracted from it, leaving two curved stripe-shaped selections](09-gore-subtract.webp)

1. Click **Add Layer** and rename it `Dome Gores`.
2. With the **Lasso**, draw a narrower onion inside the dome, about three-quarters as wide, sharing the same point at the top and the same base.
3. Hold [[Alt]] and draw an even narrower onion inside that one, about half the dome's width. Holding Alt subtracts it, leaving two curved stripes.
4. Set the foreground colour to `#D4572A`, choose **Edit → Fill** and press [[Cmd+D]].
5. Repeat for a thin pair of stripes near the centre: draw an onion about a third of the dome's width, hold [[Alt]] and subtract one about a sixth of the width, then fill.

These curved segments are called gores. Because every stripe shares the dome's point, they wrap around it like the panels of a real onion dome.

## Print the stripes out of register

![The dome with its vermilion stripes and a faint second copy of the stripes shifted down and to the right, like a misaligned print plate](10-gores-offset.webp)

1. With **Dome Gores** selected, choose **Layer → Duplicate Layer** and rename the copy `Gores Offset`.
2. Pick the **Move** tool (`V`) and press [[→]] seven times and [[↓]] five times to nudge the copy.
3. Set the **Gores Offset** blend mode to **Multiply** and its opacity to `35%`.

Real 1950s covers were printed one colour at a time, and the plates rarely lined up perfectly. A faint offset copy gives the same handmade feel.

## Build the drum, cornice, plinth and finial

![An orange drum under the dome, with a mustard cornice, a mustard plinth along the horizon, and a small mustard ball and spike on the dome's point, all shown as marching-ant selections](11-cornice-plinth-finial.webp)

1. Click **Add Layer** and rename it `Drum`.
2. With the **Rectangular Marquee**, select a box from `325, 770` to `795, 930`, fill it with `#D4572A` and deselect.
3. Set the foreground colour to `#E3A72F`. Draw the cornice as a wider band from `305, 750` to `815, 776`.
4. Hold [[Shift]] and add the plinth, a band from `290, 925` to `830, 950` that sits on the horizon guide.
5. Switch to the **Elliptical Marquee**, hold [[Shift]] and add a small circle about 28 px across on the dome's point, centred at `560, 388`.
6. Switch to the **Lasso**, hold [[Shift]] and add a thin spike from the ball up to about `560, 332`.
7. Choose **Edit → Fill** and press [[Cmd+D]].

Adding all four pieces to one selection means a single fill. The plinth gives the building something to stand on, so it doesn't look cropped by the horizon.

## Cut the arched windows

![Five arched window selections across the orange drum, each a rectangle joined to a circle on top](12-window-selection.webp)

1. Choose **View → Snap to Guides** to turn guide snapping off. Otherwise the window nearest the centre guide snaps to it and comes out narrower.
2. With the **Rectangular Marquee**, select a 48 px wide window from `356, 850` to `404, 925`.
3. Switch to the **Elliptical Marquee**, hold [[Shift]] and add a 48 px circle from `356, 826` to `404, 874` on top of it to round the arch.
4. Repeat for four more windows, 90 px apart, centred at `x 470`, `560`, `650` and `740`, holding [[Shift]] for every one.
5. Set the foreground colour to `#2A2420`, choose **Edit → Fill**, press [[Cmd+D]] and turn **View → Snap to Guides** back on.

## Raise the minarets

![Two pink minarets standing on the horizon either side of the dome, each with a small onion cap and two mustard balconies](13-minarets.webp)

1. Click **Add Layer** and rename it `Minarets`.
2. With the **Rectangular Marquee**, select a 48 px wide tower centred at `x 215`, from `y 470` down to the horizon. Hold [[Shift]] and use the **Lasso** to add a small onion cap on top, about 76 px wide and 110 px tall.
3. Hold [[Shift]] and add a second tower the same way, centred at `x 990` with its top at `y 520`.
4. Fill with `#E9A69A` and deselect.
5. Set the foreground colour to `#E3A72F` and add two balconies to each tower: a 72 px wide, 16 px tall band 60 px below the top of the shaft and another 200 px below the top of the shaft. Hold [[Shift]] to add each one, then fill and deselect.

The towers stay well clear of the dome and of the orbits you'll add later, so nothing collides.

## Copy, paste and scale a distant tower

![A pasted copy of the right minaret moved to the far right and being scaled down from its top-left corner handle, with the marching-ant transform box around it](14-far-minaret-scaling.webp)

1. With **Minarets** selected, use the **Rectangular Marquee** to draw a box around the right minaret and its cap. Press [[Cmd+C]] and then [[Cmd+V]]. The copy is pasted in place on a new layer, still selected.
2. Rename the new layer `Far Minaret`.
3. Pick the **Move** tool and drag inside the selection about 310 px to the right, so the tower sits near `x 1300`.
4. Hold Cmd and drag the top-left corner handle down and to the right until the tower is about three-quarters of its size. Cmd keeps the proportions locked, and the opposite corner stays put, so the base stays on the horizon by itself.
5. Press [[Cmd+D]] to commit.

## Turn the copy into a silhouette

![The small far minaret recoloured as a flat dark teal silhouette, which makes it read as further away](15-far-minaret-silhouette.webp)

1. Click the **Layer effects** button on the **Far Minaret** row.
2. Turn on **Color Overlay** and set its colour to `#2E5F5B`. Close the effects drawer.

A darker, cooler shape with no detail reads as far away. This is an old stage-flat trick that gives a flat illustration depth.

## Draw the first orbit ring

![An elliptical selection shrunk by 9 px inside a cream filled ellipse around the dome, ready to be cleared to leave a thin ring](16-orbit-shrink.webp)

1. Click **Add Layer** and rename it `Orbit 1`.
2. With the **Elliptical Marquee**, drag a wide, flat ellipse around the dome from `260, 495` to `860, 655`. Fill it with `#F7EEDB`.
3. Choose **Select → Shrink...**, enter `9` and click **Apply**.
4. Press [[Delete]] to clear the middle, leaving a 9 px ring, then press [[Cmd+D]].

## Give the ring a hard print shadow

![The orbit ring with the effects drawer open on Drop Shadow, set to offset 5 and 5, blur 0 and dark teal, so the ring has a crisp dark echo below and to the right](17-orbit-shadow.webp)

1. Open the **Layer effects** for **Orbit 1** and turn on **Drop Shadow**.
2. Set **Offset X** `5`, **Offset Y** `5`, **Blur** `0`, **Spread** `0`, **Opacity** `100` and the shadow colour `#143A3F`. Close the drawer.

A hard shadow with no blur looks like a second ink colour printed slightly off, which suits the period far better than a soft glow.

## Duplicate and rotate the orbits

![The third orbit ring, Orbit 3, being rotated counter-clockwise about the dome with the Move tool's rotation handle, its transform box tilted the opposite way to Orbit 2, which is already in place over the flat first ring](18-orbit-rotating.webp)

1. Choose **Layer → Duplicate Layer** and rename the copy `Orbit 2`. The copy keeps the drop shadow.
2. With the **Rectangular Marquee**, draw a box around the ring, from `256, 491` to `864, 659`.
3. Pick the **Move** tool, grab the round rotation handle just outside the top-left corner and drag clockwise. Stop when the ring is steep, about 58°: its upper end should be over the left side of the dome's point and its lower end just past the right end of the drum. Press [[Cmd+D]].
4. Click **Orbit 1**, duplicate it again and rename the copy `Orbit 3`. Box the ring with the Rectangular Marquee in the same way and rotate it counter-clockwise by the same amount, so it mirrors Orbit 2.

All three rings share a centre, so together they make the classic atom symbol around the dome.

## Add the electrons and group the atom

![Three mustard electrons with thin dark outlines sitting on the three rings, and the Layers panel showing a new Atom group](19-atom-grouped.webp)

1. Select **Orbit 2** and click **Add Layer**. Rename the new layer `Electrons`.
2. With the **Elliptical Marquee**, draw a 32 px circle on the left end of the flat ring. Hold [[Shift]] and add one on the lower right of one tilted ring and one near the bottom of the other.
3. Fill with `#F4C04A`, deselect, then add a **Stroke** effect of width `3` in `#2A2420`.
4. With **Electrons** selected, Shift-click **Orbit 1** so all four layers are selected, and choose **Layer → Group Layers**. Rename the group `Atom`.

Now you can move the whole atom by selecting the group and dragging with the Move tool. Try it, then press [[Cmd+Z]] to put it back.

## Scatter four-point atomic stars

![Several four-point star shapes selected with the Lasso across the sky, each with long vertical and horizontal points and short diagonal ones](20-star-selection.webp)

1. Click **Sky Dots** in the Layers panel, then click **Add Layer** and rename it `Starbursts`. It sits under the sun and the buildings.
2. Turn off **View → Snap to Guides**.
3. Zoom in to 200% or more so the stars are big enough to draw. With the **Lasso**, draw a four-point star by clicking from point to point: long, thin points up, down, left and right, and short points on the diagonals. Hold [[Shift]] and add six more stars of different sizes, from about 40 px across to about 100 px. The two biggest are at about `720, 150` and `1180, 640`. Leave the top-left corner empty for the badge.
4. Choose **View → Fit to Screen** to see the whole cover again.
5. Fill with `#F7EEDB`, deselect and turn **Snap to Guides** back on.

These sparkles were everywhere in 1950s design, on boomerang tables and atomic clocks alike. Keep them sparse so they decorate the sky without cluttering it.

## Add a scalloped edge

![A row of circular marquees along the horizon intersected with a thin band below it, leaving a row of half-circle scallops](21-scallop-selection.webp)

1. Click **Sky**, then click **Add Layer** and rename it `Scallops`.
2. Turn off **Snap to Guides** and zoom in on the horizon. With the **Elliptical Marquee**, draw the first 60 px circle from `-30, 920` to `30, 980`, so its centre sits on the left edge of the canvas at the horizon. Hold [[Shift]] and add the next circle from `30, 920` to `90, 980`, and keep going every 60 px. It takes 26 circles to reach the right edge.
3. Switch to the **Rectangular Marquee**, hold [[Shift]]+[[Alt]] and drag a band from just left of the canvas at `y 950` to just right of it at `y 990`. Shift+Alt intersects, so only the lower half of each circle is left.
4. Fill with `#143A3F`, deselect and turn **Snap to Guides** back on.

The scallops look like the awning of a drive-in or a hi-fi showroom, and they make a decorative border between the picture and the title band.

## Set the title

![The word XANADU in huge black Jost ExtraBold capitals spanning exactly from the left margin guide to the right margin guide, with its bottom at y 1330](22-xanadu.webp)

1. Set the foreground colour to `#2A2420` and pick the **Text** tool (`T`).
2. Click in the empty cream space near the bottom of the canvas. Before you type, set **Size** to `250` in the options bar and pick **Jost** from the font list, with weight **ExtraBold**.
3. Open the **Text** panel (the **T** button on the right-hand toolbar) and set **Letter spacing** to `38`.
4. Type `XANADU` and press [[Tab]] to commit.
5. Pick the **Move** tool and drag the word up so its left edge sits on the `x 100` guide and its bottom is at `y 1330`. Use the arrow keys for the last few pixels.

The text layer lands just above **Scallops** in the Layers panel, because that layer was selected. That's fine: nothing above it in the stack overlaps the title band.

With 38 px of letter spacing the word runs from margin to margin. If yours falls short or overshoots, adjust the letter spacing in the Text panel.

## Add the band name and catalogue number

![Two small tracked lines of Josefin Sans Bold sitting on the y 1380 guide: THE KUBLA KHAN QUINTET at the left margin and STEREO XLP-1959 at the right margin](23-info-line.webp)

1. With the **Text** tool, click in empty space below the title. Set **Size** `34`, font **Josefin Sans**, weight **Bold** and **Letter spacing** `9`. Type `THE KUBLA KHAN QUINTET` and press [[Tab]].
2. Move it so its left edge is on the `x 100` guide and the bottoms of the letters sit on the `y 1380` guide.
3. Click in empty space again and type `STEREO  XLP-1959` (two spaces after STEREO). The size, font and spacing carry over. Press [[Tab]].
4. Move it so its right edge is on the `x 1400` guide and it sits on the same baseline.

Lining both lines up with the title's edges and leaving 120 px below them gives the band a firm, deliberate bottom edge.

## Write Atomic in script and tilt it

![The word Atomic in orange Yellowtail script above the left end of XANADU, with the Move tool's tilted transform box around it after rotating it by about 6 degrees counter-clockwise](24-atomic-rotating.webp)

1. Set the foreground colour to `#D4572A`. With the **Text** tool, click in empty space and set **Size** `160`, font **Yellowtail**, weight **Regular** and **Letter spacing** `0`. Type `Atomic` and press [[Tab]].
2. With the **Move** tool, drag it so its left edge sits on the `x 100` guide, above the X of XANADU.
3. Drag the round rotation handle at the top-left corner of its box counter-clockwise by about 6°, so the script climbs to the right. Press [[Cmd+D]].
4. The script is a little too tall for the gap between the scallops and XANADU. In the Text panel, lower **Size** to `142`. The rotation is kept, so you can resize live text at any time. Nudge the word so it sits about 20 px above XANADU and clear of the scallops.
5. Open its **Layer effects** and add a **Drop Shadow** with **Offset X** `6`, **Offset Y** `6`, **Blur** `0`, **Spread** `0`, **Opacity** `100` and colour `#143A3F`.

Letter spacing carries over from the last text layer you made, so setting it back to `0` in step 1 matters: connected script falls apart with any extra space between the letters.

## Add the tagline and a pencil hairline

![The type lockup: Atomic in orange script with a dark teal shadow, a thin black hairline running to the right from the end of the word, and EXOTIC SOUNDS FOR THE ATOMIC AGE in small tracked capitals ending on the right margin](25-tagline-rule.webp)

1. Set the foreground colour to `#2A2420`. With the **Text** tool, click in empty space and set **Size** `24`, **Josefin Sans Bold**, **Letter spacing** `6`. Type `EXOTIC SOUNDS FOR THE ATOMIC AGE` and press [[Tab]].
2. Move it so its right edge is on the `x 1400` guide and the bottoms of its letters sit at about `y 1085`, level with the lower half of Atomic.
3. Select **Atomic**, click **Add Layer** and rename it `Rule`.
4. Pick the **Pencil** (`N`) and set **Size** to `3`. Click just after the c of Atomic, level with the middle of the tagline's letters. Then hold [[Shift]] and click just before the E of EXOTIC to draw a straight line between the two points.

The hairline fills the gap between the script and the tagline, so the two read as one line. It's a classic mid-century lockup.

## Draw the HI-FI badge

![A round orange badge with a thick cream outline in the top-left corner of the sky, with HI-FI in cream Righteous capitals centred inside it](26-badge.webp)

1. Click **Far Minaret** in the Layers panel, then click **Add Layer** and rename it `Badge`.
2. Pick the **Shape** tool (`U`) and set **Shape** to **Ellipse**. Click the **Fill** swatch and enter `#D4572A`. Click the **Stroke** swatch, enter `#F7EEDB` and set **Width** to `7`.
3. Shapes grow from where you press, so press at `196, 196`, the centre of the badge, and drag out to `292, 292`.
4. Set the foreground colour to `#F7EEDB`. With the **Text** tool, click in empty sky, set **Size** `54`, font **Righteous**, **Letter spacing** `2`, type `HI-FI` and press [[Tab]].
5. Move it into the badge so it is centred left to right and sits a little above the middle.

## Draw a curved path for the small print

![The Pen tool drawing a smile-shaped curve inside the lower half of the badge, with three anchors and a pair of handles on the bottom anchor](27-pen-arc.webp)

1. Pick the **Pen Tool** (`P`).
2. Click just inside the badge's left edge, a little below the middle, at about `131, 207`.
3. At the bottom of the badge, at about `196, 262`, press and drag about 40 px to the right before releasing. This makes a smooth anchor, so the path curves.
4. Click the matching point on the right, at about `261, 207`.
5. Click the **✓ Commit path** button in the options bar. The path is saved as **Path 1**.

## Set LONG PLAYING on the path

![The words LONG PLAYING in small cream capitals following the curve along the bottom of the badge, centred under HI-FI](28-text-on-path.webp)

1. With the **Text** tool, click in empty sky, set **Size** `15`, **Josefin Sans Bold**, **Letter spacing** `2`, type `LONG PLAYING` and press [[Tab]].
2. With the new text layer still selected, open the **Path** dropdown in the options bar and pick **Path 1**. The letters jump onto the curve.
3. Set **Align** to **Center** so the words sit evenly along the arc.

> **Tip:** If the last letters go missing, the text is longer than the path. Text on a path is cut off at the path's end, so draw a longer arc or make the type smaller.

## Group the badge and give it a shadow

![The finished badge with a hard dark teal shadow to the lower right, grouped as HiFi Badge in the Layers panel](29-badge-grouped.webp)

1. Select **LONG PLAYING**, Shift-click **Badge**, and choose **Layer → Group Layers**. Rename the group `HiFi Badge`.
2. Open the **Layer effects** for **Atomic** and click the copy button on the **Drop Shadow** row (**Copy Drop Shadow effect**). Close the drawer.
3. Click the arrow beside **HiFi Badge** to expand the group, open the **Layer effects** for **Badge** and click **Paste effects**. Only the drop shadow is pasted, with the same settings as Atomic.

## Add film grain over everything

![The whole cover with a fine monochrome grain overlay, most visible in the flat cream and teal areas, on a layer named Grain at the top of the stack](30-grain.webp)

1. Select the **Atom** group and click **Add Layer**. Rename the new layer `Grain`. It sits at the top of the stack.
2. Set the foreground colour to mid-grey `#808080`, press [[Cmd+A]], choose **Edit → Fill** and press [[Cmd+D]].
3. Choose **Filter → Add Noise...**, set **Amount** to `30` and click **Mono** and **Gaussian**. Click **Apply**.
4. Set **Grain** to the **Overlay** blend mode at `60%` opacity.

Overlay leaves mid-grey invisible, so only the noise shows. It roughens every flat colour at once, like ink on uncoated board.

## Warm it up with a Photo Filter

![The Group Adjustments drawer open on the Project group with a Photo Filter in warm orange at density 14, and the whole cover slightly warmer and more yellow](31-photo-filter.webp)

1. Choose **Layer → Adjustment Layer…**. Lopsy explains that adjustments live on the Project group and opens the **Group Adjustments** drawer. Click **Got it**.
2. Click **Add Adjustment** and choose **Photo Filter**.
3. Set the **Filter color** to `#E8901C` and **Density** to `14`. Close the drawer.

The warm filter yellows the cream and nudges the teal toward green, like an old sleeve that has sat in the sun.

## Pick out STEREO in orange

![The STEREO XLP-1959 line being edited with the Text tool, the word STEREO highlighted and recoloured orange while XLP-1959 stays black](32-recolor-stereo.webp)

1. With the **Text** tool, click inside the `STEREO  XLP-1959` line to edit it.
2. Press [[Home]], then hold [[Shift]] and press [[→]] six times to select the word STEREO.
3. Click the **Text color** swatch in the options bar and enter `#D4572A`. Press [[Esc]] to close the picker, then [[Tab]] to commit.

Only the selected letters change colour. The orange echoes Atomic at the top of the band and ties the two corners together.

## Export the cover

![Lopsy with the finished Atomic Xanadu cover at fit-to-screen zoom and the guides hidden, showing the Grain layer, the Atom and HiFi Badge groups and the building layers in the Layers panel](33-finished-in-editor.webp)

1. Turn off **View → Show Guides** to check the cover without them.
2. Choose **File → Quick Export PNG** to save a 1500 × 1500 PNG.
3. Choose **File → Save Project** to keep a `.lopsy` file with every layer, mask, path and live text layer, so you can change the band name or the colours later.

For a different record, change the words and keep the structure: a single strong symbol radiating light, a scalloped edge, and a script-plus-capitals lockup on a paper band.
