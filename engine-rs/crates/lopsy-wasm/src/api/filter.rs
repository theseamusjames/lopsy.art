//! GPU-accelerated one-shot filters (Filter menu actions).
//!
//! These used to live inline in lib.rs as part of a 2700-line file. Each
//! filter is still a thin `#[wasm_bindgen]` wrapper that composes a shader
//! program with its uniforms via `filter_gpu::apply_filter` (or
//! `apply_separable_blur` for multi-pass effects). Moving them here keeps
//! lib.rs an actual API surface definition rather than an encyclopedia of
//! filter uniform plumbing.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::Engine;
use crate::filter_gpu;

// ============================================================
// Filters (GPU-accelerated)
// ============================================================

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

#[wasm_bindgen(js_name = "filterBrightnessContrast")]
pub fn filter_brightness_contrast(
    engine: &mut Engine, layer_id: &str, brightness: f32, contrast: f32,
) {
    let prog = engine.inner.shaders.adjustments.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_brightness") {
                gl.uniform1f(Some(&loc), brightness / 100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast / 100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_exposure") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_highlights") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_shadows") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_whites") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_blacks") {
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
    let prog = engine.inner.shaders.hue_sat.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_hue") {
                gl.uniform1f(Some(&loc), hue);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_saturation") {
                gl.uniform1f(Some(&loc), saturation);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_lightness") {
                gl.uniform1f(Some(&loc), lightness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterInvert")]
pub fn filter_invert(engine: &mut Engine, layer_id: &str) {
    let prog = engine.inner.shaders.invert.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |_gl, _prog| {},
    );
}

#[wasm_bindgen(js_name = "filterDesaturate")]
pub fn filter_desaturate(engine: &mut Engine, layer_id: &str) {
    // Desaturate = hue_sat with saturation = -100
    let prog = engine.inner.shaders.hue_sat.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_hue") {
                gl.uniform1f(Some(&loc), 0.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_saturation") {
                gl.uniform1f(Some(&loc), -100.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_lightness") {
                gl.uniform1f(Some(&loc), 0.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterPosterize")]
pub fn filter_posterize(engine: &mut Engine, layer_id: &str, levels: u32) {
    let prog = engine.inner.shaders.posterize.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_levels") {
                gl.uniform1f(Some(&loc), levels as f32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterPixelate")]
pub fn filter_pixelate(engine: &mut Engine, layer_id: &str, block_size: u32) {
    if block_size <= 1 {
        return;
    }
    let prog = engine.inner.shaders.pixelate.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_blockSize") {
                gl.uniform1f(Some(&loc), block_size as f32);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterHalftone")]
pub fn filter_halftone(engine: &mut Engine, layer_id: &str, dot_size: f32, density: f32, angle: f32, contrast: f32) {
    if dot_size < 2.0 {
        return;
    }
    let density = density.clamp(0.25, 3.0);
    let prog = engine.inner.shaders.halftone.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_dotSize") {
                gl.uniform1f(Some(&loc), dot_size);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_density") {
                gl.uniform1f(Some(&loc), density);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_angle") {
                gl.uniform1f(Some(&loc), angle);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterThreshold")]
pub fn filter_threshold(engine: &mut Engine, layer_id: &str, level: u32) {
    let prog = engine.inner.shaders.threshold.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_level") {
                gl.uniform1f(Some(&loc), level as f32 / 255.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterSolarize")]
pub fn filter_solarize(engine: &mut Engine, layer_id: &str, threshold: u32) {
    let prog = engine.inner.shaders.solarize.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_threshold") {
                gl.uniform1f(Some(&loc), threshold as f32 / 255.0);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterKaleidoscope")]
pub fn filter_kaleidoscope(engine: &mut Engine, layer_id: &str, segments: u32, rotation_degrees: f32) {
    let prog = engine.inner.shaders.kaleidoscope.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_segments") {
                gl.uniform1f(Some(&loc), segments.max(2) as f32);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_rotation") {
                gl.uniform1f(Some(&loc), rotation_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterOilPaint")]
pub fn filter_oil_paint(engine: &mut Engine, layer_id: &str, radius: f32, sharpness: f32) {
    let radius = radius.clamp(1.0, 10.0);
    let sharpness = sharpness.clamp(0.1, 5.0);
    let prog = engine.inner.shaders.oil_paint.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_radius") {
                gl.uniform1f(Some(&loc), radius);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_sharpness") {
                gl.uniform1f(Some(&loc), sharpness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterChromaticAberration")]
pub fn filter_chromatic_aberration(engine: &mut Engine, layer_id: &str, amount: f32, angle_degrees: f32) {
    let amount = amount.clamp(0.0, 100.0);
    let prog = engine.inner.shaders.chromatic_aberration.program.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_amount") {
                gl.uniform1f(Some(&loc), amount);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_angle") {
                gl.uniform1f(Some(&loc), angle_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterAddNoise")]
pub fn filter_add_noise(
    engine: &mut Engine, layer_id: &str,
    amount: f32, monochrome: bool,
) {
    let prog = engine.inner.shaders.noise.program.clone();
    let seed = engine.inner.selection_time as f32; // Use time as seed for randomness
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_amount") {
                gl.uniform1f(Some(&loc), amount / 255.0);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_monochrome") {
                gl.uniform1i(Some(&loc), if monochrome { 1 } else { 0 });
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterFillWithNoise")]
pub fn filter_fill_with_noise(engine: &mut Engine, layer_id: &str, monochrome: bool) {
    // Fill with noise = add noise at maximum amount to a cleared layer
    filter_add_noise(engine, layer_id, 255.0, monochrome);
}

// ============================================================
// New Effects (Motion Blur, Radial Blur, Find Edges, Cel Shading, Clouds, Smoke)
// ============================================================

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

#[wasm_bindgen(js_name = "filterFindEdges")]
pub fn filter_find_edges(engine: &mut Engine, layer_id: &str) {
    let prog = &engine.inner.shaders.find_edges.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |_gl, _prog| {},
    );
}

#[wasm_bindgen(js_name = "filterCelShading")]
pub fn filter_cel_shading(engine: &mut Engine, layer_id: &str, levels: u32, edge_strength: f32) {
    let prog = &engine.inner.shaders.cel_shading.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_levels") {
                gl.uniform1i(Some(&loc), levels as i32);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_edgeStrength") {
                gl.uniform1f(Some(&loc), edge_strength);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterClouds")]
pub fn filter_clouds(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32) {
    let prog = &engine.inner.shaders.clouds.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_scale") {
                gl.uniform1f(Some(&loc), scale);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterSmoke")]
pub fn filter_smoke(engine: &mut Engine, layer_id: &str, scale: f32, seed: f32, turbulence: f32) {
    let prog = &engine.inner.shaders.smoke.program;
    let prog_clone = prog.clone();
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        &prog_clone,
        |gl, prog| {
            if let Some(loc) = gl.get_uniform_location(prog, "u_scale") {
                gl.uniform1f(Some(&loc), scale);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
            if let Some(loc) = gl.get_uniform_location(prog, "u_turbulence") {
                gl.uniform1f(Some(&loc), turbulence);
            }
        },
    );
}

// ============================================================
// Filter Preview
// ============================================================

#[wasm_bindgen(js_name = "saveFilterPreview")]
pub fn save_filter_preview(engine: &mut Engine, layer_id: &str) {
    let inner = &mut engine.inner;
    let _ = inner.ensure_layer_full_size(layer_id);

    let gl = &inner.gl;
    let tex_handle = match inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    if let Some(old) = inner.filter_preview_texture.take() {
        inner.texture_pool.release(old);
    }
    let preview_handle = match inner.texture_pool.acquire(&inner.gl, w, h) {
        Ok(h) => h,
        Err(_) => return,
    };
    let preview_tex = match inner.texture_pool.get(preview_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&preview_tex),
        0,
    );
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(&inner.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    inner.draw_fullscreen_quad();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    inner.filter_preview_texture = Some(preview_handle);
    inner.filter_preview_layer_id = Some(layer_id.to_string());
}

#[wasm_bindgen(js_name = "restoreFilterPreview")]
pub fn restore_filter_preview(engine: &mut Engine) {
    let inner = &mut engine.inner;
    let preview_handle = match inner.filter_preview_texture {
        Some(h) => h,
        None => return,
    };
    let layer_id = match &inner.filter_preview_layer_id {
        Some(id) => id.clone(),
        None => return,
    };
    let layer_tex_handle = match inner.layer_textures.get(&layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = inner.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));
    let layer_tex = match inner.texture_pool.get(layer_tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };
    let preview_tex = match inner.texture_pool.get(preview_handle) {
        Some(t) => t.clone(),
        None => return,
    };
    let gl = &inner.gl;

    let temp_fbo = gl.create_framebuffer();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
    gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&layer_tex),
        0,
    );
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&inner.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&preview_tex));
    if let Some(loc) = gl.get_uniform_location(&inner.shaders.blit.program, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    inner.draw_fullscreen_quad();
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());

    inner.mark_layer_dirty(&layer_id);
}

#[wasm_bindgen(js_name = "clearFilterPreview")]
pub fn clear_filter_preview(engine: &mut Engine) {
    if let Some(tex) = engine.inner.filter_preview_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.filter_preview_layer_id = None;
}
