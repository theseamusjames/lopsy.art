# Composition: Sacred Decadence (Rococo Zine Cover)

**Date**: 2026-05-19
**Branch**: `claude/run-composition-skill-oY1bV`
**Test file**: `e2e/composition-sacred-decadence.spec.ts`
**Style**: rococo  •  **Project type**: zine cover  •  **Topic letters**: s + d

## What was tested

### Layers, layer ops, and history
- 11+ layers (background, gilt frame, cartouche, cherub, scrollwork, roses,
  ribbon, three text layers, sparkles, grain)
- Rename layer, add layer, set active layer
- Push history at every major step; mid-composition multi-undo (4 steps)
  + multi-redo, and a single undo/redo of the scrollwork layer

### Selections + transforms
- Elliptical marquee drag (screenshot captured with marquee active)
- Free-Transform invoked via `Ctrl+T` on the cherub layer, then committed
  with Enter

### Painting tools
- Brush (cherub silhouette, gold curlicue swooshes, sinusoidal swoops, rose
  petals) at multiple sizes/hardness/opacities
- Spray tool used for the sparkle layer (with screen blend)
- Batched ImageData paint for the background, frame, cartouche rings, and
  ribbon to side-step the auto-crop pitfall

### Text
- Three rasterized typography layers (`SACRED` in Garamond bold,
  `decadence.` in Brush Script MT italic, issue tag in Palatino) — drawn
  via Canvas2D fillText and pushed as raster pixels so the GPU compositor
  renders them

### Effects
- Drop Shadow, Outer Glow, and Stroke configured on the SACRED title
- Drop Shadow on the decadence. title
- Sparkles layer set to Screen blend mode, grain layer set to Overlay at
  18% opacity

### Adjustments (document-level)
- Vignette (+35), Contrast (+14), Saturation -10 / Vibrance +18 added as
  adjustment nodes on the root group

### Filters
- Add Noise filter on the grain layer (raster, gray base) → Overlay blend

## Final pixel sanity check
- >60% opaque pixel coverage
- Warm-side palette confirmed (rAvg > bAvg)

## Output
- `e2e/screenshots/sacred-decadence.png` — final PNG export
- `e2e/screenshots/sacred-decadence-{01..18}-*.png` — phase screenshots
