//! Color / tone adjustment filters: brightness/contrast, hue/sat, invert,
//! desaturate, posterize, threshold, solarize.


use crate::engine::EngineInner;
use crate::{filter_gpu, imaging};
use crate::gpu::params::filters::{HueSatParams, PosterizeParams, SolarizeParams, ThresholdParams};

pub fn filter_brightness_contrast(
    engine: &mut EngineInner, layer_id: &str, brightness: f32, contrast: f32,
) {
    let doc_color_mode = engine.doc_color_mode;
    filter_gpu::apply_op(engine, layer_id, |im, src| {
        imaging::adjustments::brightness_contrast(im, src, brightness / 100.0, contrast, doc_color_mode)
    });
}

pub fn filter_hue_saturation(
    engine: &mut EngineInner, layer_id: &str,
    hue: f32, saturation: f32, lightness: f32,
) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.hue_sat,
        HueSatParams { hue, saturation, lightness },
    );
}

pub fn filter_invert(engine: &mut EngineInner, layer_id: &str) {
    filter_gpu::apply_filter(&mut *engine, layer_id, |s| &s.invert, ());
}

pub fn filter_desaturate(engine: &mut EngineInner, layer_id: &str) {
    // Desaturate = hue_sat with saturation = -100
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.hue_sat,
        HueSatParams { hue: 0.0, saturation: -100.0, lightness: 0.0 },
    );
}

pub fn filter_posterize(engine: &mut EngineInner, layer_id: &str, levels: u32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.posterize,
        PosterizeParams { levels: levels as f32 },
    );
}

pub fn filter_threshold(engine: &mut EngineInner, layer_id: &str, level: u32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.threshold,
        ThresholdParams { level: level as f32 / 255.0 },
    );
}

pub fn filter_solarize(engine: &mut EngineInner, layer_id: &str, threshold: u32) {
    filter_gpu::apply_filter(
        &mut *engine,
        layer_id,
        |s| &s.solarize,
        SolarizeParams { threshold: threshold as f32 / 255.0 },
    );
}
