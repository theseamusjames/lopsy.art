//! wasm-bindgen exports for `commands::filter::mask_target`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "beginMaskFilterTarget")]
pub fn begin_mask_filter_target(engine: &mut Engine, layer_id: &str) -> bool {
    lopsy_engine::commands::filter::mask_target::begin_mask_filter_target(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "endMaskFilterTarget")]
pub fn end_mask_filter_target(engine: &mut Engine, _layer_id: &str) {
    lopsy_engine::commands::filter::mask_target::end_mask_filter_target(&mut engine.inner, _layer_id)
}
