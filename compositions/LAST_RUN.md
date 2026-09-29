# Last Run: Noël Village halftone holiday card

- **Project type**: holiday card (1200 × 1600)
- **Topic**: "Noël Village" (letters N + V): a snowy village under a guiding star, with a white chapel, red, teal and cream cottages, pines, a moon and falling snow. *Joyeux Noël* in script above a *PEACE ON EARTH · 2026* ribbon
- **Style**: halftone / vintage screen print (45° dot screens, misregistered red and navy plates, navy key lines, four inks on cream paper)
- **Export**: `e2e/screenshots/final/noel-village.png` (local only)
- **Tutorial**: `tutorials/halftone-christmas-card/`

## Features exercised

- File → New, ruler guides, View → Show Grid / Snap to Grid / Show Guides, Quick Export PNG
- 35+ layers, a Village group moved with grid snapping (undo / redo / undo verified), Merge Down, rename, opacity, blend modes (screen, overlay)
- Selections: rectangular / elliptical marquee, freehand lasso, Cmd+click thumbnail alpha, Magic Wand (tolerance 90) + Select → Grow, Select → Inverse, Shrink, Delete
- Edit → Fill, linear and radial gradients (Gradient Editor stops), soft brush dabs, brush stipple snowfall, Eraser
- Filters: Halftone (×7: sky, moon halo, craters, drifts, pine, window light, title), Clouds, Sunburst, Add Noise
- Effects: Color Overlay, Stroke key lines, hard Drop Shadow as a misregistered plate, Rasterize Layer Style
- Transforms: copy / paste in place, Flip Horizontal, Cmd uniform corner scale, rotation handle (cottage, title), arrow-key nudges
- Text: Lobster script title (rotated, alpha-selected and filled with halftone dots), Oswald caps with letter spacing, recoloured with Select All, seated in a ribbon
- Undo ×3 / redo ×3 verified with GPU pixel fingerprints (cottage paste → move → scale → rotate)
- Art Director critique → second iteration (ink-coloured 45° sky screen, smaller moon, flat halftone window light instead of soft glows, key-lined drifts, reseated title and ribbon, consistent 3 px outlines)

## Issues

- #1001 (new): re-editing a text layer (recolour or retype) resets a custom layer name to its text
