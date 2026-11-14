//! Stylize filters: pixelate, halftone, kaleidoscope, oil paint, chromatic
//! aberration, pixel stretch, find edges, cel shading, bloom.


use super::full_size_doc_center;
use crate::engine::EngineInner;
use crate::{filter_gpu, imaging};
use crate::gpu::pass::Target;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::params::filters::{
    BloomCombineParams, BloomThresholdParams,
    GaussianBlurParams,
};
use crate::gpu::uniforms::FloatArray;

pub fn filter_pixelate(engine: &mut EngineInner, layer_id: &str, block_size: u32) {
    if block_size <= 1 {
        return;
    }
    filter_gpu::apply_pixelate(&mut *engine, layer_id, block_size);
}

pub fn filter_halftone(engine: &mut EngineInner, layer_id: &str, dot_size: f32, density: f32, angle: f32, contrast: f32) {
    if dot_size < 2.0 {
        return;
    }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::stylize::halftone(im, src, dot_size, density, angle, contrast));
}

pub fn filter_kaleidoscope(engine: &mut EngineInner, layer_id: &str, segments: u32, rotation_degrees: f32) {
    // Kaleidoscope's polar math needs the texture's pixel dimensions to stay
    // isotropic on non-square layers (see kaleidoscope.glsl), and mirrors
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

    let threshold = threshold.clamp(0.0, 1.0);
    let soft_knee = soft_knee.clamp(0.0, 1.0);
    let intensity = intensity.clamp(0.0, 5.0);

    let _ = engine.ensure_layer_full_size(layer_id);

    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);

    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    let inner = &*engine;

    // Pass 1: Threshold — extract bright pixels (layer → scratch B)
    inner.pass(&inner.shaders.bloom_threshold, BloomThresholdParams { threshold, soft_knee })
        .texture("u_tex", tex_handle)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(inner.scratch_fbo_b));

    // Half-kernel from the centre out.
    let weights = FloatArray::from_slice(kernel.get(radius as usize..).unwrap_or(&[]));
    let blur_pass = |src: TextureHandle, direction: (f32, f32)| {
        inner
            .pass(&inner.shaders.gaussian_blur, GaussianBlurParams {
                direction: [direction.0, direction.1],
                weights,
                radius: radius as i32,
            })
            .texture("u_tex", src)
            .viewport(0, 0, w as i32, h as i32)
    };
    // Pass 2: Horizontal blur (scratch B → scratch A)
    blur_pass(inner.scratch_texture_b, (1.0, 0.0)).draw(Target::Framebuffer(inner.scratch_fbo_a));
    // Pass 3: Vertical blur (scratch A → scratch B)
    blur_pass(inner.scratch_texture_a, (0.0, 1.0)).draw(Target::Framebuffer(inner.scratch_fbo_b));

    // Pass 4: Combine — add bloom onto original (layer + scratch B → scratch A)
    inner.pass(&inner.shaders.bloom_combine, BloomCombineParams { intensity })
        .texture("u_tex", tex_handle)
        .texture("u_bloomTex", inner.scratch_texture_b)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(inner.scratch_fbo_a));

    // Bloomed result is in scratch A; confine it to the selection (#1176).
    filter_gpu::commit_scratch_a_to_layer(&mut *engine, layer_id);
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
