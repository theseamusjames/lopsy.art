//! Document color mode conversions.
//!
//! Each mode change bakes the layer's pixels into the target mode's value
//! space (Photoshop's destructive Image > Mode). Callers snapshot history
//! before invoking these — the GPU texture is overwritten in place.

use wasm_bindgen::prelude::*;

use crate::filter_gpu;
use crate::Engine;

/// Rec. 709 luma weights, applied to the stored (gamma-encoded) values so the
/// result matches the Black & White adjustment in `adjustments.glsl`.
const LUMA_R: f32 = 0.2126;
const LUMA_G: f32 = 0.7152;
const LUMA_B: f32 = 0.0722;

/// Column-major mat3 that maps every output channel to the same luma value,
/// yielding R=G=B. `uniform_matrix3fv` consumes columns in order.
const GRAYSCALE_MATRIX: [f32; 9] = [
    LUMA_R, LUMA_R, LUMA_R,
    LUMA_G, LUMA_G, LUMA_G,
    LUMA_B, LUMA_B, LUMA_B,
];

/// Bake a layer to grayscale (R=G=B), leaving alpha untouched.
///
/// Runs on the whole layer even when a selection is active: a document mode
/// conversion must not leave part of a layer in the previous color space.
#[wasm_bindgen(js_name = "convertLayerToGrayscale")]
pub fn convert_layer_to_grayscale(engine: &mut Engine, layer_id: &str) {
    filter_gpu::apply_filter_full_layer(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.color_convert,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_colorMatrix") {
                gl.uniform_matrix3fv_with_f32_array(Some(&loc), false, &GRAYSCALE_MATRIX);
            }
        },
    );
}
