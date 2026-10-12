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
pub mod distort;
pub mod mask_target;
pub mod noise;
pub mod preview;
pub mod render;
pub mod stylize;

use crate::engine::EngineInner;

/// Texture size and document centre (in the layer texture's UV space) for
/// filters that work around the canvas centre. Expands the layer to cover
/// the document first: a layer hanging past a canvas edge keeps that part,
/// so its texture centre is not the document centre (#1253).
pub(crate) fn full_size_doc_center(inner: &mut EngineInner, layer_id: &str) -> Option<(u32, u32, f32, f32)> {
    let _ = inner.ensure_layer_full_size(layer_id);
    let tex = *inner.layer_textures.get(layer_id)?;
    let (w, h) = inner.texture_pool.get_size(tex).unwrap_or((1, 1));
    let (layer_x, layer_y) = inner.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));
    let (u, v) = doc_center_uv(
        inner.doc_width as f32,
        inner.doc_height as f32,
        layer_x,
        layer_y,
        w as f32,
        h as f32,
    );
    Some((w, h, u, v))
}

fn doc_center_uv(doc_w: f32, doc_h: f32, layer_x: f32, layer_y: f32, tex_w: f32, tex_h: f32) -> (f32, f32) {
    ((doc_w * 0.5 - layer_x) / tex_w.max(1.0), (doc_h * 0.5 - layer_y) / tex_h.max(1.0))
}

#[cfg(test)]
mod tests {
    use super::doc_center_uv;

    #[test]
    fn doc_sized_texture_centres_at_half() {
        assert_eq!(doc_center_uv(800.0, 600.0, 0.0, 0.0, 800.0, 600.0), (0.5, 0.5));
    }

    #[test]
    fn texture_hanging_past_the_bottom_keeps_the_canvas_centre() {
        // An 800×600 canvas whose layer was nudged 200 px down: the texture
        // grows to 800×800 at (0, 0), so the canvas centre is at v = 300/800.
        assert_eq!(doc_center_uv(800.0, 600.0, 0.0, 0.0, 800.0, 800.0), (0.5, 0.375));
    }

    #[test]
    fn texture_hanging_past_the_top_left_offsets_the_centre() {
        let (u, v) = doc_center_uv(800.0, 600.0, -100.0, -50.0, 900.0, 650.0);
        assert_eq!(u, 500.0 / 900.0);
        assert_eq!(v, 350.0 / 650.0);
    }
}
