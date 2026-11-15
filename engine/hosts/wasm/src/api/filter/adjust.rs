//! wasm-bindgen exports for `commands::filter::adjust`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "filterBrightnessContrast")]
pub fn filter_brightness_contrast(engine: &mut Engine, layer_id: &str, brightness: f32, contrast: f32) {
    lopsy_engine::commands::filter::adjust::filter_brightness_contrast(&mut engine.inner, layer_id, brightness, contrast)
}

#[wasm_bindgen(js_name = "filterHueSaturation")]
pub fn filter_hue_saturation(engine: &mut Engine, layer_id: &str, hue: f32, saturation: f32, lightness: f32) {
    lopsy_engine::commands::filter::adjust::filter_hue_saturation(&mut engine.inner, layer_id, hue, saturation, lightness)
}

#[wasm_bindgen(js_name = "filterInvert")]
pub fn filter_invert(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::filter::adjust::filter_invert(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "filterDesaturate")]
pub fn filter_desaturate(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::filter::adjust::filter_desaturate(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "filterPosterize")]
pub fn filter_posterize(engine: &mut Engine, layer_id: &str, levels: u32) {
    lopsy_engine::commands::filter::adjust::filter_posterize(&mut engine.inner, layer_id, levels)
}

#[wasm_bindgen(js_name = "filterThreshold")]
pub fn filter_threshold(engine: &mut Engine, layer_id: &str, level: u32) {
    lopsy_engine::commands::filter::adjust::filter_threshold(&mut engine.inner, layer_id, level)
}

#[wasm_bindgen(js_name = "filterSolarize")]
pub fn filter_solarize(engine: &mut Engine, layer_id: &str, threshold: u32) {
    lopsy_engine::commands::filter::adjust::filter_solarize(&mut engine.inner, layer_id, threshold)
}
