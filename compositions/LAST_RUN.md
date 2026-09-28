# Last Run: Cosmic X-Ray tattoo flash sheet

- **Project type**: tattoo flash sheet (1200 × 1540)
- **Topic**: "Cosmic X-Ray": an x-ray skull with a comet, an x-ray hand holding a crescent moon, an x-ray heart inside a ribcage with a shooting star, and a ringed planet, on a nebula backdrop
- **Style**: holographic (cyan → magenta → violet → mint → yellow foil ramps on a dark ink ground)
- **Spec**: `e2e/composition-cosmic-xray.spec.ts` (steps in `composition-cosmic-xray.flow.ts` / `.steps.ts`)
- **Export**: `e2e/screenshots/cosmic-xray-tattoo-flash.png`
- **Tutorial**: `tutorials/cosmic-xray-tattoo-flash/`

## Features exercised

- File → New dialog, Edit → Fill, Select → Shrink / Inverse, Layer → Group Layers / Merge Down, View → Show Grid, Quick Export PNG
- 40+ layers, 4 design groups, group + multi-layer Move drag with Snap to Grid, rename, opacity, Ctrl+click thumbnail for alpha selections
- Tools: rectangular and elliptical marquee, lasso, linear and radial gradients (5-stop gradient editor), brush (Shift+click straight-line strokes), eraser clipped by a selection, dodge/burn (burn), text (Rye; recoloured with Select All and a new foreground color), Move-tool rotate and uniform-scale handles
- Effects: stroke, outer glow, inner glow, drop shadow; Rasterize Layer Style to bake them
- Filters: Clouds, Brightness/Contrast, Add Noise (mono / Gaussian), Threshold, Motion Blur, Bloom, Chromatic Aberration
- Blend modes: multiply, screen, overlay
- Clipboard: copy / paste in place and cut / paste to duplicate badges and sparkles
- Guides placed by clicking the rulers, 8 px grid
- Undo ×3 / redo ×3 checked against layer pixel fingerprints

## Issues

- #983 (new): a mid-stroke pause fires hold-to-smooth, and the rest of the drag is dropped
- #801 (comment): ⌘-click another layer's thumbnail, then paint. The first dab replaces the selection with the active layer's alpha
