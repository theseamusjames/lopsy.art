# Composition: LOCOMOTIVE KINETICS — Futurist T-Shirt Design

**Date**: 2026-05-19
**Branch**: `claude/run-composition-skill-DP3O9`
**Test file**: `e2e/composition-locomotive-kinetics.spec.ts`
**Output**: `e2e/screenshots/locomotive-kinetics.png`

## Project

- **Style**: Italian Futurism (~1909-1916) — Boccioni / Balla / Marinetti
- **Project type**: t-shirt design (portrait, 1000×1250)
- **Subject**: stylized locomotive as an icon of speed & modernity
- **Topic letters**: L, K → "Locomotive Kinetics"
- **Palette**: charcoal, steam ivory, hot red, saffron, cobalt steel, soot black

## Features exercised

- **Layers**: 26+ layers across 4 nested groups (Lines of Force, Locomotive, Wheels, Typography)
- **Tools**: brush (with size/hardness/opacity variation), pencil, marquee-rect, shape (ellipse), gradient (linear + radial), text, fill, move
- **Wedge "lines of force"**: six wide soft-brush strokes from a vanishing point at 6 different angles
- **Locomotive parts**: boiler (ellipse), smoke stack (rect + disk), cab (rect), cowcatcher (brush triangle), rivets (pencil clicks), wheels (ellipse stack + pencil spokes)
- **Smoke plume**: large soft-brush dabs at low opacity
- **Layer effects**: drop shadow, outer glow, inner glow, stroke — set directly via `updateLayerEffects` for speed
- **Blend modes**: screen, multiply, overlay — set via `updateLayerBlendMode`
- **Typography**: three text layers using Google Fonts (Anton, Bebas Neue, Orbitron) with letter spacing via `updateTextLayerProperties`
- **Layer opacity**: `updateLayerOpacity` on speed-line group, smoke, motion stripes, halftone, grain
- **Adjustments** (root group): exposure, contrast, saturation, vignette
- **Undo/redo**: short cycle exercised mid-test
- **Marquee active screenshot** + grid toggle screenshot
- **PNG export** via File > Quick Export PNG

## Notes

- Run on Linux + SwiftShader (software WebGL). Each brush stroke / fill round-trips
  through the GPU and SwiftShader is roughly 10-50× slower than native, so the spec
  uses direct-store paths for color/brush settings, blend modes, opacity and effects
  to keep wall time tractable. Real users on hardware GPUs don't pay this cost.
- An early "checkpoint" PNG export runs right after the typography phase so the
  composition is safe even if later texture / filter phases time out.
- No new bugs identified that aren't already covered by open issues (#380 brush perf,
  #424 shape fill reseed). The shape fill reseed quirk (#424) is documented in the
  `fastFillEllipse` helper.

## Independent rating

A general-purpose agent was given the PNG with no context and asked to identify the
project and score it. It correctly identified the style as Italian Futurism
"crossed with Bauhaus/constructivist geometry — think Depero, Balla, and Cassandre's
machine-age travel posters" and the subject as a locomotive. Scores:

- **Creativity: 3/5** — "faithful homage rather than a fresh idea, but the chunky
  abstracted train front rendered as two giant wheel-eyes is a charming, characterful
  move."
- **Execution: 3/5** — "color palette… and the radiating sunburst behind the title are
  well-judged and period-accurate, but the typography is uneven."
