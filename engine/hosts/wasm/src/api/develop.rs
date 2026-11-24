//! wasm-bindgen exports for `commands::develop`, the proof-of-concept RAW
//! develop stage. The settings JSON is
//! `{ "wbRatio": [r,g,b], "camToRgb": [9 floats, row-major], "exposureEv": f32,
//!    "saturation": f32, "highlightDesaturation": bool, "baseCurve": [N floats] | null }`,
//! the shape `rafDevelopDefaults` returns.

use wasm_bindgen::prelude::*;

use crate::readback::{read, readback_export};
use crate::Engine;

#[wasm_bindgen(js_name = "setRawDevelop")]
pub fn set_raw_develop(engine: &mut Engine, json: &str) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_raw_develop_json(&mut engine.inner, json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearRawDevelop")]
pub fn clear_raw_develop(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_raw_develop(&mut engine.inner)
}

readback_export! {
    /// 1024 bins of the displayed result: red 0..=255, green, blue, then
    /// Rec. 709 luminance of the encoded values. Wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "readDevelopHistogram")]
    pub fn read_develop_histogram(engine) -> Result<Vec<u32>> {
        read(lopsy_engine::commands::develop::read_develop_histogram(engine))
    }
}

/// Auto tone: the histogram (as `readDevelopHistogram` returns it) of the
/// render with `currentJson` applied, and the current
/// `{exposure, contrast, highlights, shadows, whites, blacks}`; returns the
/// new values as the same JSON.
#[wasm_bindgen(js_name = "autoTone")]
pub fn auto_tone(histogram: &[u32], current_json: &str) -> Result<String, JsError> {
    lopsy_core::develop_stats::auto_tone_json(histogram, current_json).map_err(|e| JsError::new(&e))
}

/// Grey-world white balance of linear camera RGB (RGBA f32 from
/// `rafRenderBinnedLinear` or `rafRenderLinearBand`): `[r, g, b]` wbRatio
/// multipliers relative to as shot, green = 1.
#[wasm_bindgen(js_name = "rafAutoWhiteBalance")]
pub fn raf_auto_white_balance(linear_rgba: &[f32]) -> Vec<f32> {
    lopsy_core::develop_stats::auto_white_balance(linear_rgba).to_vec()
}

/// Color by hue: 24 floats, (hue, saturation, luminance) per band in
/// −100..100, bands red, orange, yellow, green, aqua, blue, purple, magenta.
#[wasm_bindgen(js_name = "setImageColorMixer")]
pub fn set_image_color_mixer(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_color_mixer(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageColorMixer")]
pub fn clear_image_color_mixer(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_color_mixer(&mut engine.inner)
}

/// Sharpening and noise reduction: 7 floats `[amount 0..150, radius
/// 0.5..3 (full-resolution px), edges 0..100, nrLuminance 0..100,
/// nrColor 0..100, nrDetail 0..100, pixelScale]`.
#[wasm_bindgen(js_name = "setImageDetail")]
pub fn set_image_detail(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_detail(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageDetail")]
pub fn clear_image_detail(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_detail(&mut engine.inner)
}

/// Local contrast and haze: 4 floats `[large, small, haze (−100..100),
/// pixelScale]`.
#[wasm_bindgen(js_name = "setImageLocalContrast")]
pub fn set_image_local_contrast(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_local_contrast(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageLocalContrast")]
pub fn clear_image_local_contrast(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_local_contrast(&mut engine.inner)
}

/// Areas: 16 floats per area, at most 8 (throws otherwise, or on a kind
/// other than 0/1 or a non-finite value). Per area:
/// `[kind (0 linear, 1 radial), invert (0/1), amount 0..1,
///   x0, y0, x1, y1, rotation (rad), feather 0..1,
///   exposure (EV −4..4), contrast, highlights, shadows,
///   temperature, tint, saturation (−100..100)]`.
/// Linear: (x0, y0) = p0 (full effect), (x1, y1) = p1 (no effect).
/// Radial: (x0, y0) = centre, (x1, y1) = radii; rotation and feather apply.
/// Coordinates are document pixels.
#[wasm_bindgen(js_name = "setImageAreas")]
pub fn set_image_areas(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_areas(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageAreas")]
pub fn clear_image_areas(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_areas(&mut engine.inner)
}

// An area's layer: after the areas pass, the image is run through the
// develop stages again with the area's own settings and shows through the
// area's mask, over the photo's own edits. `index` is the area's place in
// `setImageAreas` (0..7). Each setter throws on an index out of range or
// on values its document-wide twin would refuse. What is set stays until
// `clearImageAreaLayer`, `clearImageAreaLayers` or `clearImageAreas`.

/// Whites, blacks and vibrance of an area's layer, −100..100 each.
#[wasm_bindgen(js_name = "setImageAreaTone")]
pub fn set_image_area_tone(engine: &mut Engine, index: u32, whites: f32, blacks: f32, vibrance: f32) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_tone(&mut engine.inner, index, whites, blacks, vibrance).map_err(|e| JsError::new(&e))
}

/// The curves of an area's layer: the 256×4 LUT of `setImageCurvesLut`.
#[wasm_bindgen(js_name = "setImageAreaCurvesLut")]
pub fn set_image_area_curves_lut(engine: &mut Engine, index: u32, lut: &[u8]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_curves_lut(&mut engine.inner, index, lut).map_err(|e| JsError::new(&e))
}

/// Colour grading of an area's layer: the 18 floats of `setImageColorGrading`.
#[wasm_bindgen(js_name = "setImageAreaColorGrading")]
pub fn set_image_area_color_grading(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_color_grading(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Color by hue of an area's layer: the 24 floats of `setImageColorMixer`.
#[wasm_bindgen(js_name = "setImageAreaColorMixer")]
pub fn set_image_area_color_mixer(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_color_mixer(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Sharpening and noise reduction of an area's layer: the 7 floats of `setImageDetail`.
#[wasm_bindgen(js_name = "setImageAreaDetail")]
pub fn set_image_area_detail(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_detail(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Large details, small details and haze of an area's layer: the 4 floats of `setImageLocalContrast`.
#[wasm_bindgen(js_name = "setImageAreaLocalContrast")]
pub fn set_image_area_local_contrast(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_local_contrast(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// Vignette and grain of an area's layer: the 9 floats of `setImageFinish`.
#[wasm_bindgen(js_name = "setImageAreaFinish")]
pub fn set_image_area_finish(engine: &mut Engine, index: u32, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_area_finish(&mut engine.inner, index, values).map_err(|e| JsError::new(&e))
}

/// One area's layer off; the area keeps its mask and built-in adjustments.
#[wasm_bindgen(js_name = "clearImageAreaLayer")]
pub fn clear_image_area_layer(engine: &mut Engine, index: u32) {
    lopsy_engine::commands::develop::clear_image_area_layer(&mut engine.inner, index)
}

/// Every area's layer off; the areas themselves stay.
#[wasm_bindgen(js_name = "clearImageAreaLayers")]
pub fn clear_image_area_layers(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_area_layers(&mut engine.inner)
}

/// Show area `index`'s mask as a red overlay on screen only; −1 for none.
#[wasm_bindgen(js_name = "setImageAreaOverlay")]
pub fn set_image_area_overlay(engine: &mut Engine, index: i32) {
    lopsy_engine::commands::develop::set_image_area_overlay(&mut engine.inner, index)
}

/// Mark clipped pixels on screen only: shadows (any channel ≤ 0) in blue,
/// highlights (any channel ≥ 1) in red, after the whole develop chain.
#[wasm_bindgen(js_name = "setClippingWarning")]
pub fn set_clipping_warning(engine: &mut Engine, shadows: bool, highlights: bool) {
    lopsy_engine::commands::develop::set_clipping_warning(&mut engine.inner, shadows, highlights)
}

readback_export! {
    /// `[temperature, tint]` (recipe units) that make the patch of
    /// `radius` document pixels around (x, y) neutral. Read before the RAW
    /// stage and every adjustment. Wrap with `'any-time'`.
    #[wasm_bindgen(js_name = "sampleNeutralWhiteBalance")]
    pub fn sample_neutral_white_balance(engine, x: f32, y: f32, radius: f32) -> Result<Vec<f32>> {
        read(lopsy_engine::commands::develop::sample_neutral_white_balance(engine, x, y, radius))
    }
}

/// Show the sharpening edge mask as grey on screen while `on` (needs
/// `setImageDetail`); never in exports.
#[wasm_bindgen(js_name = "setImageDetailMaskView")]
pub fn set_image_detail_mask_view(engine: &mut Engine, on: bool) {
    lopsy_engine::commands::develop::set_image_detail_mask_view(&mut engine.inner, on)
}

/// Shaped vignette and grain, last in the develop chain: 9 floats
/// `[vignetteAmount −100..100, size 0..100, roundness −100..100,
///   feather 0..100, grainAmount 0..100, grainSize 0..100,
///   grainRoughness 0..100, seed (an integer per photo), pixelScale]`.
/// Replaces the adjustments' vignette: set that one to 0 when using this.
#[wasm_bindgen(js_name = "setImageFinish")]
pub fn set_image_finish(engine: &mut Engine, values: &[f32]) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_image_finish(&mut engine.inner, values).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearImageFinish")]
pub fn clear_image_finish(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_image_finish(&mut engine.inner)
}
