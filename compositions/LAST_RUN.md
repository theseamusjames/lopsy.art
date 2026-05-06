# Composition: Koi Fish Mid-Century Modern Poster

**Date**: 2026-05-06
**Branch**: `theseamusjames/gpu-masks`
**Test file**: `e2e/composition-koi-fish.spec.ts`
**Result**: PASSED (2.5 minutes, chromium/SwiftShader)

## What was tested

### Layer Masks
- Added masks to three layers (main koi, second koi, title)
- Entered mask edit mode via UI (clicking mask thumbnail)
- Painted on mask with brush tool (GPU mask painting path)
- Used eraser on mask (GPU mask eraser path)
- Applied gradient-style mask data (top-to-bottom, radial, left-to-right)
- Verified mask state in store (enabled, non-null)
- Exited mask edit mode

### Marquee Selections
- Rectangular marquee + fill: used extensively for background, geometric bars, and block letter title ("KOI")
- Elliptical marquee + fill: used for water ripple circles (5 concentric ellipses)
- Both marquee types verified via tool switching and mouse drag interactions

### Undo/Redo
- Undo after mask operations verified (composited output changes)
- Redo after undo verified (produces valid frame)
- General undo/redo on detail layer verified

### Layer Effects
- Drop shadow on main koi (offset, blur, opacity, color)
- Outer glow on main koi (size, spread, opacity, color)
- Inner glow on second koi (size, spread, opacity, color)
- All effects verified as enabled in store state

### Blend Modes & Opacity
- Screen blend mode on water ripples layer
- Layer opacity set to 60% on ripples layer

### Brush Tool
- Multiple brush sizes (25-100px), hardness levels, opacity levels
- Color changes via store (orange, red, white, black)
- Multiple stroke segments forming koi body shapes

## Known Limitation

GPU mask readback (`readMaskTexture`) does not produce correct results in the
headless SwiftShader environment. The existing `tools.spec.ts` mask painting
test also fails for the same reason. Mask data assertions in this composition
test use store-based mask writes rather than GPU-painted mask readback.

## Screenshots

19 screenshots saved to `e2e/screenshots/koi-fish-*.png`:
- `01-background` through `18-details`: incremental build phases
- `koi-fish-final.png`: completed composition

## Document Specs
- 800 x 1000 px (portrait poster format)
- 8 layers: background, main koi (with mask), geometry bars, water ripples, second koi (with mask), title "KOI" (with mask), decorative details, plus the root group
