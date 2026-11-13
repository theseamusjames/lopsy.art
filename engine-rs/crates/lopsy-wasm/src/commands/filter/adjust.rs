//! Color / tone adjustment filters: brightness/contrast, hue/sat, invert,
//! desaturate, posterize, threshold, solarize.


use crate::engine::EngineInner;
use crate::filter_gpu;
use crate::gpu::params::filters::{HueSatParams, PosterizeParams, SolarizeParams, ThresholdParams};

pub fn filter_brightness_contrast(
    engine: &mut EngineInner, layer_id: &str, brightness: f32, contrast: f32,
) {
    let doc_color_mode = engine.doc_color_mode;
    filter_gpu::apply_filter_with(
        &mut *engine,
        layer_id,
        |e| &e.shaders.adjustments,
        crate::compositor::standalone_adjustments(brightness / 100.0, contrast, doc_color_mode),
        crate::compositor::park_adjustment_luts,
    );
}

pub fn filter_hue_saturation(
    engine: &mut EngineInner, layer_id: &str,
    hue: f32, saturation: f32, lightness: f32,
) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |e| &e.shaders.hue_sat,
        HueSatParams { hue, saturation, lightness },
    );
}

pub fn filter_invert(engine: &mut EngineInner, layer_id: &str) {
    filter_gpu::apply_filter(&mut *engine, layer_id, |e| &e.shaders.invert, ());
}

pub fn filter_desaturate(engine: &mut EngineInner, layer_id: &str) {
    // Desaturate = hue_sat with saturation = -100
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |e| &e.shaders.hue_sat,
        HueSatParams { hue: 0.0, saturation: -100.0, lightness: 0.0 },
    );
}

pub fn filter_posterize(engine: &mut EngineInner, layer_id: &str, levels: u32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |e| &e.shaders.posterize,
        PosterizeParams { levels: levels as f32 },
    );
}

pub fn filter_threshold(engine: &mut EngineInner, layer_id: &str, level: u32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |e| &e.shaders.threshold,
        ThresholdParams { level: level as f32 / 255.0 },
    );
}

pub fn filter_solarize(engine: &mut EngineInner, layer_id: &str, threshold: u32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |e| &e.shaders.solarize,
        SolarizeParams { threshold: threshold as f32 / 255.0 },
    );
}
