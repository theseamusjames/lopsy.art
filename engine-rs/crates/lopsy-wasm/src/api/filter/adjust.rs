//! Color / tone adjustment filters: brightness/contrast, hue/sat, invert,
//! desaturate, posterize, threshold, solarize, channel mixer.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterBrightnessContrast")]
pub fn filter_brightness_contrast(
    engine: &mut Engine, layer_id: &str, brightness: f32, contrast: f32,
) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.adjustments,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_brightness") {
                gl.uniform1f(Some(&loc), brightness / 100.0);
            }
            if let Some(loc) = shader.location(gl, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast / 100.0);
            }
            if let Some(loc) = shader.location(gl, "u_exposure") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = shader.location(gl, "u_highlights") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = shader.location(gl, "u_shadows") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = shader.location(gl, "u_whites") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = shader.location(gl, "u_blacks") {
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
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.hue_sat,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_hue") {
                gl.uniform1f(Some(&loc), hue);
            }
            if let Some(loc) = shader.location(gl, "u_saturation") {
                gl.uniform1f(Some(&loc), saturation);
            }
            if let Some(loc) = shader.location(gl, "u_lightness") {
                gl.uniform1f(Some(&loc), lightness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterInvert")]
pub fn filter_invert(engine: &mut Engine, layer_id: &str) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.invert,
        |_gl, _shader| {},
    );
}

#[wasm_bindgen(js_name = "filterDesaturate")]
pub fn filter_desaturate(engine: &mut Engine, layer_id: &str) {
    // Desaturate = hue_sat with saturation = -100
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.hue_sat,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_hue") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = shader.location(gl, "u_saturation") {
                gl.uniform1f(Some(&loc), -100.0);
            }
            if let Some(loc) = shader.location(gl, "u_lightness") {
                gl.uniform1f(Some(&loc), 0.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterPosterize")]
pub fn filter_posterize(engine: &mut Engine, layer_id: &str, levels: u32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.posterize,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_levels") {
                gl.uniform1f(Some(&loc), levels as f32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterThreshold")]
pub fn filter_threshold(engine: &mut Engine, layer_id: &str, level: u32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.threshold,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_level") {
                gl.uniform1f(Some(&loc), level as f32 / 255.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterSolarize")]
pub fn filter_solarize(engine: &mut Engine, layer_id: &str, threshold: u32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.solarize,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_threshold") {
                gl.uniform1f(Some(&loc), threshold as f32 / 255.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterChannelMixer")]
pub fn filter_channel_mixer(
    engine: &mut Engine, layer_id: &str,
    rr: f32, rg: f32, rb: f32,
    gr: f32, gg: f32, gb: f32,
    br: f32, bg: f32, bb: f32,
    cr: f32, cg: f32, cb: f32,
) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.channel_mixer,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_rr") { gl.uniform1f(Some(&loc), rr / 100.0); }
            if let Some(loc) = shader.location(gl, "u_rg") { gl.uniform1f(Some(&loc), rg / 100.0); }
            if let Some(loc) = shader.location(gl, "u_rb") { gl.uniform1f(Some(&loc), rb / 100.0); }
            if let Some(loc) = shader.location(gl, "u_gr") { gl.uniform1f(Some(&loc), gr / 100.0); }
            if let Some(loc) = shader.location(gl, "u_gg") { gl.uniform1f(Some(&loc), gg / 100.0); }
            if let Some(loc) = shader.location(gl, "u_gb") { gl.uniform1f(Some(&loc), gb / 100.0); }
            if let Some(loc) = shader.location(gl, "u_br") { gl.uniform1f(Some(&loc), br / 100.0); }
            if let Some(loc) = shader.location(gl, "u_bg") { gl.uniform1f(Some(&loc), bg / 100.0); }
            if let Some(loc) = shader.location(gl, "u_bb") { gl.uniform1f(Some(&loc), bb / 100.0); }
            if let Some(loc) = shader.location(gl, "u_cr") { gl.uniform1f(Some(&loc), cr / 100.0); }
            if let Some(loc) = shader.location(gl, "u_cg") { gl.uniform1f(Some(&loc), cg / 100.0); }
            if let Some(loc) = shader.location(gl, "u_cb") { gl.uniform1f(Some(&loc), cb / 100.0); }
        },
    );
}
