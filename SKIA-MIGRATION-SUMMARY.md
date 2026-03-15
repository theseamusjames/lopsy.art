# Skia (CanvasKit) Migration Summary

## Overview

This branch attempted to replace the Canvas 2D rendering pipeline with a GPU-native CanvasKit (Skia WASM) renderer, with the ultimate goal of enabling 10-bit color support via RGBA_F16 surfaces and Display P3 wide-gamut color.

## Status: Abandoned

The migration introduced more problems than it solved. None of the expected benefits materialized in a usable way, and core drawing functionality regressed significantly.

## Issues Encountered

### 1. Dimmer Images
Photos loaded into the editor appear noticeably dimmer compared to the same image viewed in a standard browser tab. The root cause is a color space mismatch: pixel data from Canvas 2D APIs is sRGB, but was initially tagged as Display P3 when uploaded to CanvasKit. Switching the SkImage color space to sRGB improved things, but images still appear dimmer than expected. The P3 surface compositing pipeline introduces color shifts that we were unable to fully resolve.

### 2. Broken Pencil / Brush Strokes
The pencil tool produces dashed/dotted lines instead of continuous strokes, especially on diagonal lines and at moderate-to-fast drag speeds. Investigation confirmed the underlying pixel data in the store is correct (no gaps), meaning the issue is in the rendering or event pipeline. Browser event coalescing (mousemove events being batched) contributes to the problem. A fix using `PointerEvent.getCoalescedEvents()` was started but not completed.

### 3. Poor Performance / Lag
Drawing, marquee selection, and other drag interactions feel sluggish (~10fps on larger canvases). Multiple optimizations were attempted:
- Zero-copy `asImageData()` to avoid 64MB allocation+copy per pointermove
- Brush stamp caching to avoid recomputing Gaussian stamps every move event
- Hot path in `updateLayerPixelData` that skips Map/Set cloning and React re-renders for in-place pixel modifications
- Reading fresh store state per RAF tick instead of stale React closure values

These helped somewhat, but the fundamental overhead of copying pixel data into the WASM heap via `ck.MakeImage()` on every frame remains a bottleneck. Each layer requires a full CPU→GPU upload every time any pixel changes.

### 4. Does Not Scale with Layers
Performance degrades rapidly as layers are added. On a 1080x1080 canvas with 10+ layers, the editor becomes unusable. Each layer requires its own `MakeImage` upload and SkImage allocation per composite, and the compositor must re-composite all visible layers on every dirty frame.

### 5. No Tangible Benefit
The GPU renderer does not provide any visible improvement over the existing Canvas 2D pipeline for our use case:
- **No perceptible color quality improvement** — images look worse (dimmer), not better
- **No performance gain** — the CPU→WASM→GPU copy pipeline is slower than Canvas 2D `putImageData` + `drawImage` compositing
- **Added complexity** — CanvasKit loader, GPU compositor, surface pool, render scheduler, renderer registry, and multiple new test files
- **Fragile** — `preserveDrawingBuffer: false` breaks in-page readback, requiring workarounds for testing and export

## Files Added (to be removed)

- `src/engine/canvaskit-loader.ts`
- `src/engine/canvaskit-renderer.ts`
- `src/engine/gpu-compositor.ts`
- `src/engine/gpu-filters.ts`
- `src/engine/gpu-surface-pool.ts`
- `src/engine/render-scheduler.ts`
- `src/engine/render-worker.ts`
- `src/engine/renderer-registry.ts`
- `src/engine/renderer-registry.test.ts`
- `src/engine/renderer.ts`
- `src/engine/canvas2d-renderer.ts`
- `src/engine/canvas2d-renderer.test.ts`
- `e2e/gpu-rendering.spec.ts`
- `e2e/renderer.spec.ts`

## Conclusion

The CanvasKit/Skia approach is not viable for Lopsy in its current form. The pixel data lives on the CPU (in PixelBuffer backed by Uint8ClampedArray), and every paint stroke requires a full upload to the GPU via WASM. Until the pixel editing operations themselves run on the GPU (e.g., compute shaders or CanvasKit's own drawing primitives for brush/pencil), the CPU→GPU copy will always be a bottleneck that makes this architecture slower than native Canvas 2D.

If we revisit GPU rendering in the future, a better approach would be to move the entire paint pipeline to CanvasKit drawing primitives (SkPath, SkPaint) rather than maintaining a CPU-side pixel buffer and uploading it each frame.
