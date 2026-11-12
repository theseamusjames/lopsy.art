//! Color / tone adjustment filters: brightness/contrast, hue/sat, invert,
//! desaturate, posterize, threshold, solarize.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterBrightnessContrast")]
pub fn filter_brightness_contrast(
    engine: &mut Engine, layer_id: &str, brightness: f32, contrast: f32,
) {
    let doc_color_mode = engine.inner.doc_color_mode;
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.adjustments,
        |pass| crate::compositor::standalone_adjustments(pass, brightness / 100.0, contrast, doc_color_mode),
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
        |pass| {
            pass
                .f32("u_hue", hue)
                .f32("u_saturation", saturation)
                .f32("u_lightness", lightness)
        },
    );
}

#[wasm_bindgen(js_name = "filterInvert")]
pub fn filter_invert(engine: &mut Engine, layer_id: &str) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.invert,
        |pass| pass,
    );
}

#[wasm_bindgen(js_name = "filterDesaturate")]
pub fn filter_desaturate(engine: &mut Engine, layer_id: &str) {
    // Desaturate = hue_sat with saturation = -100
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.hue_sat,
        |pass| {
            pass
                .f32("u_hue", 0.0)
                .f32("u_saturation", -100.0)
                .f32("u_lightness", 0.0)
        },
    );
}

#[wasm_bindgen(js_name = "filterPosterize")]
pub fn filter_posterize(engine: &mut Engine, layer_id: &str, levels: u32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.posterize,
        |pass| {
            pass
                .f32("u_levels", levels as f32)
        },
    );
}

#[wasm_bindgen(js_name = "filterThreshold")]
pub fn filter_threshold(engine: &mut Engine, layer_id: &str, level: u32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.threshold,
        |pass| {
            pass
                .f32("u_level", level as f32 / 255.0)
        },
    );
}

#[wasm_bindgen(js_name = "filterSolarize")]
pub fn filter_solarize(engine: &mut Engine, layer_id: &str, threshold: u32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.solarize,
        |pass| {
            pass
                .f32("u_threshold", threshold as f32 / 255.0)
        },
    );
}
