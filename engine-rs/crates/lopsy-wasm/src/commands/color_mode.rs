//! Document color mode conversions.
//!
//! Each mode change bakes the layer's pixels into the target mode's value
//! space (Photoshop's destructive Image > Mode). Callers snapshot history
//! before invoking these — the GPU texture is overwritten in place.


use lopsy_core::{cmyk, lab, quantize};

use crate::{compositor, filter_gpu, layer_manager};
use crate::engine::EngineInner;
use crate::gpu::params::color::ColorConvertParams;
use crate::gpu::uniforms::Mat3;

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
pub fn convert_layer_to_grayscale(engine: &mut EngineInner, layer_id: &str) {
    filter_gpu::apply_pointwise_filter_full_layer(
        &mut *engine,
        layer_id,
        |e| &e.shaders.color_convert,
        ColorConvertParams { color_matrix: Mat3(GRAYSCALE_MATRIX) },
    );
}

/// Read a layer's texture, transform it on the CPU, and upload it back.
///
/// Lab and CMYK conversions are matrix + transcendental math per pixel with no
/// shared shader path, so they run in Rust rather than as a GPU pass. This is
/// a one-time cost per mode change, not a per-frame one.
fn transform_layer_pixels(
    engine: &mut EngineInner,
    layer_id: &str,
    transform: impl Fn(&mut [u8]),
) -> Result<(), String> {
    let (width, height) = engine
        .layer_textures
        .get(layer_id)
        .and_then(|&tex| engine.texture_pool.get_size(tex))
        .ok_or_else(|| "Layer has no texture".to_string())?;
    let mut pixels =
        layer_manager::read_pixels(&*engine, layer_id)?;

    transform(&mut pixels);

    layer_manager::upload_pixels(&mut *engine, layer_id, &pixels, width, height, 0, 0)
        ?;
    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// Encode a layer's sRGB pixels as CIELAB for native Lab compositing.
pub fn convert_layer_to_lab(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    transform_layer_pixels(engine, layer_id, lab::srgb_pixels_to_lab)
}

/// Decode a layer's CIELAB pixels back to sRGB when leaving Lab mode.
pub fn convert_layer_from_lab(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    transform_layer_pixels(engine, layer_id, lab::lab_pixels_to_srgb)
}

/// Clamp a layer to the colors the CMYK ink model can reproduce.
///
/// CMYK documents are backed by sRGB, not ink channels: the paint pipeline owns
/// the alpha channel (dabs write coverage there and premultiply by it), so
/// there is no fourth channel free for black ink. Storing K in alpha made every
/// stroke render as 100% K — solid black.
///
/// With the current non-ICC ink model this bake is a no-op in practice: the
/// sRGB -> CMYK -> sRGB round trip is exactly lossless across the whole cube,
/// so there is no gamut to clip. It is the hook a real profile-based transform
/// (with ink limits, which genuinely do clip) will replace.
pub fn bake_cmyk_gamut(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    transform_layer_pixels(engine, layer_id, cmyk::bake_cmyk_gamut)
}

/// Build an indexed palette from the flattened document.
///
/// Returns `max_colors * 4` bytes at most (RGBA per entry) — fewer when the
/// image holds fewer distinct colors, since padding the palette would invent
/// entries the document never used.
pub fn quantize_composite_to_palette(
    engine: &mut EngineInner,
    max_colors: u32,
) -> Result<Vec<u8>, String> {
    let composite = compositor::composite_for_export(&mut *engine)
        ?;
    let palette = quantize::median_cut(&composite, max_colors as usize);
    Ok(palette.into_iter().flatten().collect())
}

/// Snap a layer's pixels to `palette` (RGBA entries, 4 bytes each), optionally
/// diffusing quantization error with Floyd–Steinberg.
///
/// This is a CPU round trip rather than a shader pass because nearest-palette
/// search and error diffusion are both sequential over the palette/neighbours.
pub fn apply_palette_to_layer(
    engine: &mut EngineInner,
    layer_id: &str,
    palette: &[u8],
    dither: bool,
) -> Result<(), String> {
    if palette.len() < 4 {
        return Ok(());
    }
    let entries: Vec<[u8; 4]> = palette
        .chunks_exact(4)
        .map(|c| [c[0], c[1], c[2], c[3]])
        .collect();

    let (width, height) = engine
        .layer_textures
        .get(layer_id)
        .and_then(|&tex| engine.texture_pool.get_size(tex))
        .ok_or_else(|| "Layer has no texture".to_string())?;
    let mut pixels = layer_manager::read_pixels(&*engine, layer_id)
        ?;

    if dither {
        quantize::apply_palette_dithered(&mut pixels, width as usize, height as usize, &entries);
    } else {
        quantize::apply_palette(&mut pixels, &entries);
    }

    layer_manager::upload_pixels(&mut *engine, layer_id, &pixels, width, height, 0, 0)
        ?;
    engine.mark_layer_dirty(layer_id);
    Ok(())
}
