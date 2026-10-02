# Last run: Juggernaut Horsepower (steampunk data-visualization poster, 1500x2000)

Project type: a data visualization poster. A brass pressure gauge doubles as a radial bar chart. Seven rings (oldest inside, newest outside) show the approximate horsepower of landmark steam engines on a log scale (54° per tenfold): Newcomen 1712 through Big Boy 1941. The needle points to the Titanic record. It sits on pebbled oxblood leather inside a riveted iron frame with dashed stitching, with copper/brass gears tucked behind the bezel and riveted brass title and legend plates. Fully drawn, no photos.

Tools/features used:
- Filter → **Sunburst** (gear teeth inside circle selections with Taper 50; a 120-ray knurled bezel in a thin ring), Clouds, Add Noise, Gaussian Blur, **Emboss** + Brightness/Contrast ×2 (leather pebble grain), Hue/Saturation
- **Define Pattern / Fill with Pattern** (rivets every 100 px on the frame band; 10×3 and 3×10 dash tiles for stitching), exact-corners marquee dialog
- Elliptical/rect marquee **add / subtract / intersect** (Alt, Shift+Alt lasso wedges) for rings, arcs and crescents; Select → Shrink; Cmd-click thumbnail selections
- Multi-stop linear and radial gradients (brass bands, aged dial, glass glare with alpha stops)
- Brush with **Radial Symmetry** (12 screws plus slots), brush Shift-click lines (log-scale ticks), Eraser fade
- Shape tool rounded rectangles (plates, legend chips); copy/paste a gear, Move drag, Cmd 15° rotate; free rotation of a needle about a centred marquee; live-text rotation (v1)
- Effects: Drop Shadow, Inner Glow, Stroke; blend modes Overlay, Multiply, Screen; layer opacity
- Text: Cinzel Decorative (title), Old Standard TT regular/bold/italic (labels, numerals, notes); guides; groups (Gears, Gauge, Title, Legend) with group Move + undo/redo checks
- Bugs: filed #1157 (italic text has no glyph fallback; ★/→ render as NO GLYPH boxes)

Palette: dark oxblood leather (2B1B17) and iron (3A302B) with polished brass (E9C877/9C6E27/F7E4A8), copper gears (8A4A25), a cream enamel dial (EADFC3), and aged enamel rings in oxblood (6B1E18), verdigris (4A8573) and blued steel (2C3E55).
