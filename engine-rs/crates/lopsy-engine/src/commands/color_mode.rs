//! Document color mode conversions.
//!
//! Each mode change bakes the layer's pixels into the target mode's value
//! space (Photoshop's destructive Image > Mode). Callers snapshot history
//! before invoking these — the GPU texture is overwritten in place.


use lopsy_core::{cmyk, lab, quantize};

use crate::{compositor, filter_gpu, layer_manager};
use crate::engine::EngineInner;
use crate::gpu::params::color::ColorConvertParams;
use crate::gpu::read::Read;
use crate::task::Cx;
use crate::gpu::uniforms::Mat3;

/// Rec. 709 luma weights, applied to the stored (gamma-encoded) values so the
/// result matches the Black & White adjustment in `adjustments.wgsl`.
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
        |s| &s.color_convert,
        ColorConvertParams { color_matrix: Mat3(GRAYSCALE_MATRIX) },
    );
}

/// Read a layer's texture, transform it on the CPU, and upload it back.
///
/// Lab and CMYK conversions are matrix + transcendental math per pixel with no
/// shared shader path, so they run in Rust rather than as a GPU pass. This is
/// a one-time cost per mode change, not a per-frame one.
async fn transform_layer_pixels(
    cx: &Cx,
    layer_id: &str,
    transform: impl Fn(&mut [u8]),
) -> Result<(), String> {
    let (width, height, read) = cx.with(|engine| layer_read(engine, layer_id))?;
    let mut pixels = read.await?;

    transform(&mut pixels);

    cx.with(|engine| write_layer_back(engine, layer_id, &pixels, width, height))
}

/// A layer's size and a read of its pixels.
fn layer_read(engine: &EngineInner, layer_id: &str) -> Result<(u32, u32, Read<Vec<u8>>), String> {
    let (width, height) = engine
        .layer_textures
        .get(layer_id)
        .and_then(|&tex| engine.texture_pool.get_size(tex))
        .ok_or_else(|| "Layer has no texture".to_string())?;
    Ok((width, height, layer_manager::read_pixels(engine, layer_id)))
}

/// Upload pixels read from a `width` by `height` layer and changed on the
/// CPU. A layer that was resized or removed while the read was out is left
/// alone: the pixels are no longer its own.
fn write_layer_back(engine: &mut EngineInner, layer_id: &str, pixels: &[u8], width: u32, height: u32) -> Result<(), String> {
    let size = engine.layer_textures.get(layer_id).and_then(|&tex| engine.texture_pool.get_size(tex));
    if size != Some((width, height)) {
        return Err("The layer changed while its pixels were being converted".to_string());
    }
    layer_manager::upload_pixels(engine, layer_id, pixels, width, height, 0, 0)?;
    engine.mark_layer_dirty(layer_id);
    Ok(())
}

/// Encode a layer's sRGB pixels as CIELAB for native Lab compositing.
pub async fn convert_layer_to_lab(cx: Cx, layer_id: String) -> Result<(), String> {
    transform_layer_pixels(&cx, &layer_id, lab::srgb_pixels_to_lab).await
}

/// Decode a layer's CIELAB pixels back to sRGB when leaving Lab mode.
pub async fn convert_layer_from_lab(cx: Cx, layer_id: String) -> Result<(), String> {
    transform_layer_pixels(&cx, &layer_id, lab::lab_pixels_to_srgb).await
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
pub async fn bake_cmyk_gamut(cx: Cx, layer_id: String) -> Result<(), String> {
    transform_layer_pixels(&cx, &layer_id, cmyk::bake_cmyk_gamut).await
}

/// Build an indexed palette from the flattened document.
///
/// Returns `max_colors * 4` bytes at most (RGBA per entry) — fewer when the
/// image holds fewer distinct colors, since padding the palette would invent
/// entries the document never used.
pub fn quantize_composite_to_palette(
    engine: &mut EngineInner,
    max_colors: u32,
) -> Read<Vec<u8>> {
    compositor::composite_for_export(&mut *engine).map(move |composite| {
        let palette = quantize::median_cut(&composite, max_colors as usize);
        palette.into_iter().flatten().collect()
    })
}

/// Snap a layer's pixels to `palette` (RGBA entries, 4 bytes each), optionally
/// diffusing quantization error with Floyd–Steinberg.
///
/// This is a CPU round trip rather than a shader pass because nearest-palette
/// search and error diffusion are both sequential over the palette/neighbours.
pub async fn apply_palette_to_layer(
    cx: Cx,
    layer_id: String,
    palette: Vec<u8>,
    dither: bool,
) -> Result<(), String> {
    if palette.len() < 4 {
        return Ok(());
    }
    let entries: Vec<[u8; 4]> = palette
        .chunks_exact(4)
        .map(|c| [c[0], c[1], c[2], c[3]])
        .collect();

    let (width, height, read) = cx.with(|engine| layer_read(engine, &layer_id))?;
    let mut pixels = read.await?;

    if dither {
        quantize::apply_palette_dithered(&mut pixels, width as usize, height as usize, &entries);
    } else {
        quantize::apply_palette(&mut pixels, &entries);
    }

    cx.with(|engine| write_layer_back(engine, &layer_id, &pixels, width, height))
}
