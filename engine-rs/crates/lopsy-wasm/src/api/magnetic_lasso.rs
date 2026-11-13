//! wasm-bindgen exports for `commands::magnetic_lasso`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "magneticLassoBegin")]
pub fn magnetic_lasso_begin(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    lopsy_engine::commands::magnetic_lasso::magnetic_lasso_begin(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "magneticLassoSnap")]
pub fn magnetic_lasso_snap(
    engine: &Engine,
    from_x: f32,
    from_y: f32,
    to_x: f32,
    to_y: f32,
    radius: u32,
    threshold: u8,
) -> Vec<f32> {
    lopsy_engine::commands::magnetic_lasso::magnetic_lasso_snap(&engine.inner, from_x, from_y, to_x, to_y, radius, threshold)
}

#[wasm_bindgen(js_name = "magneticLassoSnapPoint")]
pub fn magnetic_lasso_snap_point(engine: &Engine, x: f32, y: f32, radius: u32, threshold: u8) -> Vec<f32> {
    lopsy_engine::commands::magnetic_lasso::magnetic_lasso_snap_point(&engine.inner, x, y, radius, threshold)
}

#[wasm_bindgen(js_name = "magneticLassoEnd")]
pub fn magnetic_lasso_end(engine: &mut Engine) {
    lopsy_engine::commands::magnetic_lasso::magnetic_lasso_end(&mut engine.inner)
}
