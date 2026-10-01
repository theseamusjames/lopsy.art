---
title: Make a Chrome Heart Valentine's Day Card
description: Build a glossy chrome heart pierced by a glowing lightning bolt in Lopsy, with gradients, Shrink, layer effects, a masked Sunburst and chrome script type.
published: 2026-09-30 06:00
updated: 2026-09-30
level: Intermediate
duration: 75
tags: valentines card, holiday card, chrome, gradients, layer effects, lightning, typography, selections, greeting card, neon
related: liquid-chrome-text-billboard, chrome-sci-fi-magazine-cover, neon-glow-text-effect
cover: cover.jpg
coverAlt: Lopsy editing the finished Valentine's card, a rosy chrome heart pierced by a glowing cyan lightning bolt on a black-cherry sunburst, with the script headline You're Electric under it
finished: finished-electric-valentine.webp
finishedAlt: The finished Valentine's Day card. A glossy pink chrome heart with a dark curved horizon reflection and white window glints sits on a black-cherry background with soft magenta sunburst rays. A cyan lightning bolt enters through the left edge of a thin double pink frame, passes behind the heart and bursts out of its lower right with glowing cracks and a white star flare. BE MY VALENTINE is set in tracked capitals at the top, the chrome script You're Electric sits below the heart, and XOXO between two small lightning bolts sits at the bottom.
project: chrome-heart-valentine-card.lopsy
---

Chrome lettering and chrome hearts are all over Valentine's merch right now. The Y2K "liquid metal" look is back.

Chrome is easier to fake than it looks. A polished surface just reflects its surroundings, so you paint a **sky** (light, getting darker toward the horizon), a hard **horizon line**, and a **ground** (dark at the horizon, lighter toward you). Add a few hard white window reflections and the eye reads metal.

In this tutorial you'll make a 5 × 7 card, *You're Electric*: a rosy chrome heart with a cyan lightning bolt through it.

Along the way you'll use:

- the **Lasso** and **Select → Shrink / Inverse / Feather / Grow**
- the **Gradient** tool with the Advanced gradient editor
- **Filter → Sunburst**, **Add Noise** and a gradient **layer mask**
- **Outer Glow**, **Inner Glow**, **Stroke** and **Drop Shadow** effects
- copy and paste, the rotate handle, the Move tool's **Flip Horizontal** and **Merge Down**
- the grid with Snap, a guide, and **Group Layers**
- the Google fonts **Michroma** and **Pacifico**

The palette:

- black cherry `#14040C`, magenta glow `#9A1646`
- rosy chrome `#FFFFFF` → `#F48AB4` → `#2A0614` (white through pink to near-black)
- electric cyan `#3FE8FF` (with a white core)
- blush pink `#FFC7DB` (small type), frame pink `#FF9EC2`

## Make the canvas and a velvet glow

![Lopsy with a 1500 by 2100 document showing a black-cherry background and a soft magenta radial glow in the middle](01-velvet-glow.webp)

Create a **1500 × 2100 px** document (**File → New**, unit **Pixels**). That's a 5 × 7 inch card at 300 ppi.

1. Select the **Background** layer, set the foreground to `#14040C`, and choose **Edit → Fill**.
2. Rename **Layer 1** to *Glow*. Pick the **Gradient** tool, set **Type** to **Radial**, and open **Advanced…**.
3. Set three stops: `#9A1646` at 0, `#5A0C2A` at 55% (opacity 55%), and `#14040C` at 100% with opacity 0.
4. Press on the spot where the heart will go, centred left to right and a little under halfway down, and drag straight down almost to the bottom edge, holding [[Cmd]] to keep it vertical.

## Burst rays with the Sunburst filter

![The Sunburst filter dialog open over the canvas with Preview on, showing pink rays radiating from just above the centre](02-sunburst-rays.webp)

Click **Add Layer** and name the new layer *Rays*. Set the foreground to `#FF6FA0` and choose **Filter → Sunburst…**. Tick **Preview** so you can see it.

Use these settings:

- **Rays** 36, **Length** 95, **Width** 42, **Taper** 0
- **Fade** 90, **Softness** 18, **Rotation** 3
- **Center X** 50, **Center Y** 43.8 (the rays should fan out from behind the heart)
- **Jitter** 35, **Seed** 214, **Opacity** 60
- **Gaps**: **Keep Layer**

Click **Apply**. Then click the **✦** (**Layer effects**) button on the *Rays* row and set the blend mode at the top of the drawer to **Screen**. Click the row's opacity readout and set it to **30%**.

## Fade the rays with a layer mask

![The Rays layer in mask edit mode with a blue overlay across the bottom of the canvas where the gradient mask hides the rays](03-rays-layer-mask.webp)

The rays will sit behind the headline later, so fade them out toward the bottom.

1. With *Rays* selected, click **Add Mask** in the Layers panel footer, then click the new mask thumbnail to edit the mask.
2. With the **Gradient** tool, set a **Linear** gradient from white to `#8C8C8C`.
3. Drag from a little below the middle of the card (about 60% of the way down) to about seven-eighths of the way down. Hold [[Cmd]] while you drag to keep it vertical.

The blue tint is Lopsy's mask-edit overlay. It disappears when you click the layer row again.

## Lasso the lightning bolt

![A cyan lightning bolt filled on its own layer, zig-zagging from the left edge of the canvas down to the lower right, with its lasso selection still showing](04-lasso-lightning-bolt.webp)

Add a layer called *Bolt Back*. With the **Lasso**, press and drag around the outline of a jagged bolt, then release to close it:

- It enters from just off the **left edge**, a little below the top of the card, and runs down and to the right to a sharp tip about four-fifths of the way across and two-thirds of the way down.
- Make it about 70 px wide at the tail, tapering to the tip.
- Put two sharp zig-zags near the tail and two near the tip, and leave the middle straight. That part will be hidden behind the heart.

Start the drag on the canvas, not over the ruler: a click on the ruler adds a guide instead.

Fill it with `#3FE8FF` (**Edit → Fill**). Keep the selection.

## Give the bolt a white-hot core

![The bolt now has a white core inside a thin cyan edge and a soft cyan outer glow over the sunburst](05-bolt-core-and-glow.webp)

With the bolt still selected, choose **Select → Shrink…** and shrink by **9 px**.

Then drag a **Linear** gradient along the bolt from its tail to its tip, with stops `#FFFFFF` → `#F2FFFF` (70%) → `#BDF6FF`. Only the shrunken core is filled, so a thin cyan edge stays around it.

Deselect with [[Cmd+D]]. Click the **✦** button on the *Bolt Back* row and turn on **Outer Glow**: colour `#1FD6FF`, **Size** 55, **Spread** 14, **Opacity** 95.

## Build the heart's bevelled rim

![A dark heart with a thin bright pink-and-white rim between two black keylines, sitting over the bolt](06-heart-rim-bevel.webp)

Click *Bolt Back*, then click **New Group** and call it *Heart*. Add a layer inside it called *Heart Rim*.

Lasso a heart about two-thirds as wide as the card (roughly 960 px) and a little less tall (roughly 870 px), centred left to right, with the tops of its lobes just under a quarter of the way down. The bolt should run behind its upper left. Round lobes and a sharp tip matter more than exact numbers.

> **Tip:** [[Cmd]]-click the middle of the top ruler first to drop a guide exactly at the centre (1/2). It makes it much easier to draw both lobes the same size.

Now build the rim in three passes, keeping the selection active between them:

1. Fill the heart with `#1A0610` for a dark outer keyline.
2. **Shrink** by **4 px**, then drag a vertical gradient over the whole heart, from the top of the lobes to the tip: `#FFFFFF` 0, `#F7B5CF` 45%, `#8A1E48` 52%, `#F0A0C0` 60%, `#FFE9F2` 100%.
3. **Shrink** by **9 px** more and fill with `#2A0614`. This leaves a bright bevel between two dark lines.

## Paint the sky reflection

![The top of the heart face filled with a vertical gradient from white through pink to deep cherry, with the lower half still dark](07-sky-reflection.webp)

Add a layer called *Sky*. Load the heart shape again: [[Cmd]]-click the *Heart Rim* thumbnail, then click the *Sky* row so the selection is ready to paint into. **Shrink** it by **17 px** so the face sits inside the rim. You'll load the face this way several more times.

Drag a vertical gradient from just inside the top of the lobes down to a little under halfway down the heart, with these stops:

- `#FFFFFF` 0
- `#FFE1EC` 35%
- `#F48AB4` 70%
- `#C2306A` 93%
- `#7A1238` 100%

(In a later step you'll darken the bottom of this sky further.)

Give *Sky* an **Inner Glow** in `#5A0F2E` (**Size** 34, **Opacity** 70). The edges darken slightly, which rounds the form.

## Cut a curved horizon

![A lasso selection following a gently curved horizon line across the middle of the heart, over a ground gradient that fills the whole face](08-curved-horizon-lasso.webp)

Add a layer called *Ground* above *Sky*. Load the face as before ([[Cmd]]-click the *Heart Rim* thumbnail, click the *Ground* row, **Shrink 17**), and drag a vertical gradient from slightly above where the sky gradient ended down to the tip:

- `#1A0610` 0
- `#3A0A1E` 12%
- `#9C2856` 45%
- `#E788AE` 80%
- `#FFE3EE` 100%

This covers the whole face for now.

Now lasso everything **above** the horizon, starting outside the heart. The horizon should follow the form: arch it gently over each lobe and dip it at the middle of the heart. Press [[Delete]].

A dead-straight horizon is what makes chrome look like a sticker.

## Add a glint on the horizon

![The finished horizon: a dark cherry ground under the curved line, a thin pale pink glint along the line, and a pink sky above](09-ground-and-horizon-glint.webp)

On the *Ground* layer:

1. Set the foreground to `#FFD6E6` and lasso a thin ribbon, about 6 px tall, just **above** the horizon line and a little wider than the face. Fill it.
2. To trim the ribbon's ends, load the face ([[Cmd]]-click the *Heart Rim* thumbnail, click the *Ground* row, **Shrink 17**), choose **Select → Inverse**, and press [[Delete]].

The bright line against the near-black ground is the strongest chrome cue on the whole card.

## Windows and a core shadow

![The chrome heart with two white window-pane reflections on each lobe and a soft dark shadow along the lower left inside edge](10-windows-and-core-shadow.webp)

Add a layer called *Core Shadow*. Lasso a crescent about 45 px wide just inside the **lower-left** edge, from the horizon down to the tip. Choose **Select → Feather…** with **18**, and fill with `#1A0610`. Trim it to the face with the same trick: [[Cmd]]-click the *Heart Rim* thumbnail, click the *Core Shadow* row, **Shrink 17**, **Select → Inverse**, [[Delete]]. Set the layer's opacity to **65%**.

Add a layer called *Windows*. Lasso two curved "window pane" bands on the upper left of the left lobe, following its curve. On the right lobe, lasso two smaller ones.

**Feather** each selection by **1 px** before you fill it white. That anti-aliases the edge without softening it; the reflections must stay hard.

Finally give *Heart Rim* a **Drop Shadow**: `#070003`, **Offset X** 10, **Offset Y** 26, **Blur** 40, **Opacity** 85.

## Copy the tip of the bolt

![A large rectangular lasso selection rotated to the bolt's angle, covering the lower right part of the bolt from just inside the heart edge to the tip](11-bolt-tip-selection.webp)

The bolt should look like it **pierces** the heart: behind it at the top left, bursting out of the front at the lower right.

1. Click *Bolt Back*.
2. With the **Lasso**, drag through four corners to make a big tilted box. Start it a little **inside** the heart, where the bolt comes out, with its top edge at right angles to the bolt, and let it cover everything down to the tip.
3. Press [[Cmd+C]], then [[Cmd+V]]. The pasted copy lands right above *Bolt Back* in the same place.

## Put the tip in front of the heart

![The bolt tip now drawn over the heart's lower right edge with its own cyan glow](12-bolt-in-front.webp)

Rename the pasted layer *Bolt Front*. Collapse the *Heart* group and drag *Bolt Front* by its grip until it sits **above** the group.

Pasting copies pixels, not effects, so add the same **Outer Glow** (`#1FD6FF`, **Size** 55, **Spread** 14, **Opacity** 95).

## Crack the chrome

![Thin glowing cyan cracks with dark edges radiating from the point where the bolt leaves the heart, with a white four-point star flare at the impact](13-cracks-and-flare.webp)

Expand *Heart* and click *Windows*. Add two layers above it: *Fissures* and *Crack Cores*.

1. On *Fissures*, lasso four tapered cracks that radiate from the point where the bolt leaves the heart, each with one side branch. Make them about 18 px wide at the root, narrowing to a point. Fill them `#14030A`.
2. On *Crack Cores*, lasso thinner copies (about a third of the width) along the same lines and fill them `#A8F9FF`.
3. Give *Crack Cores* an **Outer Glow**: `#1FD6FF`, **Size** 14, **Spread** 20, **Opacity** 100.

Then click *Bolt Front* and add a layer called *Flare*. At the exit point, lasso a four-point star with very thin points, about 150 px from tip to tip, plus a small circle in its middle, and fill them white. Give *Flare* the same cyan Outer Glow with **Size** 30 and **Spread** 16.

The flare hides the flat cut end of *Bolt Front*.

## Set the greeting

![BE MY VALENTINE set in pale pink tracked Michroma capitals centred at the top of the card](14-greeting.webp)

With a **raster** layer active (click *Flare*), pick the **Text** tool, choose **Michroma**, and set **Size** 58 and the colour `#FFC7DB`.

Click in empty space and type **BE MY VALENTINE**. Press [[Tab]] to commit, and rename the layer *Greeting*.

In the **Text** panel set **Letter spacing** to **16**. Then, with the **Move** tool, drag the line up so the tops of its capitals sit about 170 px from the top edge (check the left ruler), and click **Align center horizontally** in the options bar.

*BE MY VALENTINE* has no apostrophe, so the wide tracking doesn't open a hole the way *VALENTINE'S* would.

## Type the script headline

![You're Electric typed in white Pacifico below the heart, centred](15-script-headline.webp)

Click *Flare* again. **Don't start new type while a text layer is active:** changing the font or size would restyle that layer.

Choose **Pacifico**, **Size** 170, white, and type **You’re Electric** (with a curly ’). Commit it and rename the layer *Script*.

The Text panel still holds the greeting's letter spacing. Set it back to **0** for this layer. Then drag it so its top sits about three-quarters of the way down the card, a comfortable gap below the heart's tip, and click **Align center horizontally**.

## Load the script as a selection

![The rasterized script with marching ants tracing every letter after a Cmd-click on its thumbnail](16-script-alpha-selection.webp)

1. With *Script* selected, click **Rasterize Layer** in the Layers panel footer.
2. [[Cmd]]-click the layer's thumbnail. That loads the letters' alpha as a selection.
3. Click the *Script* row once more, even though it's already active, so the selection is settled before you paint into it.

## Chrome the script

![You're Electric now filled with a pink chrome gradient with a dark horizon band, a black outline, a pink glow and a drop shadow](17-chrome-script.webp)

With the **Gradient** tool, drag a vertical gradient from the top of the letters to the bottom of the descenders. Use the same horizon idea, with the horizon just under the x-height:

- `#FFFFFF` 0
- `#FFD0E2` 35%
- `#E4679A` 60%
- `#4A0C26` 63%
- `#2A0614` 66%
- `#B8336B` 80%
- `#FFE2EE` 100%

Deselect, then add three effects:

- **Stroke**: `#1A030C`, **Width** 5, **Position** outside
- **Outer Glow**: `#FF3D8B`, **Size** 30, **Spread** 8, **Opacity** 70
- **Drop Shadow**: `#050002`, **Offset X** 0, **Offset Y** 14, **Blur** 16, **Opacity** 80

## XOXO and a mini bolt

![XOXO in small Michroma capitals near the bottom with a tiny cyan lightning bolt to its left, selected with rotation handles](18-rotate-mini-bolt.webp)

With *Script* still active (it's a raster layer now), type **XOXO** in Michroma **47**, `#FFC7DB`, with **Letter spacing** 14, and rename the layer *XOXO*. Drag it below the script, roughly halfway between the script and the bottom edge, and click **Align center horizontally**.

Add a layer called *Mini Bolts*. Lasso a small classic bolt, about 27 px wide and 48 px tall, a little way to the left of the X, and fill it `#BFF8FF`.

To tilt it:

1. Draw a **Rectangular Marquee** around it and switch to the **Move** tool.
2. [[Cmd]]-drag the rotate handle (just outside the top-right corner) so it snaps to **−15°**.
3. Press [[Cmd+D]] to commit.

## Mirror it to the other side

![Two mirrored mini lightning bolts flanking XOXO at equal distances](19-mirror-mini-bolt.webp)

1. Marquee the mini bolt, press [[Cmd+C]] and [[Cmd+V]]. Marquee the pasted copy with the same rectangle.
2. Click **Flip Horizontal** in the Move tool's options bar, then press [[Cmd+D]].
3. Drag the copy to the right of **XOXO** so the gap between the bolt and the last O matches the gap on the left.
4. Choose **Layer → Merge Down** to fold the copy into *Mini Bolts*. Give that layer a cyan **Outer Glow** (`#1FD6FF`, **Size** 14, **Spread** 10, **Opacity** 90).

> **Tip:** To check the spacing, zoom in and compare the two gaps against the top ruler, then fine-tune the copy with the arrow keys (1 px per press).

## Scatter a few sparkles

![Three four-point sparkles in different sizes, one large at the upper right, with a soft pink glow](20-sparkles.webp)

Click *Flare* and add a layer called *Sparkles*. Lasso a few thin four-point stars and fill them white:

- one large one, about 115 px across, at the upper right
- two or three small ones in the empty space

Keep them well clear of the type. Give the layer an **Outer Glow** in `#FFB3D1` (**Size** 18, **Spread** 10, **Opacity** 85).

Resist adding more: identical sparkles scattered everywhere read as clip art.

## Snap a double frame to the grid

![The grid shown over the card with a centre guide and a rectangular marquee snapped to the grid 62 px inside the edges](21-grid-frame-marquee.webp)

Click the top layer (*Greeting*) and add a layer called *Frame*.

1. Choose **View → Show Grid** and set the **Grid** slider in the options bar to **8px**. Showing the grid turns **Snap** on too.
2. [[Cmd]]-click the middle of the top ruler to drop a guide exactly at the centre, if you didn't add one for the heart. Use it to check that the heart and every line of type are centred.
3. With the **Rectangular Marquee**, drag from near the top-left corner to near the bottom-right, leaving an even margin of about 60 px on every side; the corners snap to the grid. Set the foreground to `#FF9EC2` and choose **Edit → Fill**, then **Shrink 3** and press [[Delete]] to leave a 3 px outline.
4. Repeat two grid squares (16 px) further in on every side, with **Shrink 1**, for a hairline.

> **Tip:** To type the frames instead, deselect and click once with the Rectangular Marquee without dragging. Enter `62, 66` to `1438, 2034` for the outer frame and `78, 82` to `1422, 2018` for the hairline.

## Let the bolt break the frame

![The finished pink double frame with a gap cut where the lightning bolt crosses its left edge](22-bolt-breaks-frame.webp)

A bolt that sneaks behind the frame looks timid. Make it break through instead:

1. [[Cmd]]-click the *Bolt Back* thumbnail to load the bolt's outline, then click the *Frame* row. Clicking the row first matters: it makes the next [[Delete]] clear only the selection.
2. Choose **Select → Grow…** with **16**, then press [[Delete]].

The frame now stops short on both sides of the bolt. Hide the grid and choose **Edit → Clear Guides** when you're done.

## Add fine grain

![The card with a faint film-grain overlay across the whole surface](23-grain.webp)

Click *Frame* and add a layer called *Grain*.

1. Fill it with `#808080`.
2. Choose **Filter → Add Noise…** with **Amount** 40, **Mono** and **Gaussian**.
3. Set the blend mode to **Overlay** and the opacity to **22%**.

Mid-grey is invisible in Overlay, so only the noise shows. It takes the digital edge off the gradients without dirtying the chrome.

Finally, select the *Script*, *XOXO*, *Mini Bolts* and *Greeting* rows (click the first, [[Shift]]-click the last). Choose **Layer → Group Layers** and name the group *Type*. You can now move all the lettering as one piece.

## Darken the sky toward the horizon

![The heart's sky gradient re-drawn so it runs from white through pink into near-black cherry just above the horizon glint](24-darken-sky.webp)

Step back and look at the heart. If it reads as pink candy rather than metal, it needs darker darks.

Load the face again ([[Cmd]]-click the *Heart Rim* thumbnail, click the *Sky* row, **Shrink 17**) and redraw the *Sky* gradient over the same span as before, so it plunges almost to black just above the horizon:

- `#FFFFFF` 0
- `#FFE1EC` 30%
- `#EC7CA8` 60%
- `#8A1A48` 84%
- `#3A0A1E` 95%
- `#2A0614` 100%

Two small clean-ups at the same time:

- on *Sparkles*, marquee the small sparkle that crowded *BE MY VALENTINE* and delete it
- on *Flare*, trim the star's lower point, which ran down the bolt like a stray white sliver

## Kern the apostrophe

![A rectangular marquee around the word You in the script headline while it is nudged right toward the apostrophe](25-kern-apostrophe.webp)

Pacifico leaves a wide gap before the apostrophe, so *You're* reads as *You 're*.

1. On the *Script* layer, marquee just the word **You**.
2. With the **Move** tool, press [[Shift+Right]] once and [[Right]] twice to move it 12 px and close the gap. Press [[Cmd+D]].
3. Click **Align center horizontally** so the headline is centred again.

## Export the card

![Lopsy showing the finished chrome heart Valentine's card with the full layer stack in the Layers panel](26-finished-in-editor.webp)

Save the project with **File → Save Project**, then **File → Quick Export PNG** for print.

Things to try next:

- swap the bolt's cyan for gold to make an anniversary card
- change the words (*You Light Me Up*, *Zap!*)
- turn the bolt into Cupid's arrow; the pierce trick is the same
