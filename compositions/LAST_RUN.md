# Composition: Sacred Decadence (Rococo Zine Cover) — refined

**Date**: 2026-05-20
**Branch**: `claude/run-composition-skill-oY1bV`
**Test file**: `e2e/composition-sacred-decadence.spec.ts`
**Style**: rococo  •  **Project type**: zine cover  •  **Topic letters**: s + d

## Refinements over v1

Critique-driven second pass addressing legibility, asymmetry, palette
tension, and ornament density:

- **Soft radial gradient** instead of hard-edged pink ellipse — 12
  concentric circles with pink→cream falloff.
- **Off-centre cartouche** (cx 360 / cy 640, was 400/600), with mass
  counterweighted by scrollwork in the upper-right + lower-left.
- **Verdigris-teal accent** as a saturated middle ring inside the
  cartouche and inset in every corner medallion — the single saturated
  chord punctuating the all-pastel palette.
- **S&D gilt monogram** in Brush Script MT replaces the unreadable
  cherub silhouette: three stacked text passes (deep-wine shadow, gilt
  mid, light-gold highlight).
- **Tilted ribbon** painted as row-by-row sheared parallelogram, with a
  large legible Palatino italic `ISSUE IV · MMXXVI` inscription in deep
  wine.
- **Rose clusters** (3 upper-left, 2 lower-right, 1 stray right) built
  from stacked discs: leaves + outer petals + mid + center + shadow
  accent — asymmetrically grouped, varied scale.
- **Doubled scrollwork density** with secondary darker-gold hairline
  pass on top of the bright gold strokes.
- **SACRED letterspacing** tightened 8→3 px so the word feels solid,
  with a Garamond italic subtitle bridge `~ a quarterly on indulgent
  virtues ~` mediating between SACRED and decadence.
- **Cartouche bevel** — dark-gold outer ring + light-gold rim offset for
  highlight.
- **Grain** cranked from 18% to 38% Overlay so the texture is visible.

## Features exercised

- Layers (8+), add/rename/select, push history per phase
- Batched ImageData paint helper (works around auto-crop pitfall) for
  background gradient, frame + medallions, cartouche, rose clusters,
  tilted ribbon, grain base
- Brush at multiple sizes/hardness/opacities for scrollwork primary +
  hairline pass
- Spray tool with Screen blend (sparkles)
- Elliptical marquee drag (cartouche selection screenshot)
- Drop Shadow, Outer Glow, Stroke effects on SACRED; Drop Shadow on
  decadence.
- Vignette, Contrast, Saturation/Vibrance adjustment nodes
- Add Noise filter → Overlay blend at 38% opacity
- Rasterized Canvas2D typography for Garamond bold, Garamond italic
  subtitle, Brush Script MT italic decadence + monogram, Palatino
  italic issue tag
- Single undo + redo sanity check

## Output

- `e2e/screenshots/sacred-decadence.png` — final PNG export
- `e2e/screenshots/sacred-decadence-{04-monogram,10-text,18-final}.png`
  — representative intermediates
