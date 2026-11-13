//! wasm-bindgen exports for `commands::filter::distort`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "filterMeshWarp")]
pub fn filter_mesh_warp(
    engine: &mut Engine,
    layer_id: &str,
    grid_data: &[u8],
    grid_width: u32,
    grid_height: u32,
    bounds_min_u: f32,
    bounds_min_v: f32,
    bounds_max_u: f32,
    bounds_max_v: f32,
) {
    crate::commands::filter::distort::filter_mesh_warp(&mut engine.inner, layer_id, grid_data, grid_width, grid_height, bounds_min_u, bounds_min_v, bounds_max_u, bounds_max_v)
}

#[wasm_bindgen(js_name = "liquifyInitDisplacement")]
pub fn liquify_init_displacement(engine: &mut Engine, data: &[u8], width: u32, height: u32) {
    crate::commands::filter::distort::liquify_init_displacement(&mut engine.inner, data, width, height)
}

#[wasm_bindgen(js_name = "liquifyRender")]
pub fn liquify_render(engine: &mut Engine, layer_id: &str, max_disp: f32) {
    crate::commands::filter::distort::liquify_render(&mut engine.inner, layer_id, max_disp)
}

#[wasm_bindgen(js_name = "liquifyRelease")]
pub fn liquify_release(engine: &mut Engine) {
    crate::commands::filter::distort::liquify_release(&mut engine.inner)
}

#[wasm_bindgen(js_name = "liquifyApplyDabGpu")]
pub fn liquify_apply_dab_gpu(
    engine: &mut Engine,
    cx: f32,
    cy: f32,
    radius: f32,
    pressure: f32,
    drag_dx: f32,
    drag_dy: f32,
    mode: u32,
) {
    crate::commands::filter::distort::liquify_apply_dab_gpu(&mut engine.inner, cx, cy, radius, pressure, drag_dx, drag_dy, mode)
}
