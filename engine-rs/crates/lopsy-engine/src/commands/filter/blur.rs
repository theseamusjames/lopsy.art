//! Blur filters: gaussian, box, unsharp mask, motion, radial.


use crate::engine::EngineInner;
use crate::{filter_gpu, imaging};
use crate::gpu::pass::Target;
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::params::filters::{
    BoxBlurParams, GaussianBlurParams, SharpenParams,
};
use crate::gpu::uniforms::FloatArray;

pub fn filter_gaussian_blur(engine: &mut EngineInner, layer_id: &str, radius: u32) {
    if radius == 0 { return; }

    if radius <= 63 {
        // Small radius: single-pass exact Gaussian
        let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
        let center = radius as usize;
        let count = (radius as usize) + 1;
        let mut weights: Vec<f32> = kernel[center..center + count].to_vec();
        let raw_sum = weights[0] + 2.0 * weights[1..].iter().sum::<f32>();
        if raw_sum > 0.0 {
            for w in &mut weights { *w /= raw_sum; }
        }
        let weights = FloatArray::from_slice(&weights);
        filter_gpu::apply_separable_blur(
            &mut *engine,
            layer_id,
            |s| &s.gaussian_blur,
            |direction| GaussianBlurParams { direction, weights, radius: radius as i32 },
        );
    } else {
        // Large radius: 3 passes of strided box blur approximates Gaussian.
        // The stride lets each pass cover the full radius with only 63 samples.
        let step = ((radius + 62) / 63).max(1);
        let sample_radius = (radius / step).min(63);
        for _ in 0..3 {
            filter_gpu::apply_separable_blur(
                &mut *engine,
                layer_id,
                |s| &s.box_blur,
                |direction| BoxBlurParams { direction, radius: sample_radius as i32, step: step as i32 },
            );
        }
    }
}

pub fn filter_box_blur(engine: &mut EngineInner, layer_id: &str, radius: u32) {
    if radius == 0 { return; }
    filter_gpu::apply_separable_blur(
        &mut *engine,
        layer_id,
        |s| &s.box_blur,
        |direction| BoxBlurParams { direction, radius: radius as i32, step: 1 },
    );
}

pub fn filter_unsharp_mask(
    engine: &mut EngineInner, layer_id: &str,
    radius: u32, amount: f32, threshold: u32,
) {
    // Step 1: blur a copy into scratch B
    // Step 2: sharpen shader with original + blurred
    if radius == 0 { return; }

    // Match the rest of the filter pipeline: ensure layer/scratch sizes
    // align so pass-2 sampling doesn't read garbage outside the layer.
    let _ = engine.ensure_layer_full_size(layer_id);

    // First do a gaussian blur pass (layer -> scratch B via scratch A)
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let inner = &*engine;
    let tex_handle = match inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if inner.texture_pool.get(tex_handle).is_none() {
        return;
    }

    let weights = FloatArray::from_slice(&kernel);
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
    // Horizontal pass: layer -> scratch A
    blur_pass(tex_handle, (1.0, 0.0)).draw(Target::Framebuffer(inner.scratch_fbo_a));
    // Vertical pass: scratch A -> scratch B
    blur_pass(inner.scratch_texture_a, (0.0, 1.0)).draw(Target::Framebuffer(inner.scratch_fbo_b));

    // Now apply sharpen shader: original (layer) + blurred (scratch B) -> scratch A
    inner.pass(&inner.shaders.sharpen, SharpenParams { amount, threshold: threshold as f32 })
        .texture("u_tex", tex_handle)
        .texture("u_blurredTex", inner.scratch_texture_b)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(inner.scratch_fbo_a));

    // Sharpened result is in scratch A; confine it to the selection (#1176).
    filter_gpu::commit_scratch_a_to_layer(&mut *engine, layer_id);
}

pub fn filter_motion_blur(engine: &mut EngineInner, layer_id: &str, angle: f32, distance: u32) {
    if distance == 0 { return; }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::motion_blur(im, src, angle, distance));
}

pub fn filter_tilt_shift_blur(
    engine: &mut EngineInner,
    layer_id: &str,
    focus_position: f32,
    focus_width: f32,
    blur_radius: f32,
    angle: f32,
) {
    if blur_radius <= 0.0 { return; }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::tilt_shift_blur(im, src, focus_position, focus_width, blur_radius, angle));
}


pub fn filter_surface_blur(engine: &mut EngineInner, layer_id: &str, radius: u32, threshold: f32) {
    if radius == 0 { return; }
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::surface_blur(im, src, radius, threshold));
}

pub fn filter_radial_blur(engine: &mut EngineInner, layer_id: &str, amount: u32) {
    if amount == 0 { return; }
    let Some((_, _, cu, cv)) = super::full_size_doc_center(&mut *engine, layer_id) else {
        return;
    };
    filter_gpu::apply_op(engine, layer_id, |im, src| imaging::filters::blur::radial_blur(im, src, [cu, cv], amount));
}
