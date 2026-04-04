# Lopsy

A modern image editor that runs entirely in your browser at [lopsy.art](https://lopsy.art).

Lopsy covers the core workflows professionals and creatives rely on — photo retouching, digital painting, compositing, and graphic design — without the overhead of a desktop install or a subscription.

## What it does

- **Layers & compositing** — Raster layers, groups, masks, clipping masks, and 15+ blend modes. Layer effects include drop shadow, inner/outer glow, stroke, and color overlay.
- **Painting & drawing** — Brush, pencil, and eraser tools with pressure sensitivity, adjustable opacity, spacing, scatter, and angle. Import ABR brush packs from Photoshop.
- **Selection tools** — Marquee, elliptical, lasso, and magic wand selections with add/subtract/intersect operations, feathering, and expand/contract.
- **Retouching** — Clone stamp, dodge/burn, and a full set of image adjustments (exposure, contrast, highlights, shadows, hue/saturation, and more).
- **Filters** — Gaussian blur, box blur, sharpen, noise, posterize, threshold, invert, and vignette.
- **Shapes & gradients** — Rectangle, ellipse, polygon, line, arrow, and star shapes. Linear and radial gradients.
- **Text** — Fully editable text layers with font selection, weight, size, alignment, and spacing controls.
- **Export** — Save as PNG or JPEG with embedded color profiles. Copy to clipboard for quick sharing.

## How it works

Everything runs client-side. There is no server, no upload, no account. Your images stay on your machine.

The rendering pipeline is GPU-accelerated via WebGL 2, compiled from Rust to WebAssembly. This keeps brush strokes, compositing, and effects smooth at 60fps even on large canvases with many layers. Heavy operations like filters and image encoding run in Web Workers to keep the interface responsive.

Lopsy supports canvases up to 32,000 x 32,000 pixels, Display P3 wide-gamut color on supported displays, and pen tablet pressure sensitivity.

## License

Commons Clause + MIT. See [LICENSE.md](LICENSE.md) for details.
