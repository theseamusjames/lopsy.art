//! Blur filters: gaussian, box, unsharp mask, motion, radial.

use wasm_bindgen::prelude::*;

use crate::Engine;
use crate::filter_gpu;
use crate::gpu::pass::Target;
use crate::gpu::texture_pool::TextureHandle;

#[wasm_bindgen(js_name = "filterGaussianBlur")]
pub fn filter_gaussian_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
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
        filter_gpu::apply_separable_blur_untyped(
            &mut engine.inner,
            layer_id,
            |e| &e.shaders.gaussian_blur,
            |pass| {
                let mut pass = pass.i32("u_radius", radius as i32);
                for (i, &w) in weights.iter().enumerate() {
                    pass = pass.f32(&format!("u_weights[{i}]"), w);
                }
                pass
            },
        );
    } else {
        // Large radius: 3 passes of strided box blur approximates Gaussian.
        // The stride lets each pass cover the full radius with only 63 samples.
        let step = ((radius + 62) / 63).max(1);
        let sample_radius = (radius / step).min(63);
        for _ in 0..3 {
            filter_gpu::apply_separable_blur_untyped(
                &mut engine.inner,
                layer_id,
                |e| &e.shaders.box_blur,
                |pass| {
                    pass
                        .i32("u_radius", sample_radius as i32)
                        .i32("u_step", step as i32)
                },
            );
        }
    }
}

#[wasm_bindgen(js_name = "filterBoxBlur")]
pub fn filter_box_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
    if radius == 0 { return; }
    filter_gpu::apply_separable_blur_untyped(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.box_blur,
        |pass| {
            pass
                .i32("u_radius", radius as i32)
        },
    );
}

#[wasm_bindgen(js_name = "filterUnsharpMask")]
pub fn filter_unsharp_mask(
    engine: &mut Engine, layer_id: &str,
    radius: u32, amount: f32, threshold: u32,
) {
    // Step 1: blur a copy into scratch B
    // Step 2: sharpen shader with original + blurred
    if radius == 0 { return; }

    // Match the rest of the filter pipeline: ensure layer/scratch sizes
    // align so pass-2 sampling doesn't read garbage outside the layer.
    let _ = engine.inner.ensure_layer_full_size(layer_id);

    // First do a gaussian blur pass (layer -> scratch B via scratch A)
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let inner = &engine.inner;
    let tex_handle = match inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if inner.texture_pool.get(tex_handle).is_none() {
        return;
    }

    let blur_pass = |src: TextureHandle, direction: (f32, f32)| {
        let mut pass = inner.pass_untyped(&inner.shaders.gaussian_blur)
            .texture("u_tex", src)
            .vec2("u_direction", direction.0, direction.1)
            .i32("u_radius", radius as i32);
        for (i, &wt) in kernel.iter().enumerate().take(64) {
            pass = pass.f32(&format!("u_weights[{i}]"), wt);
        }
        pass.viewport(0, 0, w as i32, h as i32)
    };
    // Horizontal pass: layer -> scratch A
    blur_pass(tex_handle, (1.0, 0.0)).draw(Target::Framebuffer(inner.scratch_fbo_a));
    // Vertical pass: scratch A -> scratch B
    blur_pass(inner.scratch_texture_a, (0.0, 1.0)).draw(Target::Framebuffer(inner.scratch_fbo_b));

    // Now apply sharpen shader: original (layer) + blurred (scratch B) -> scratch A
    inner.pass_untyped(&inner.shaders.sharpen)
        .texture("u_tex", tex_handle)
        .texture("u_blurredTex", inner.scratch_texture_b)
        .f32("u_amount", amount)
        .f32("u_threshold", threshold as f32)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Framebuffer(inner.scratch_fbo_a));

    // Sharpened result is in scratch A; confine it to the selection (#1176).
    filter_gpu::commit_scratch_a_to_layer(&mut engine.inner, layer_id);
}

#[wasm_bindgen(js_name = "filterMotionBlur")]
pub fn filter_motion_blur(engine: &mut Engine, layer_id: &str, angle: f32, distance: u32) {
    if distance == 0 { return; }
    filter_gpu::apply_filter_untyped(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.motion_blur,
        |pass| {
            pass
                .f32("u_angle", angle)
                .i32("u_distance", distance as i32)
        },
    );
}

#[wasm_bindgen(js_name = "filterTiltShiftBlur")]
pub fn filter_tilt_shift_blur(
    engine: &mut Engine,
    layer_id: &str,
    focus_position: f32,
    focus_width: f32,
    blur_radius: f32,
    angle: f32,
) {
    if blur_radius <= 0.0 { return; }
    let focus_position = focus_position.clamp(0.0, 1.0);
    let focus_width = focus_width.clamp(0.0, 1.0);
    let blur_radius = blur_radius.clamp(1.0, 32.0);
    filter_gpu::apply_filter_untyped(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.tilt_shift_blur,
        |pass| {
            pass
                .f32("u_focusPosition", focus_position)
                .f32("u_focusWidth", focus_width)
                .f32("u_blurRadius", blur_radius)
                .f32("u_angle", angle)
        },
    );
}

// Surface blur is a non-separable bilateral filter: the shader samples a
// (2r+1)^2 neighborhood per pixel, so cost grows with the square of the
// radius. A large radius would run a single draw call long enough to trip
// the GPU watchdog and drop the WebGL context, so the radius is capped here
// regardless of what the caller requests.
const SURFACE_BLUR_MAX_RADIUS: u32 = 50;

#[wasm_bindgen(js_name = "filterSurfaceBlur")]
pub fn filter_surface_blur(engine: &mut Engine, layer_id: &str, radius: u32, threshold: f32) {
    if radius == 0 { return; }
    let radius = radius.min(SURFACE_BLUR_MAX_RADIUS);
    let threshold = threshold.clamp(1.0, 255.0) / 255.0;
    filter_gpu::apply_filter_untyped(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.surface_blur,
        |pass| {
            pass
                .i32("u_radius", radius as i32)
                .f32("u_threshold", threshold)
        },
    );
}

#[wasm_bindgen(js_name = "filterRadialBlur")]
pub fn filter_radial_blur(engine: &mut Engine, layer_id: &str, amount: u32) {
    if amount == 0 { return; }
    let Some((_, _, cu, cv)) = super::full_size_doc_center(&mut engine.inner, layer_id) else {
        return;
    };
    filter_gpu::apply_filter_untyped(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.radial_blur,
        |pass| {
            pass
                .vec2("u_center", cu, cv)
                .i32("u_amount", amount as i32)
        },
    );
}
