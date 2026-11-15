//! Stylize filters: pixelate, halftone, kaleidoscope, oil paint, chromatic
//! aberration, pixel stretch, find edges, cel shading, bloom.


use super::full_size_doc_center;
use crate::engine::EngineInner;
use crate::{filter_gpu, imaging};

pub fn filter_pixelate(engine: &mut EngineInner, layer_id: &str, block_size: u32) {
    if block_size <= 1 {
        return;
    }
    filter_gpu::apply_staged(engine, layer_id, |im, src, size, scratch| {
        imaging::filters::stylize::pixelate(im, src, size, scratch, block_size)
    });
}

pub fn filter_halftone(engine: &mut EngineInner, layer_id: &str, dot_size: f32, density: f32, angle: f32, contrast: f32) {
    if dot_size < 2.0 {
        return;
    }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::halftone(im, src, dot_size, density, angle, contrast));
}

pub fn filter_kaleidoscope(engine: &mut EngineInner, layer_id: &str, segments: u32, rotation_degrees: f32) {
    // Kaleidoscope's polar math needs the texture's pixel dimensions to stay
    // isotropic on non-square layers (see kaleidoscope.wgsl), and mirrors
    // around the canvas centre, which moves in UV when the layer hangs past
    // the canvas. Resize up front so both match the texture the shader runs on.
    let Some((w, h, cu, cv)) = full_size_doc_center(&mut *engine, layer_id) else {
        return;
    };

    filter_gpu::apply_op(engine, layer_id, |im, src| {
        imaging::filters::stylize::kaleidoscope(im, src, [w as f32, h as f32], [cu, cv], segments, rotation_degrees)
    });
}

pub fn filter_oil_paint(engine: &mut EngineInner, layer_id: &str, radius: f32, sharpness: f32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::oil_paint(im, src, radius, sharpness));
}

pub fn filter_chromatic_aberration(engine: &mut EngineInner, layer_id: &str, amount: f32, angle_degrees: f32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::chromatic_aberration(im, src, amount, angle_degrees));
}

pub fn filter_pixel_stretch(
    engine: &mut EngineInner,
    layer_id: &str,
    amount: f32,
    bands: f32,
    seed: f32,
    rgb_split: f32,
) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::pixel_stretch(im, src, amount, bands, seed, rgb_split));
}

pub fn filter_lens_distortion(
    engine: &mut EngineInner,
    layer_id: &str,
    strength: f32,
    zoom: f32,
    fringing: f32,
) {
    let Some((_, _, cu, cv)) = full_size_doc_center(&mut *engine, layer_id) else {
        return;
    };
    let doc_long_side = engine.doc_width.max(engine.doc_height).max(1) as f32;
    filter_gpu::apply_op(engine, layer_id, |im, src| {
        imaging::filters::stylize::lens_distortion(im, src, [cu, cv], doc_long_side, strength, zoom, fringing)
    });
}

pub fn filter_find_edges(engine: &mut EngineInner, layer_id: &str) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::find_edges(im, src));
}

pub fn filter_cel_shading(engine: &mut EngineInner, layer_id: &str, levels: u32, edge_strength: f32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::cel_shading(im, src, levels, edge_strength));
}

pub fn filter_emboss(engine: &mut EngineInner, layer_id: &str, angle_degrees: f32, strength: f32, emboss_type: f32) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::emboss(im, src, angle_degrees, strength, emboss_type));
}

pub fn filter_bloom(
    engine: &mut EngineInner,
    layer_id: &str,
    threshold: f32,
    soft_knee: f32,
    radius: u32,
    intensity: f32,
) {
    if radius == 0 { return; }
    filter_gpu::apply_staged(engine, layer_id, |im, src, size, scratch| {
        imaging::filters::stylize::bloom(im, src, size, scratch, threshold, soft_knee, radius, intensity)
    });
}

pub fn filter_voronoi(
    engine: &mut EngineInner,
    layer_id: &str,
    cell_count: f32,
    edge_width: f32,
    edge_r: f32,
    edge_g: f32,
    edge_b: f32,
    seed: f32,
) {
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::voronoi(im, src, cell_count, edge_width, edge_r, edge_g, edge_b, seed));
}
