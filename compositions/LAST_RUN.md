# Last run: The Imperial Quail (etching-style birthday card, 1400x1960)

Project type: a birthday card. It turns a public-domain USFWS photo of a California quail into a Victorian hand-tinted copperplate etching. The quail stands on a post inside a fading oval of ruled lines, on a cream plate with a pressed plate mark. "Many Happy Returns" is in Pinyon Script, with THE IMPERIAL QUAIL in IM Fell English SC between double rules and "Callipepla californica" in IM Fell English italic. Pencil margin notes (1/1, the title and a signature) are in La Belle Aurore. Photo-based, not drawn.

Tools/features used:
- Photo paste via the clipboard, Magic Wand (Shift-add, Contiguous on/off, Tolerance), Lasso with Alt to subtract and Shift to add, Shift+Alt intersect, Select → Inverse/Grow/Shrink/Feather
- Filters: Desaturate, Hue/Saturation, Brightness/Contrast (with Preview, on a lassoed area), Unsharp Mask, Add Noise, Gaussian Blur, Threshold (the core of the line engraving), Clouds, Emboss
- **Engraving technique:** Define Pattern stripe tiles (16x10 and 16x6) → Fill with Pattern → blur → rotate the layer (Cmd 15-degree snap) → Mesh Warp to bend the hatch → clip with selections → 50% over a Copy Merged tone layer → Merge Down → Threshold, plus a second crosshatch pass merged on Multiply
- Linear and radial gradients (Advanced stops with alpha), stretching a radial gradient with the transform edge handles
- Selection → Path plus Paths-panel Stroke Path for the contour; Eraser with low opacity for fades
- Blend modes: Lighten (to colour the ink sepia), Multiply (washes and ink), Overlay (paper grain)
- Brush with Taper (Brushes modal Shape tab) for grass; Duplicate Layer plus a marquee Flip Horizontal; Pencil with Shift-click lines for rules and the plate bevel
- Text: four Google fonts, letter spacing, italic set before typing, Align center, rotating live text (the signature) with its handle
- Groups (Plate, Margin Notes), Group Layers from a multi-select, group Move, copy/paste in place to patch, guides from ruler clicks, Region-dialog marquees
- Undo/redo checks: eraser chain, group move (0 px), 8-step undo/redo round trip (0 px)
- Bugs: filed #1152 (Style → Italic on an existing text layer never loads the italic face); commented on #1133 (Selection → Path drops islands and keeps the one with the most contour points, not the biggest)

Palette: cream paper (F4EAD8) and plate tone (E6DCC8) with dark sepia ink (2D1D14), soft hand-tinted washes of slate (8C97A3), chestnut (A0603A), buff (D9B77E) and umber (8A6A4A), pale blue sky (C9D6DC), and graphite pencil (6E6E6E).
