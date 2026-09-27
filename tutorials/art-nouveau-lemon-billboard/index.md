---
title: Design an Art Nouveau Billboard
description: Make a Mucha-style Art Nouveau billboard in Lopsy with a lemon-wheel halo, whiplash vines, a Voronoi mosaic panel and outlined lettering.
published: 2026-09-26 17:10
level: Intermediate
duration: 75
tags: art nouveau, billboard, advertising, voronoi, pen tool, radial symmetry, layer effects, text effects, vintage
related: stencil-street-art-billboard, vaporwave-sunset-billboard, liquid-chrome-text-billboard
cover: cover.jpg
coverAlt: Lopsy showing the finished Lemon Elixir Art Nouveau billboard, a teal bottle in front of a lemon-slice halo wrapped in vines, beside yellow outlined lettering on a sage mosaic panel
finished: finished-lemon-elixir.webp
finishedAlt: The finished Lemon Elixir billboard. A teal bottle with an LE label stands in front of a giant lemon-slice halo ringed with dots, wrapped in whiplash vines with leaves and hanging lemons. On the right, yellow "Lemon Elixir" lettering with brown outlines and hard shadows sits on an arched sage mosaic panel, with a round Maison Citron medallion and a cream ribbon reading Sparkling Tonic of the Riviera
---

Around 1900, Alphonse Mucha and his contemporaries sold champagne, cigarettes
and biscuits with the same few devices:

- a figure in front of a huge decorated disc (the *nimbus*)
- whiplash plant stems
- mosaic grounds
- heavy outlined lettering

In this tutorial you'll use all of them in **Lemon Elixir**, a 2100 × 720
billboard for an imaginary lemon tonic. A teal bottle takes the place of the
Mucha figure, and the nimbus is a giant slice of lemon.

Along the way you'll use:

- Edit → Fill, guides and Select → Shrink
- the **Voronoi**, Brightness/Contrast, Hue/Saturation, Clouds and Add Noise filters
- **Radial Symmetry** on the Brush
- linear and radial gradients
- the **Pen** tool with **Stroke Path**
- a transform-handle stretch and a multi-layer nudge
- Stroke, Drop Shadow, Outer Glow and Inner Glow effects
- two Google Fonts: Metamorphous and Marcellus

Palette:

- cream paper `#EFE3C2`
- sage `#8FA079`
- lemon `#F2C230`
- teal glass `#2E6B6A`
- outline brown `#3B2A1E`

## Set up the paper and guides

![A 2100 by 720 cream document with guides at the frame margins and the panel divide](01-paper-and-guides.webp)

Choose **File → New**. Set **Unit** to Pixels, **Width** to `2100` and
**Height** to `720`, then click **Create**.

Select the Background, set the foreground to `#EFE3C2` and choose
**Edit → Fill**. Run **Filter → Add Noise** at `6` in **Mono** so the paper
isn't dead flat.

Click the rulers to drop guides:

- vertical guides at `40`, `745` and `2060` on the top ruler
- horizontal guides at `40` and `680` on the left ruler

The guide at 745 divides the illustration half from the lettering half.

## Break the panel into tesserae with Voronoi

![The Voronoi dialog with Cells 24, Edge Width 6 and Seed 17 previewing small mosaic tiles](02-voronoi-tesserae.webp)

Rename `Layer 1` to `Mosaic`. With no selection, fill the whole layer with
sage `#8FA079`, then run **Add Noise** at `22` in **Color**. The noise gives
every tile a slightly different tone.

Open **Filter → Voronoi…** and set **Cells** `24`, **Edge Width** `6` and
**Seed** `17`. Turn on **Preview** and click **Apply**.

> **Tip:** Cells counts cells along the *short* side of the layer, so 24 on a
> 720 px tall document gives tiles about 30 px across. Edge Width is scaled
> down on wide documents, so `6` draws roughly 2 px grout here.

Fill the whole layer first. Voronoi samples a colour at each cell centre, and
the cells need something to sample right up to the panel edge.

## Clip the mosaic to an arched cartouche

![The mosaic trimmed to a panel with a gently arched top, a dark outline and a thin cream keyline](03-arched-cartouche.webp)

Art Nouveau panels rarely have square tops. Use the **Lasso** to click out a
panel from `745` to `2040` across and down to `660`, with a shallow arch on
top: the corners sit at about `118` and the centre peaks at `62`. Choose
**Select → Inverse** and press [[Delete]].

On the Mosaic layer, open **Layer effects** and turn on **Stroke**: `#3B2A1E`,
Width `5`, **outside**.

For the keyline, add a layer named `Keyline`. Lasso the same arch 13 px
inside the panel and fill it cream `#F6ECD2`. Choose **Select → Shrink** by
`3` and press [[Delete]], which leaves a 3 px cream line.

## Soften the grout

![The mosaic after lowering contrast and restoring saturation: calm sage tiles with grey-green grout](04-soften-mosaic.webp)

Black grout fights the lettering. Select `Mosaic` and apply:

1. **Filter → Brightness/Contrast** with Brightness `10` and Contrast `-55`.
2. **Filter → Hue/Saturation** with Saturation `55` and Lightness `-4`, to
   bring the sage back.

The panel should now read as quiet texture rather than pattern.

## Draw the double frame

![A thick dark brown outer border and a thin inner rule, with gold dot ornaments at the corners and at the top and bottom centre](05-double-frame.webp)

Add a layer named `Frame`. Draw a rectangular marquee from `14,14` to
`2086,706` and fill it `#3B2A1E`. Choose **Select → Shrink** by `12` and press
[[Delete]] to leave a thick border.

Repeat with a marquee from `32,32` to `2068,688`, shrinking by `3`, for the
thin inner rule.

For the corner ornaments, fill three stacked ellipse marquees at each corner
of the inner rule:

- a dark 30 px circle
- a lemon `#F2C230` 18 px circle
- a dark 8 px centre

Add two smaller dots at the middle of the top and bottom rules.

## Build the nimbus with Radial Symmetry

![A dark disc inside a gold ring banded with 64 dark dots and tiny terracotta dots, with the symmetry centre marker showing](06-radial-dot-band.webp)

Select `Keyline` and click **New Group**. Name the group `Nimbus`, then add a
layer named `Halo` inside it. The halo is centred at `422, 360`. Fill these
concentric elliptical marquees:

- radius 306 in `#3B2A1E`
- radius 300 in gold `#D8C28A`
- radius 252 in `#3B2A1E`

Pick the **Brush** at Size `14` and Hardness `100`, then turn on
**Radial Symmetry** with `32` segments. [[Cmd]]-click the halo centre to move
the symmetry centre there. Click once on the gold band, 276 px right of
centre, then again one half-step around. That gives 64 evenly spaced dots.

Switch to Size `6` and terracotta `#B5654A`, and click between the dots.

## Slice the lemon wheel

![A lemon cross-section inside the halo: an orange rind, a cream pith ring and ten pale yellow segments with fine juice lines and a soft inner glow](07-lemon-wheel.webp)

Add a `Lemon Wheel` layer and fill three more circles: rind `#E3A91F` at
radius 247, zest `#F0C53A` at 236 and pith `#F8EFD0` at 226.

On a new `Segments` layer, lasso ten wedges in `#F6D65A`. Each one runs from
near the centre out to radius 214, with a 5 px pith gap on either side.

For the juice, set **Radial Symmetry** to `10`, [[Cmd]]-click the centre again
and drag three short strokes inside one segment:

- Size `5`
- Opacity `70`
- colour `#FCEBA8`

Symmetry copies them into every segment. Turn Radial Symmetry off, then add an
**Inner Glow** in `#FFF4C4` (Size `16`, Opacity `80`) so the segments look
juicy.

## Shape and stretch the bottle

![The teal glass bottle with a four-stop gradient, selected with transform handles while its top is dragged upward](08-bottle-stretch.webp)

Add a `Bottle` layer above `Segments`. Lasso a bottle silhouette centred at
x `422`: a narrow neck from `150` down to `290`, a sloping shoulder, and a
body about 224 px wide ending at `638`. Fill it with teal `#2E6B6A`.

Pick the **Gradient** tool and open **Advanced…**. Set four stops:

- `#1E4A48` at 0 %
- `#6FB2A6` at 26 %
- `#2E6B6A` at 50 %
- `#143534` at 100 %

Choose **Linear** and drag across the selection from left to right.

For a more elegant neck, switch to the **Move** tool and drag the top-centre
handle up from `150` to `104`. Press [[Cmd+D]] to commit.

## Add the cork, glints and label

![The bottle with a cream glow outline, a copper cork, white glass glints and an oval gold-and-cream label](09-bottle-label.webp)

Give the bottle two effects:

- **Stroke**: `#3B2A1E`, Width `4`, outside.
- **Outer Glow**: cream `#F6ECD2`, Size `9`, **Spread 100**, which makes a
  crisp cream band.

That cream band is the *cerne*, the light contour that poster artists used to
lift a figure off a busy background.

Build the rest from simple shapes:

- **Cork layer:** a copper `#9C5A38` rectangle with a rounded top and a gold
  foil band, with a 4 px Stroke.
- **Glint layer:** two soft white brush strokes at Opacity `45`.
- **Label layer:** four stacked ovals (dark, gold `#D9B865`, dark, cream).

## Set a monogram

![The oval label with an LE monogram set in Metamorphous, centred with arrow-key nudges](10-monogram.webp)

With the **Text** tool, set Size `54` and click in the label to type `LE`.
Measure the glyphs against the label centre and nudge with the arrow keys
until they sit dead centre.

This shot uses **Metamorphous**. In the final polish step it gets swapped for
**Marcellus**, because the uncial E read as "L€".

## Draw whiplash vines with the Pen

![A smooth Bezier path curving up the left side of the halo into a curl, with its anchors and handles shown](11-pen-path.webp)

Add a `Vines` layer under the bottle. Pick the **Pen** tool and
**click-drag** each anchor, so every point gets a smooth handle. The left vine
runs from `72,705` up through `132,520`, `122,330` and `182,150`, then curls
in at `312,110` and `284,158`.

Click the ✓ **Commit path** button. Set the foreground to olive `#3E4A24` and
click **Stroke Path** in the Paths panel with Width `9`. Draw a second vine up
the right side of the halo the same way.

## Add hair tendrils

![Both vines stroked in dark olive, with thin spiral tendrils near the bottom corners](12-vines-tendrils.webp)

Mucha's whiplash lines come in two weights. Add thin spiral tendrils with the
Pen and stroke them at Width `3`.

Start each tendril at its curled tip in empty canvas. If the first click lands
on an existing vine, it selects that path instead of starting a new one.

## Hang the leaves

![Twelve almond-shaped green leaves with dark midribs and outlines, attached along both vines](13-leaves.webp)

On a `Leaves` layer, lasso almond-shaped leaves in `#5E7F3A` (about 92 px
long). Place them along the vines, alternating sides at about 55° to the
stem. Keep every tip inside the inner frame.

Draw a 3 px midrib down each leaf with the Brush in `#3E4A24`, then add a
3 px outside **Stroke**.

## Paint the lemons

![Six shaded lemons: two hanging from each vine, joined by short stems, and two resting at the base of the halo](14-lemons.webp)

In the Gradient Editor, set stops `#FAE68E` → `#F2C230` at 45 % → `#C98E17`.
Switch the tool to **Radial**.

On a `Lemons` layer, lasso each lemon as an ellipse with a small nub at both
ends. Fill it `#F2C230`, then drag a radial gradient from a highlight at the
upper left out past the lower right. Make six:

- two hanging from each vine
- two lying at the foot of the halo

Brush a curved 4 px stem from each hanging lemon to its vine. Then give the
layer a 4 px outside **Stroke**, so the fruit matches the bottle's outline
weight.

## Fold a swallowtail ribbon

![A long cream banner across the bottom of the panel with darker notched tails and shaded fold triangles](15-folded-ribbon.webp)

Select `Keyline` and add a `Ribbon` layer. Build the banner back to front:

1. **Lasso the two notched tails** in shaded cream `#D9C79B`, dropped 16 px
   below the band.
2. **Lasso two small fold triangles** in `#A98E5E` where each tail tucks
   under the band.
3. **Fill the main band** with a rectangle from `880,556` to `1930,620` in
   `#F6ECD2`.

A 4 px outside **Stroke** outlines the whole banner.

## Set the headline

![Lemon set large in Metamorphous across the top of the panel, with Elixir right-aligned below it in bright yellow](16-headline.webp)

Set the headline in **Metamorphous**, a Google Font with organic,
Nouveau-style curves, in `#F2C230`:

- **Elixir** at Size `215`, right-aligned so its last letter ends at x `1985`,
  with its top at `343`.
- **Lemon** at Size `250`, starting at x `872`, with its top at `135`.

Type **Elixir** first. A new text click inside an existing text layer's
bounds edits that layer instead of creating a new one.

Staggering the two words leaves a pocket at the lower left for the medallion.

## Outline the lettering

![Lemon Elixir with thick dark brown outlines and a hard offset shadow, standing out against the mosaic](17-headline-effects.webp)

On both text layers, add these effects:

- **Drop Shadow**: `#3B2A1E`, offset `9, 9`, Blur `0`, Opacity `100`.
- **Stroke**: `#3B2A1E`, Width `6`, outside.

Together they give the classic poster look: a light fill with a heavy dark
contour and a printed shadow.

## Seat the tagline

![SPARKLING TONIC OF THE RIVIERA set in spaced Marcellus capitals, centred on the cream ribbon](18-tagline.webp)

Type `SPARKLING TONIC OF THE RIVIERA` in **Marcellus**, Size `36`, colour
`#3B2A1E`. In the Text panel, set **Letter spacing** to `7`.

Measure the glyph box and move it until its centre sits exactly on the band's
centre (`1405, 588`), with equal air above and below the caps.

## Add the Maison Citron medallion

![A round medallion in the pocket left of Elixir: a dotted cream ring around a yellow disc that reads Maison Citron, Est. 1897](19-medallion.webp)

On a `Medallion` layer centred at `1090, 445`, fill four circles:

- radius 100 in `#3B2A1E`
- radius 96 in cream
- radius 80 in `#3B2A1E`
- radius 77 in lemon

Add 24 dark dots on the cream ring with **Radial Symmetry**, and a hard
`7, 7` **Drop Shadow** to match the headline.

For the text, create a centred area-text block `Maison` / `Citron` in
Metamorphous. Add `EST. 1897` in Marcellus at Size `17` with letter spacing
`3`, and centre both in the disc.

## Add a lithograph grain

![The finished layout with a subtle mottled overlay that gives the paper and mosaic a printed texture](20-litho-grain.webp)

Select `Frame` and add a `Litho Grain` layer on top. Fill it with mid grey
`#808080`, run **Filter → Clouds** at Scale `14`, then **Add Noise** at `25`
in Mono.

Set the layer's blend mode to **Overlay** and its opacity to about `14%`. The
grey disappears, leaving a faint stone-litho mottle over everything.

## Polish the details

![The final billboard: a roman LE monogram, smaller medallion lettering, the ribbon lowered for more room under Elixir, and vine ends trimmed off the frame](21-polish.webp)

A last critique pass caught four small problems:

- **Medallion lettering:** it crowded the dotted ring, so drop `Maison Citron`
  to Size `29` and re-centre it.
- **Monogram:** switch `LE` to **Marcellus** so it can't read as "L€".
- **Ribbon spacing:** select the ribbon and tagline together
  ([[Shift]]-click the second row) and press [[↓]] ten times, which gives
  `Elixir` room above the banner.
- **Vine ends:** on `Vines`, marquee the strip just above the bottom rule and
  press [[Delete]] so no stem touches the frame.

Check your history with a few undos and redos. Every step here undoes and
redoes pixel-exactly. Then export with **File → Quick Export PNG**.
