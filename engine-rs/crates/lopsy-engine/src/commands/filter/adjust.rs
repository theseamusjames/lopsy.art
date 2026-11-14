//! Color / tone adjustment filters: brightness/contrast, hue/sat, invert,
//! desaturate, posterize, threshold, solarize.


use crate::engine::EngineInner;
use crate::{filter_gpu, imaging};

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
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::adjust::hue_saturation(im, src, hue, saturation, lightness));
}

pub fn filter_invert(engine: &mut EngineInner, layer_id: &str) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::adjust::invert(im, src));
}

pub fn filter_desaturate(engine: &mut EngineInner, layer_id: &str) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::adjust::desaturate(im, src));
}

pub fn filter_posterize(engine: &mut EngineInner, layer_id: &str, levels: u32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::adjust::posterize(im, src, levels));
}

pub fn filter_threshold(engine: &mut EngineInner, layer_id: &str, level: u32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::adjust::threshold(im, src, level));
}

pub fn filter_solarize(engine: &mut EngineInner, layer_id: &str, threshold: u32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::adjust::solarize(im, src, threshold));
}
