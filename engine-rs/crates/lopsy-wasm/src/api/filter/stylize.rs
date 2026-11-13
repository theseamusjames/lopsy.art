//! wasm-bindgen exports for `commands::filter::stylize`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "filterPixelate")]
pub fn filter_pixelate(engine: &mut Engine, layer_id: &str, block_size: u32) {
    crate::commands::filter::stylize::filter_pixelate(&mut engine.inner, layer_id, block_size)
}

#[wasm_bindgen(js_name = "filterHalftone")]
pub fn filter_halftone(
    engine: &mut Engine,
    layer_id: &str,
    dot_size: f32,
    density: f32,
    angle: f32,
    contrast: f32,
) {
    crate::commands::filter::stylize::filter_halftone(&mut engine.inner, layer_id, dot_size, density, angle, contrast)
}

#[wasm_bindgen(js_name = "filterKaleidoscope")]
pub fn filter_kaleidoscope(engine: &mut Engine, layer_id: &str, segments: u32, rotation_degrees: f32) {
    crate::commands::filter::stylize::filter_kaleidoscope(&mut engine.inner, layer_id, segments, rotation_degrees)
}

#[wasm_bindgen(js_name = "filterOilPaint")]
pub fn filter_oil_paint(engine: &mut Engine, layer_id: &str, radius: f32, sharpness: f32) {
    crate::commands::filter::stylize::filter_oil_paint(&mut engine.inner, layer_id, radius, sharpness)
}

#[wasm_bindgen(js_name = "filterChromaticAberration")]
pub fn filter_chromatic_aberration(engine: &mut Engine, layer_id: &str, amount: f32, angle_degrees: f32) {
    crate::commands::filter::stylize::filter_chromatic_aberration(&mut engine.inner, layer_id, amount, angle_degrees)
}

#[wasm_bindgen(js_name = "filterPixelStretch")]
pub fn filter_pixel_stretch(
    engine: &mut Engine,
    layer_id: &str,
    amount: f32,
    bands: f32,
    seed: f32,
    rgb_split: f32,
) {
    crate::commands::filter::stylize::filter_pixel_stretch(&mut engine.inner, layer_id, amount, bands, seed, rgb_split)
}

#[wasm_bindgen(js_name = "filterLensDistortion")]
pub fn filter_lens_distortion(engine: &mut Engine, layer_id: &str, strength: f32, zoom: f32, fringing: f32) {
    crate::commands::filter::stylize::filter_lens_distortion(&mut engine.inner, layer_id, strength, zoom, fringing)
}

#[wasm_bindgen(js_name = "filterFindEdges")]
pub fn filter_find_edges(engine: &mut Engine, layer_id: &str) {
    crate::commands::filter::stylize::filter_find_edges(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "filterCelShading")]
pub fn filter_cel_shading(engine: &mut Engine, layer_id: &str, levels: u32, edge_strength: f32) {
    crate::commands::filter::stylize::filter_cel_shading(&mut engine.inner, layer_id, levels, edge_strength)
}

#[wasm_bindgen(js_name = "filterEmboss")]
pub fn filter_emboss(engine: &mut Engine, layer_id: &str, angle_degrees: f32, strength: f32, emboss_type: f32) {
    crate::commands::filter::stylize::filter_emboss(&mut engine.inner, layer_id, angle_degrees, strength, emboss_type)
}

#[wasm_bindgen(js_name = "filterBloom")]
pub fn filter_bloom(
    engine: &mut Engine,
    layer_id: &str,
    threshold: f32,
    soft_knee: f32,
    radius: u32,
    intensity: f32,
) {
    crate::commands::filter::stylize::filter_bloom(&mut engine.inner, layer_id, threshold, soft_knee, radius, intensity)
}

#[wasm_bindgen(js_name = "filterVoronoi")]
pub fn filter_voronoi(
    engine: &mut Engine,
    layer_id: &str,
    cell_count: f32,
    edge_width: f32,
    edge_r: f32,
    edge_g: f32,
    edge_b: f32,
    seed: f32,
) {
    crate::commands::filter::stylize::filter_voronoi(&mut engine.inner, layer_id, cell_count, edge_width, edge_r, edge_g, edge_b, seed)
}
