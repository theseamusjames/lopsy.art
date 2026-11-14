//! wasm-bindgen exports for `commands::filter::render`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "filterPatternFill")]
#[allow(clippy::too_many_arguments)]
pub fn filter_pattern_fill(
    engine: &mut Engine,
    layer_id: &str,
    pattern_data: &[u8],
    pattern_width: u32,
    pattern_height: u32,
    scale: f32,
    stagger_x: f32,
    stagger_y: f32,
    origin_x: f32,
    origin_y: f32,
) {
    lopsy_engine::commands::filter::render::filter_pattern_fill(&mut engine.inner, layer_id, pattern_data, pattern_width, pattern_height, scale, stagger_x, stagger_y, origin_x, origin_y)
}

#[wasm_bindgen(js_name = "filterColorLut")]
pub fn filter_color_lut(engine: &mut Engine, layer_id: &str, lut_data: &[u8], lut_size: u32, intensity: f32) {
    lopsy_engine::commands::filter::render::filter_color_lut(&mut engine.inner, layer_id, lut_data, lut_size, intensity)
}

#[wasm_bindgen(js_name = "readChannelThumbnail")]
pub fn read_channel_thumbnail(engine: &mut Engine, layer_id: &str, channel: u32, max_size: u32) -> Vec<u8> {
    lopsy_engine::commands::filter::render::read_channel_thumbnail(&mut engine.inner, layer_id, channel, max_size)
}

#[wasm_bindgen(js_name = "filterSunburst")]
#[allow(clippy::too_many_arguments)]
pub fn filter_sunburst(
    engine: &mut Engine,
    layer_id: &str,
    rays: u32,
    center_x: f32,
    center_y: f32,
    rotation_degrees: f32,
    length: f32,
    width: f32,
    taper: f32,
    fade: f32,
    softness: f32,
    jitter: f32,
    seed: f32,
    ray_r: f32,
    ray_g: f32,
    ray_b: f32,
    ray_a: f32,
    fill_gaps: bool,
    gap_r: f32,
    gap_g: f32,
    gap_b: f32,
) {
    lopsy_engine::commands::filter::render::filter_sunburst(&mut engine.inner, layer_id, rays, center_x, center_y, rotation_degrees, length, width, taper, fade, softness, jitter, seed, ray_r, ray_g, ray_b, ray_a, fill_gaps, gap_r, gap_g, gap_b)
}
