# Last Run: Uncharted Fjords cartographic logo

- **Project type**: logo / emblem (1200 × 1200)
- **Topic**: "Uncharted Fjords Expedition Co.": a round antique sea chart of a fjord coast with a compass rose, dotted route to an X, red ribbon wordmark and arched seal lettering
- **Style**: cartographic (portolan rhumb lines, hypsometric contour tints, engraved waterlines, conic graticule, chequered degree border)
- **Spec**: `e2e/composition-uncharted-fjords.spec.ts` (steps in `.flow.ts` / `.steps.ts`, geometry in `.geo.ts`)
- **Export**: `e2e/screenshots/uncharted-fjords.png`
- **Tutorial**: `tutorials/cartographic-map-emblem-logo/`

## Features exercised

- File → New, rulers → guides, View → Show Grid / Snap to Grid / Show Guides, Quick Export PNG
- 35+ layers, a layer group moved as one with grid snapping, Merge Down, rename, opacity, blend modes (multiply, overlay)
- Selections: elliptical / rectangular marquee, freehand lasso (coast, fjords, skerries), Ctrl+click thumbnail alpha, Select → Grow / Shrink / Feather / Inverse, Delete to clear
- Edit → Fill, linear and radial gradients (Gradient Editor stops), brush dotted lines (200% spacing) via Shift+click chains, Burn tool
- Filters: Clouds, Sunburst (degree bars, rhumb lines, compass ticks), Add Noise
- Effects: stroke, inner glow, drop shadow, outer effects baked with Rasterize Layer Style
- Transforms: copy / paste in place, rotation handle with Cmd 15° snap, Cmd uniform corner scale, Rotate 90° CCW button, arrow nudges
- Text: IM Fell English SC, letter spacing (Text panel), Select All recolour, Pen-tool arcs + text on a path (top and bottom seal lines)
- Undo ×3 / redo ×3 verified with GPU pixel fingerprints (skerry transforms, group snap move)
- Art Director critique → second iteration (teal sea, lighter neatline, flat taller ribbon, optically centred wordmark)

## Issues

- #801 (comment): Select → Grow/Shrink between a thumbnail Ctrl+click and Delete still wipes the whole active layer
