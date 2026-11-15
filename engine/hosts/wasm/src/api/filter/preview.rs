//! wasm-bindgen exports for `commands::filter::preview`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "saveFilterPreview")]
pub fn save_filter_preview(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::filter::preview::save_filter_preview(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "restoreFilterPreview")]
pub fn restore_filter_preview(engine: &mut Engine) {
    lopsy_engine::commands::filter::preview::restore_filter_preview(&mut engine.inner)
}

#[wasm_bindgen(js_name = "clearFilterPreview")]
pub fn clear_filter_preview(engine: &mut Engine) {
    lopsy_engine::commands::filter::preview::clear_filter_preview(&mut engine.inner)
}
