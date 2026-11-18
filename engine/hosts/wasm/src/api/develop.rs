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
