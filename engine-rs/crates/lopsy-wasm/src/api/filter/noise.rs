//! wasm-bindgen exports for `commands::filter::noise`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "filterAddNoise")]
pub fn filter_add_noise(
    engine: &mut Engine,
    layer_id: &str,
    amount: f32,
    monochrome: bool,
    gaussian: bool,
    seed: f32,
) {
    lopsy_engine::commands::filter::noise::filter_add_noise(&mut engine.inner, layer_id, amount, monochrome, gaussian, seed)
}

#[wasm_bindgen(js_name = "filterClouds")]
pub fn filter_clouds(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32) {
    lopsy_engine::commands::filter::noise::filter_clouds(&mut engine.inner, layer_id, scale, seed)
}

#[wasm_bindgen(js_name = "filterSmoke")]
pub fn filter_smoke(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32, turbulence: f32) {
    lopsy_engine::commands::filter::noise::filter_smoke(&mut engine.inner, layer_id, scale, seed, turbulence)
}

#[wasm_bindgen(js_name = "filterFibers")]
pub fn filter_fibers(engine: &mut Engine, layer_id: &str, variance: f32, strength: f32, seed: f32) {
    lopsy_engine::commands::filter::noise::filter_fibers(&mut engine.inner, layer_id, variance, strength, seed)
}

#[wasm_bindgen(js_name = "filterTexture")]
#[allow(clippy::too_many_arguments)]
pub fn filter_texture(
    engine: &mut Engine,
    layer_id: &str,
    kind: u32,
    blend: u32,
    amount: f32,
    size: f32,
    stretch: f32,
    angle_deg: f32,
    detail: f32,
    contrast: f32,
    colored: bool,
    seed: f32,
) {
    lopsy_engine::commands::filter::noise::filter_texture(&mut engine.inner, layer_id, kind, blend, amount, size, stretch, angle_deg, detail, contrast, colored, seed)
}
