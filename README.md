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

## Contributing

PRs must pass four required CI checks before merge:

| Job        | What it runs                                   |
| ---------- | ---------------------------------------------- |
| `lint`     | `eslint src` + `scripts/check-pixel-debt.mjs`  |
| `typecheck`| `tsc --noEmit`                                 |
| `test`     | `vitest run`                                   |
| `e2e`      | `playwright test --project=chromium`           |

The same gates run on `git push` via `.githooks/pre-push`. To temporarily bypass during local iteration set `FAST_PUSH=1` (skips lint + test) or the per-gate `SKIP_LINT=1` / `SKIP_TEST=1`. Never bypass on a final push of an upstreaming branch.

See [AGENTS.md](AGENTS.md) for the contribution workflow and [CLAUDE.md](CLAUDE.md) for the project layout and rules.

## License

Commons Clause + MIT. See [LICENSE.md](LICENSE.md) for details.
