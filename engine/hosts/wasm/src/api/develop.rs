//! wasm-bindgen exports for `commands::develop`, the proof-of-concept RAW
//! develop stage. The settings JSON is
//! `{ "wbRatio": [r,g,b], "camToRgb": [9 floats, row-major], "exposureEv": f32,
//!    "saturation": f32, "highlightDesaturation": bool, "baseCurve": [N floats] | null }`,
//! the shape `rafDevelopDefaults` returns.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "setRawDevelop")]
pub fn set_raw_develop(engine: &mut Engine, json: &str) -> Result<(), JsError> {
    lopsy_engine::commands::develop::set_raw_develop_json(&mut engine.inner, json).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearRawDevelop")]
pub fn clear_raw_develop(engine: &mut Engine) {
    lopsy_engine::commands::develop::clear_raw_develop(&mut engine.inner)
}
