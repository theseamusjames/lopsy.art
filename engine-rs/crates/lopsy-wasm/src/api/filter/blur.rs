//! wasm-bindgen exports for `commands::filter::blur`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "filterGaussianBlur")]
pub fn filter_gaussian_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
    crate::commands::filter::blur::filter_gaussian_blur(&mut engine.inner, layer_id, radius)
}

#[wasm_bindgen(js_name = "filterBoxBlur")]
pub fn filter_box_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
    crate::commands::filter::blur::filter_box_blur(&mut engine.inner, layer_id, radius)
}

#[wasm_bindgen(js_name = "filterUnsharpMask")]
pub fn filter_unsharp_mask(engine: &mut Engine, layer_id: &str, radius: u32, amount: f32, threshold: u32) {
    crate::commands::filter::blur::filter_unsharp_mask(&mut engine.inner, layer_id, radius, amount, threshold)
}

#[wasm_bindgen(js_name = "filterMotionBlur")]
pub fn filter_motion_blur(engine: &mut Engine, layer_id: &str, angle: f32, distance: u32) {
    crate::commands::filter::blur::filter_motion_blur(&mut engine.inner, layer_id, angle, distance)
}

#[wasm_bindgen(js_name = "filterTiltShiftBlur")]
pub fn filter_tilt_shift_blur(
    engine: &mut Engine,
    layer_id: &str,
    focus_position: f32,
    focus_width: f32,
    blur_radius: f32,
    angle: f32,
) {
    crate::commands::filter::blur::filter_tilt_shift_blur(&mut engine.inner, layer_id, focus_position, focus_width, blur_radius, angle)
}

#[wasm_bindgen(js_name = "filterSurfaceBlur")]
pub fn filter_surface_blur(engine: &mut Engine, layer_id: &str, radius: u32, threshold: f32) {
    crate::commands::filter::blur::filter_surface_blur(&mut engine.inner, layer_id, radius, threshold)
}

#[wasm_bindgen(js_name = "filterRadialBlur")]
pub fn filter_radial_blur(engine: &mut Engine, layer_id: &str, amount: u32) {
    crate::commands::filter::blur::filter_radial_blur(&mut engine.inner, layer_id, amount)
}
