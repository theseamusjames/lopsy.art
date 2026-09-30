---
title: Liquid Metal Magazine Cover with a Melting Gold Sun
description: Design a science-magazine cover with a molten gold sun built from Clouds, Solarize and Liquify, plus chrome drip type in Lopsy.
published: 2026-09-30 21:30
updated: 2026-09-30
level: Intermediate
duration: 75
tags: liquid metal, magazine cover, liquify, filters, gradients, typography, blend modes
related: liquid-chrome-text-billboard, chrome-sci-fi-magazine-cover
cover: cover.jpg
coverAlt: Lopsy editor showing the finished HELIOS magazine cover with a melting liquid-gold sun above the gold headline YELLOW DWARF
finished: yellow-dwarf-finished.webp
finishedAlt: Finished HELIOS magazine cover, a swirling liquid-gold sun dripping molten drops onto the chrome headline YELLOW DWARF on a deep indigo sunburst background
---

This tutorial builds an editorial cover for a fictional science monthly, *HELIOS*. The cover story is "Yellow Dwarf", about our Sun, told in a **liquid-metal** style. Everything is made in Lopsy with no photos:

- The sun is a Clouds texture folded into chrome bands with Solarize, tinted gold with a **Hard Light** layer, then swirled and melted with **Liquify**.
- The type uses a Didone masthead, an Anton headline with a chrome gradient and three drips, and a column of condensed cover lines.

The document is **1275 × 1650 px**, US Letter at 150 dpi.

## Paint a night-sky background with a sunburst

![A deep indigo gradient background with an orange radial glow and soft sunburst rays centred in the upper half](01-night-sky-sunburst.webp)

1. Create a **1275 × 1650** document.
2. Pick the **Gradient** tool. Click **Advanced…** and set four stops:
   - `#04051A`
   - `#17164A` at 50%
   - `#231A52` at 78%
   - `#06051A` at 100%
3. Drag a **Linear** gradient from the top edge to the bottom edge on the Background layer.
4. On a new **Glow** layer, drag a **Radial** gradient from the sun's centre, about 820 px out. Use stops fading from orange `#F0A030` to fully transparent indigo. Set the layer to **Screen**.
5. Add a **Rays** layer. Set the foreground to `#8A5418`, then run **Filter → Sunburst…** with these settings:
   - Rays 40, Width 22, Taper 70, Fade 85, Softness 40
   - Centre X 55.5, Centre Y 32.1
   - Jitter 35
6. Set the Rays layer to **Screen** at 45% opacity.

Small type will sit on the left and at the bottom, so clear the rays there. Marquee each area, run **Select → Feather** (60–70 px) and press [[Delete]]. That keeps the rays from buzzing behind the cover lines.

## Fold clouds into metal bands

![A grey circle of solarized cloud texture with sharp black and white folds, the elliptical marquee still active](02-solarized-cloud-folds.webp)

1. Make a group called **Sun** and add a **Sun Gold** layer inside it.
2. With the **Elliptical Marquee**, draw a 720 px circle at the canvas centre and fill it with `#D9A020`.
3. On a new **Sun Metal** layer above it, fill the same circle with mid-grey `#808080`. Keep the selection active and run:
   - **Clouds** (Scale 3), then **Gaussian Blur** 14.
   - If the result looks mostly dark, run **Invert**.
   - **Solarize** 128, then **Brightness/Contrast** +45 brightness and +75 contrast.
   - **Solarize** 150, then **Brightness/Contrast** +35 brightness and +60 contrast.

Each Solarize folds the bright half of the tones back down. Two passes turn soft clouds into the looping bands you see on liquid chrome.

> **Tip:** Clouds is random every time. If one big region comes out flat, undo back to the grey fill and run the chain again. You want the tones spread evenly from black to white.

## Tint the folds gold with Hard Light

![The folded texture now rendered as bright gold chrome with near-black and near-white bands over the gold disc](03-hard-light-gold.webp)

1. Run **Gaussian Blur** 2 and **Brightness/Contrast** +35 contrast for crisper bands.
2. Set **Sun Metal** to the **Hard Light** blend mode. The grey bands now multiply and screen the gold disc underneath, giving near-black troughs and near-white crests.
3. Select **Sun Metal** and run **Layer → Merge Down** to bake it into the gold. Rename the result **Sun Core**.
4. Run **Surface Blur** (radius 8, threshold 35) to smooth the mottling.
5. Run **Lens Distortion** (strength 65) to bulge the bands toward the centre.

## Swirl the metal with Liquify

![The Liquify panel in Twirl mode with the gold sphere's bands swirled into a spiral](04-liquify-twirl.webp)

Open **Filter → Liquify…**:

1. Choose **Twirl CW**, set the brush to 260 and the pressure to 60. Circle the mouse twice in small loops left of centre.
2. Switch to **Twirl CCW** with the brush at 240 and loop twice below-right of centre.
3. Add one smaller clockwise twirl (brush 180) near the top.

Keep the twirl centres well inside the disc. A twirl that reaches the edge drags the silhouette into a dented blob.

## Pull drips with Liquify Push

![The Liquify panel in Push Forward mode with four long drips pulled down from the bottom of the gold sphere](05-liquify-drips.webp)

Stay in Liquify and switch to **Push Forward** at 85% pressure. For each drip, start just inside the bottom edge and drag straight down about 110 px. Repeat, starting each pass about 34 px lower, so the drip keeps growing.

Give the four drips different lengths (2–5 passes) and brush sizes (60–80) so they don't look stamped. Click **Apply**.

## Shade the sphere and add window highlights

![The finished gold sun with rim shading, sharp curved window highlights at the upper left and glossy streaks down each drip](06-shaded-sphere.webp)

Add these layers inside the Sun group:

- **Sun Shade**
  1. ⌘-click the Sun Core thumbnail to load its shape.
  2. Drag a radial gradient from the upper left. It stays clear to about 60%, then goes brown and dark at the rim.
  3. Remove the shading from the drips: select a circle slightly smaller than the sphere, run **Select → Inverse**, **Feather** 30 and press [[Delete]].
  4. Set the layer to **Multiply**.
- **Sun Spec**
  1. Lasso thin crescent bands that follow the curve of the sphere at the upper left.
  2. **Feather** each one 2 px and fill it with `#FFF8E0`.
  3. Add one small dot highlight.

  Curved window reflections sell a sphere far better than a blurry oval.
- **Drip Light**
  1. Fill the Sun Core shape with `#E0A030`.
  2. Delete everything above the drips through a 45 px feathered selection.
  3. Set the layer to **Screen** at 40% so the drips match the bright ball.
- **Drip Glints**: add tapered vertical streaks down each drip, one bright and the rest thinner, plus a tiny hard white glint near each drip's bulb.

Finally, give Sun Core a dark **Inner Glow** (`#3A2200`, size 40) to deepen the edge.

## Tuck the sun in front of the masthead

![The HELIOS masthead in cream Didone capitals with the gold sun overlapping the lower part of the I and O](07-masthead-overlap.webp)

1. Type **HELIOS** in **Abril Fatface** at 321 px, cream `#F4E9D0`, on a layer *below* the Sun group. It should span the 60 px margins (x 60–1215, top at y 70).
2. Select the **Sun** group and use the **Move** tool to drag everything into place. The group moves as one, and undo and redo move it back exactly.
3. Position the ball so it covers the lower part of the **I** and **O** but leaves the **L**'s foot readable. Otherwise the name reads "HEI IOS".
4. Put a separate **Halo** layer under the masthead: a 60 px-feathered orange disc on **Screen** at 45%. Delete its top 290 px through a feathered selection so the cream letters keep their contrast.
5. A soft dark **Drop Shadow** on the masthead helps too.

## Duplicate falling drops with copy, paste and scale

![Zoomed view of the drips with teardrop droplets under each tip, one selected with transform handles while being moved](08-falling-drops.webp)

1. On a **Droplets** layer, build one teardrop: a circle plus a small lassoed triangle on top.
2. ⌘-click the layer's thumbnail and give it a radial gradient from `#FFF4D0` through gold to `#4A2E08`, lit from the upper left. Add a white dot highlight.
3. Marquee the drop, then press [[Cmd+C]] and [[Cmd+V]].
4. Marquee the pasted drop and ⌘-drag a corner handle to scale it (70–86%). Press [[Cmd+D]] to commit, then nudge it under the next drip tip with the arrow keys.
5. Run **Layer → Merge Down** to fold it back into Droplets.

Leave 20–30 px between each tip and its drop. For one drip, draw a drop still attached by a thin neck.

> **Tip:** To adjust a drop after merging, marquee just that drop and drag it with the **Move** tool. Only the selected pixels move.

## Chrome the headline and drip three letters

![YELLOW DWARF in tall Anton capitals with a gold chrome gradient and horizon band, drips on the Y, D and F, above a two-line serif deck](09-chrome-headline.webp)

1. Type **YELLOW DWARF** in **Anton** at 206 px so it spans the margins exactly. Then click **Rasterize Layer**.
2. ⌘-click its thumbnail and drag a vertical linear gradient over the cap height with these stops:
   - `#FFF6D0` → `#F6C850` at 22% → `#B8740E` at 46%
   - a dark horizon line at `#2A1003` 50%
   - `#7A3E08` at 57% → `#F2B838` at 78% → `#FFE9A8` at 100%
3. Use **Liquify → Push** with a 36 px brush to pull drips from the **Y**, the **D**'s stem and the **F** only. Keep the L's and W clean so the word stays legible.
4. Add a 3 px dark **Stroke** and a soft **Drop Shadow** (offset Y 10, blur 14, 75%).
5. Set the two-line deck in **Instrument Serif** at 46 px. Centre each line with **Align center horizontally**, about 40 px below the drips.

## Set the cover lines on a strict left edge

![The left column of three stat blocks, 4.6, 200× and 8:20, in gold condensed numerals with cream labels and lavender serif captions, plus the folio line at the top](10-cover-lines.webp)

Each cover line is a stack:

- a gold **Barlow Condensed ExtraBold** number at 118 px
- a cream **Barlow Condensed SemiBold** label at 30 px
- a two-line **Instrument Serif** caption at 31 px

Set the caption's **Line height** to 1.16 in the Text panel *before* you create it (about 36 px leading). Place every block at x 60, on a 240 px vertical rhythm.

Add the folio line in **IBM Plex Mono** 20 px at the top margin (y 40). The right-hand line should end exactly on x 1215.

> **Tip:** Create new text in an empty part of the canvas, then move it into place. A click inside another text layer's box edits that layer instead.

## Add a rotated Solar Maximum badge

![A cream badge with a gold ring overlapping the sphere's right edge, its SOLAR MAXIMUM 2026 label rotated with transform handles visible](11-rotated-badge.webp)

1. Make a **Badge** group:
   - a 176 px cream `#F3E6CC` disc
   - a gold `#C99A2E` ring: fill a circle, then **Select → Shrink** 3 and delete
2. Before creating the label, set **Align center** and **Line height** 1.05 in the Text panel.
3. Drag an area-text box and type **SOLAR / MAXIMUM / 2026** in Barlow Condensed ExtraBold at 32 px. Nudge it until the ink is centred in the ring.
4. **Rasterize** the label.
5. Marquee it, then drag the Move tool's rotation handle about −10° and press [[Cmd+D]].

Let the badge overlap the sphere's edge, like a sticker on the photo, with its right edge on the 1215 px margin.

> **Tip:** Rasterize text before you rotate it. A rotated live text layer loses its rotation the next time you change its size or text.

## Finish the bottom band, barcode and grain

![The complete HELIOS cover with the ALSO INSIDE band and a barcode at the bottom, film grain and a soft vignette](12-bottom-band-barcode.webp)

1. Set **ALSO INSIDE** in gold Barlow Condensed at 26 px. Under it, add two lines of 30 px Instrument Serif ending on y 1590.
2. For the barcode, turn on **View → Show Grid** at 4 px with **Snap**. Marquee a cream box whose top lines up with the ALSO INSIDE caps and fill it. Turn Snap off, then fill thin bars of varying widths. Add the digits in IBM Plex Mono 13 px.
3. Add a **Grain** layer on top: fill it grey, run **Add Noise** (40, Mono, Gaussian), set it to **Overlay** at 22%.
4. Finish with a root **Vignette** adjustment (35).

Export with **File → Quick Export PNG**.
