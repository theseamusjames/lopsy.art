# Composition: Zephyr & Eagle Heritage Outdoor Co.

**Date**: 2026-05-19
**Branch**: `claude/search-compose-skill-hKMrs`
**Test file**: `e2e/composition-zephyr-eagle.spec.ts`
**Style**: Etching / vintage engraving
**Project**: Logo (circular badge, 900×900)
**Result**: PASSED (15.8 minutes, chromium/SwiftShader)

## Evaluation

Spun an evaluator agent — no context about the project — to identify
the work and rate it 1–5 on creativity and execution.

- **Identified as**: a heritage-style outdoor brand logo badge (Filson /
  REI / national-park-patch lineage) — eagle, mountains, sun rays,
  banner, circular border.
- **Creativity**: 2 / 5 — concept is conventional for the genre.
- **Execution**: 2 / 5 — silhouette reads, but bottom text overlaps the
  inner ring, eagle body reads as a blob, red banner floats unanchored.

## Features exercised

### Tools
- Shape tool (ellipse + polygon, both fill + stroke variants)
- Brush (crosshatch shading, eagle-feather lines on pencil)
- Pencil (sun rays radiating from horizon)
- Spray (parchment grain texture)
- Fill bucket (background parchment)
- Text tool (banner + top + bottom labels; Garamond / Times fallback)
- Marquee rectangle (captured with active marching ants over banner)
- Move tool (tool switching between text + shape phases)

### Layers & ops
- 18+ named layers: Parchment, Paper Grain, Outer Badge, Inner Field,
  Gold Ring, Inner Ring, Sun Rays, Mountains, Snow Caps, Eagle, Banner,
  Mountain Stipple, Crosshatch, Banner Text, Top Text, Bottom Text, Stars,
  decorative dots.
- Add layer, rename layer.
- Layer opacity (Paper Grain, Sun Rays at 55%).
- Layer blend mode (Crosshatch → Multiply).
- Group selected layers (post-export, to test the feature).

### Effects
- Drop Shadow on Outer Badge.
- Stroke on Banner (parchment outline).
- Outer Glow on Eagle (gold).

### History
- Multiple undo / redo cycles after the stars phase, with redo back to
  the same state.

### Selection
- Active rectangular marquee captured (screenshot with marching ants).
- Ctrl+D deselect.

### Export
- Composited PNG export via `__readCompositedPixels`, flipped top-down,
  saved as `Zephyr & Eagle Heritage Outdoor Co.png` (900×900).

## Notable findings

- Shape tool `onActivate` resets `shapeFillColor` to `foregroundColor`
  every time the tool is activated — even if it was already active.
  Workaround: set shape style **after** `selectTool('shape')`, not before.
- Shape tool drag is **centered** on the start point (size = drag × 2),
  not corner-to-corner. Helpers adapted accordingly.
- `Escape` cancels text editing and removes the new layer; use
  `Shift+Enter` (or Tab) to commit.
