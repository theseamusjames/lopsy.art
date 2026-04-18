//! Color / tone adjustment filters: brightness/contrast, hue/sat, invert,
//! desaturate, posterize, threshold, solarize.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterBrightnessContrast")]
pub fn filter_brightness_contrast(
    engine: &mut Engine, layer_id: &str, brightness: f32, contrast: f32,
) {
    let prog = engine.inner.shaders.adjustments.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_brightness") {
                gl.uniform1f(Some(&loc), brightness / 100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast / 100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_exposure") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_highlights") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_shadows") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_whites") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_blacks") {
                gl.uniform1f(Some(&loc), 0.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterHueSaturation")]
pub fn filter_hue_saturation(
    engine: &mut Engine, layer_id: &str,
    hue: f32, saturation: f32, lightness: f32,
) {
    let prog = engine.inner.shaders.hue_sat.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_hue") {
                gl.uniform1f(Some(&loc), hue);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_saturation") {
                gl.uniform1f(Some(&loc), saturation);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_lightness") {
                gl.uniform1f(Some(&loc), lightness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterInvert")]
pub fn filter_invert(engine: &mut Engine, layer_id: &str) {
    let prog = engine.inner.shaders.invert.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |_gl, _prog| {},
    );
}

#[wasm_bindgen(js_name = "filterDesaturate")]
pub fn filter_desaturate(engine: &mut Engine, layer_id: &str) {
    // Desaturate = hue_sat with saturation = -100
    let prog = engine.inner.shaders.hue_sat.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_hue") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_saturation") {
                gl.uniform1f(Some(&loc), -100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_lightness") {
                gl.uniform1f(Some(&loc), 0.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterPosterize")]
pub fn filter_posterize(engine: &mut Engine, layer_id: &str, levels: u32) {
    let prog = engine.inner.shaders.posterize.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_levels") {
                gl.uniform1f(Some(&loc), levels as f32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterThreshold")]
pub fn filter_threshold(engine: &mut Engine, layer_id: &str, level: u32) {
    let prog = engine.inner.shaders.threshold.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_level") {
                gl.uniform1f(Some(&loc), level as f32 / 255.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterSolarize")]
pub fn filter_solarize(engine: &mut Engine, layer_id: &str, threshold: u32) {
    let prog = engine.inner.shaders.solarize.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_threshold") {
                gl.uniform1f(Some(&loc), threshold as f32 / 255.0);
            }
        },
    );
}
