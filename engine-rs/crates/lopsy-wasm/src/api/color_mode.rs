//! Document color mode conversions.
//!
//! Each mode change bakes the layer's pixels into the target mode's value
//! space (Photoshop's destructive Image > Mode). Callers snapshot history
//! before invoking these — the GPU texture is overwritten in place.

use wasm_bindgen::prelude::*;

use lopsy_core::{lab, quantize};

use crate::{compositor, filter_gpu, layer_manager};
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

/// Read a layer's texture, transform it on the CPU, and upload it back.
///
/// Lab and CMYK conversions are matrix + transcendental math per pixel with no
/// shared shader path, so they run in Rust rather than as a GPU pass. This is
/// a one-time cost per mode change, not a per-frame one.
fn transform_layer_pixels(
    engine: &mut Engine,
    layer_id: &str,
    transform: impl Fn(&mut [u8]),
) -> Result<(), JsError> {
    let (width, height) = engine
        .inner
        .layer_textures
        .get(layer_id)
        .and_then(|&tex| engine.inner.texture_pool.get_size(tex))
        .ok_or_else(|| JsError::new("Layer has no texture"))?;
    let mut pixels =
        layer_manager::read_pixels(&engine.inner, layer_id).map_err(|e| JsError::new(&e))?;

    transform(&mut pixels);

    layer_manager::upload_pixels(&mut engine.inner, layer_id, &pixels, width, height, 0, 0)
        .map_err(|e| JsError::new(&e))?;
    engine.inner.mark_layer_dirty(layer_id);
    Ok(())
}

/// Encode a layer's sRGB pixels as CIELAB for native Lab compositing.
#[wasm_bindgen(js_name = "convertLayerToLab")]
pub fn convert_layer_to_lab(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    transform_layer_pixels(engine, layer_id, lab::srgb_pixels_to_lab)
}

/// Decode a layer's CIELAB pixels back to sRGB when leaving Lab mode.
#[wasm_bindgen(js_name = "convertLayerFromLab")]
pub fn convert_layer_from_lab(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    transform_layer_pixels(engine, layer_id, lab::lab_pixels_to_srgb)
}

/// Build an indexed palette from the flattened document.
///
/// Returns `max_colors * 4` bytes at most (RGBA per entry) — fewer when the
/// image holds fewer distinct colors, since padding the palette would invent
/// entries the document never used.
#[wasm_bindgen(js_name = "quantizeCompositeToPalette")]
pub fn quantize_composite_to_palette(
    engine: &mut Engine,
    max_colors: u32,
) -> Result<Vec<u8>, JsError> {
    let composite = compositor::composite_for_export(&mut engine.inner)
        .map_err(|e| JsError::new(&e))?;
    let palette = quantize::median_cut(&composite, max_colors as usize);
    Ok(palette.into_iter().flatten().collect())
}

/// Snap a layer's pixels to `palette` (RGBA entries, 4 bytes each), optionally
/// diffusing quantization error with Floyd–Steinberg.
///
/// This is a CPU round trip rather than a shader pass because nearest-palette
/// search and error diffusion are both sequential over the palette/neighbours.
#[wasm_bindgen(js_name = "applyPaletteToLayer")]
pub fn apply_palette_to_layer(
    engine: &mut Engine,
    layer_id: &str,
    palette: &[u8],
    dither: bool,
) -> Result<(), JsError> {
    if palette.len() < 4 {
        return Ok(());
    }
    let entries: Vec<[u8; 4]> = palette
        .chunks_exact(4)
        .map(|c| [c[0], c[1], c[2], c[3]])
        .collect();

    let (width, height) = engine
        .inner
        .layer_textures
        .get(layer_id)
        .and_then(|&tex| engine.inner.texture_pool.get_size(tex))
        .ok_or_else(|| JsError::new("Layer has no texture"))?;
    let mut pixels = layer_manager::read_pixels(&engine.inner, layer_id)
        .map_err(|e| JsError::new(&e))?;

    if dither {
        quantize::apply_palette_dithered(&mut pixels, width as usize, height as usize, &entries);
    } else {
        quantize::apply_palette(&mut pixels, &entries);
    }

    layer_manager::upload_pixels(&mut engine.inner, layer_id, &pixels, width, height, 0, 0)
        .map_err(|e| JsError::new(&e))?;
    engine.inner.mark_layer_dirty(layer_id);
    Ok(())
}
