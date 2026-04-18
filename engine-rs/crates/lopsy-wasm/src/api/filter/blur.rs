//! Blur filters: gaussian, box, unsharp mask, motion, radial.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterGaussianBlur")]
pub fn filter_gaussian_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
    if radius == 0 { return; }
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let prog = &engine.inner.shaders.gaussian_blur.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_separable_blur(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_radius") {
                gl.uniform1i(Some(&loc), radius as i32);
            }
            // Upload kernel weights
            for (i, &w) in kernel.iter().enumerate().take(64) {
                let name = format!("u_weights[{i}]");
                if let Some(loc) = gl.get_uniform_location(prog, &name) {
                    gl.uniform1f(Some(&loc), w);
                }
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterBoxBlur")]
pub fn filter_box_blur(engine: &mut Engine, layer_id: &str, radius: u32) {
    if radius == 0 { return; }
    let prog = &engine.inner.shaders.box_blur.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_separable_blur(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_radius") {
                gl.uniform1i(Some(&loc), radius as i32);
            }
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

    // First do a gaussian blur pass (layer -> scratch B via scratch A)
    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);
    let gl = &engine.inner.gl;
    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let blur_prog = &engine.inner.shaders.gaussian_blur.program;
    gl.use_program(Some(blur_prog));

    // Horizontal pass: layer -> scratch A
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_direction") {
        gl.uniform2f(Some(&loc), 1.0, 0.0);
    }
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_radius") {
        gl.uniform1i(Some(&loc), radius as i32);
    }
    for (i, &wt) in kernel.iter().enumerate().take(64) {
        let name = format!("u_weights[{i}]");
        if let Some(loc) = gl.get_uniform_location(blur_prog, &name) {
            gl.uniform1f(Some(&loc), wt);
        }
    }
    engine.inner.draw_fullscreen_quad();

    // Vertical pass: scratch A -> scratch B
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_b);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_a) = engine.inner.texture_pool.get(engine.inner.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_a));
    }
    if let Some(loc) = gl.get_uniform_location(blur_prog, "u_direction") {
        gl.uniform2f(Some(&loc), 0.0, 1.0);
    }
    engine.inner.draw_fullscreen_quad();

    // Now apply sharpen shader: original (layer) + blurred (scratch B) -> scratch A
    let sharpen_prog = &engine.inner.shaders.sharpen.program;
    gl.use_program(Some(sharpen_prog));
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);

    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(scratch_b) = engine.inner.texture_pool.get(engine.inner.scratch_texture_b) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_b));
    }
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_blurredTex") {
        gl.uniform1i(Some(&loc), 1);
    }
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_amount") {
        gl.uniform1f(Some(&loc), amount);
    }
    if let Some(loc) = gl.get_uniform_location(sharpen_prog, "u_threshold") {
        gl.uniform1f(Some(&loc), threshold as f32);
    }
    engine.inner.draw_fullscreen_quad();

    // Copy scratch A -> layer texture
    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.use_program(Some(&engine.inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_a) = engine.inner.texture_pool.get(engine.inner.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_a));
    }
    if let Some(loc) = gl.get_uniform_location(&engine.inner.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.inner.draw_fullscreen_quad();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    engine.inner.mark_layer_dirty(layer_id);
}

#[wasm_bindgen(js_name = "filterMotionBlur")]
pub fn filter_motion_blur(engine: &mut Engine, layer_id: &str, angle: f32, distance: u32) {
    if distance == 0 { return; }
    let prog = &engine.inner.shaders.motion_blur.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_angle") {
                gl.uniform1f(Some(&loc), angle);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_distance") {
                gl.uniform1i(Some(&loc), distance as i32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterRadialBlur")]
pub fn filter_radial_blur(engine: &mut Engine, layer_id: &str, amount: u32) {
    if amount == 0 { return; }
    let prog = &engine.inner.shaders.radial_blur.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
                gl.uniform2f(Some(&loc), 0.5, 0.5);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_amount") {
                gl.uniform1i(Some(&loc), amount as i32);
            }
        },
    );
}
