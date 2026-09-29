# Last Run: Zen Enclaves isometric tattoo flash sheet

- **Project type**: tattoo flash sheet (1200 × 1540)
- **Topic**: "Zen Enclaves" (Z + E): four floating isometric zen islands. A torii gate, a three-tier pagoda in front of a rising sun, a raked-sand rock garden with a bonsai, and a koi pond with a stone lantern, all on isometric drafting paper
- **Style**: isometric (30° block projection, flat three-tone face shading, tattoo-weight ink outlines)
- **Spec**: `e2e/composition-zen-enclaves.spec.ts` (steps in `composition-zen-enclaves.flow.ts` / `.steps.ts`)
- **Export**: `e2e/screenshots/zen-enclaves-flash-sheet.png`
- **Tutorial**: `tutorials/isometric-zen-tattoo-flash/`

## Features exercised

- File → New, Edit → Fill, Edit → Define Pattern + Fill with Pattern (a seamless 104 × 60 isometric grid tile), Select → Shrink, Layer → Group Layers, View → Show Grid, Quick Export PNG
- 45+ layers, 4 design groups, a multi-group Move drag with Snap to Grid, rename, opacity, Cmd/Ctrl+click on a thumbnail to load alpha as a selection
- Tools: rectangular and elliptical marquee, Lasso (about 150 isometric face polygons), linear and radial gradients (from the gradient editor), Brush and Pencil Shift+click straight-line strokes, Eraser, Burn clipped to a lasso facet, Text (Dela Gothic One, Zen Kaku Gothic New 700; select-all recolour; Text panel letter spacing), Move-tool rotate and uniform-scale handles
- Effects: Stroke, Drop Shadow, Outer Glow; Rasterize Layer Style to bake them
- Filters: Sunburst (clipped to a circle), Halftone (dotwork), Add Noise
- Blend modes: multiply, overlay
- Clipboard: copy / paste in place (koi, cloud, blossoms) and cut / paste to lift a blossom onto its own layer
- Guides placed by clicking the rulers; grid snapping on the group drag
- Undo ×3 / redo ×3 checked against layer pixel fingerprints

## Issues

- #1000 (new): a rotation handle on a thin selection has a hit area smaller than its drawn circle, so pressing the circle's edge moves the selection instead of rotating it
