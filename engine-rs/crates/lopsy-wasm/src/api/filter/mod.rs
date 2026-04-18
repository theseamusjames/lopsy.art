//! GPU-accelerated one-shot filters (Filter menu actions).
//!
//! Each filter is a thin `#[wasm_bindgen]` wrapper that composes a shader
//! program with its uniforms via `filter_gpu::apply_filter` (or
//! `apply_separable_blur` for multi-pass effects). Grouped by category
//! to mirror `lopsy-core/src/filters/`:
//!
//!   - `blur`    — gaussian, box, unsharp, motion, radial
//!   - `adjust`  — brightness/contrast, hue/sat, invert, desaturate,
//!                 posterize, threshold, solarize
//!   - `stylize` — pixelate, halftone, kaleidoscope, oil paint, chromatic
//!                 aberration, find edges, cel shading
//!   - `noise`   — add noise, fill with noise, clouds, smoke
//!   - `preview` — save/restore/clear preview texture

pub mod adjust;
pub mod blur;
pub mod noise;
pub mod preview;
pub mod stylize;
