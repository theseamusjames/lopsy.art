//! Stylize filters: pixelate, halftone, kaleidoscope, oil paint, chromatic
//! aberration, pixel stretch, find edges, cel shading, bloom.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::Engine;
use crate::filter_gpu;

#[wasm_bindgen(js_name = "filterPixelate")]
pub fn filter_pixelate(engine: &mut Engine, layer_id: &str, block_size: u32) {
    if block_size <= 1 {
        return;
    }
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.pixelate,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_blockSize") {
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
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.halftone,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_dotSize") {
                gl.uniform1f(Some(&loc), dot_size);
            }
            if let Some(loc) = shader.location(gl, "u_density") {
                gl.uniform1f(Some(&loc), density);
            }
            if let Some(loc) = shader.location(gl, "u_angle") {
                gl.uniform1f(Some(&loc), angle);
            }
            if let Some(loc) = shader.location(gl, "u_contrast") {
                gl.uniform1f(Some(&loc), contrast);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterKaleidoscope")]
pub fn filter_kaleidoscope(engine: &mut Engine, layer_id: &str, segments: u32, rotation_degrees: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.kaleidoscope,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_segments") {
                gl.uniform1f(Some(&loc), segments.max(2) as f32);
            }
            if let Some(loc) = shader.location(gl, "u_rotation") {
                gl.uniform1f(Some(&loc), rotation_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterOilPaint")]
pub fn filter_oil_paint(engine: &mut Engine, layer_id: &str, radius: f32, sharpness: f32) {
    let radius = radius.clamp(1.0, 10.0);
    let sharpness = sharpness.clamp(0.1, 5.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.oil_paint,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_radius") {
                gl.uniform1f(Some(&loc), radius);
            }
            if let Some(loc) = shader.location(gl, "u_sharpness") {
                gl.uniform1f(Some(&loc), sharpness);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterChromaticAberration")]
pub fn filter_chromatic_aberration(engine: &mut Engine, layer_id: &str, amount: f32, angle_degrees: f32) {
    let amount = amount.clamp(0.0, 100.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.chromatic_aberration,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_amount") {
                gl.uniform1f(Some(&loc), amount);
            }
            if let Some(loc) = shader.location(gl, "u_angle") {
                gl.uniform1f(Some(&loc), angle_degrees.to_radians());
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterPixelStretch")]
pub fn filter_pixel_stretch(
    engine: &mut Engine,
    layer_id: &str,
    amount: f32,
    bands: f32,
    seed: f32,
    rgb_split: f32,
) {
    let amount = amount.clamp(0.0, 200.0);
    let bands = bands.clamp(2.0, 50.0);
    let rgb_split = rgb_split.clamp(0.0, 1.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.pixel_stretch,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_amount") {
                gl.uniform1f(Some(&loc), amount);
            }
            if let Some(loc) = shader.location(gl, "u_bands") {
                gl.uniform1f(Some(&loc), bands);
            }
            if let Some(loc) = shader.location(gl, "u_seed") {
                gl.uniform1f(Some(&loc), seed);
            }
            if let Some(loc) = shader.location(gl, "u_rgbSplit") {
                gl.uniform1f(Some(&loc), rgb_split);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterLensDistortion")]
pub fn filter_lens_distortion(
    engine: &mut Engine,
    layer_id: &str,
    strength: f32,
    zoom: f32,
    fringing: f32,
) {
    let strength = strength.clamp(-1.0, 1.0);
    let zoom = zoom.clamp(0.5, 2.0);
    let fringing = fringing.clamp(0.0, 1.0);
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.lens_distortion,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_strength") {
                gl.uniform1f(Some(&loc), strength);
            }
            if let Some(loc) = shader.location(gl, "u_zoom") {
                gl.uniform1f(Some(&loc), zoom);
            }
            if let Some(loc) = shader.location(gl, "u_fringing") {
                gl.uniform1f(Some(&loc), fringing);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterFindEdges")]
pub fn filter_find_edges(engine: &mut Engine, layer_id: &str) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.find_edges,
        |_gl, _shader| {},
    );
}

#[wasm_bindgen(js_name = "filterCelShading")]
pub fn filter_cel_shading(engine: &mut Engine, layer_id: &str, levels: u32, edge_strength: f32) {
    filter_gpu::apply_filter(
        &mut engine.inner,
        layer_id,
        |e| &e.shaders.cel_shading,
        |gl, shader| {
            if let Some(loc) = shader.location(gl, "u_levels") {
                gl.uniform1i(Some(&loc), levels as i32);
            }
            if let Some(loc) = shader.location(gl, "u_edgeStrength") {
                gl.uniform1f(Some(&loc), edge_strength);
            }
        },
    );
}

#[wasm_bindgen(js_name = "filterBloom")]
pub fn filter_bloom(
    engine: &mut Engine,
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

    let _ = engine.inner.ensure_layer_full_size(layer_id);

    let kernel = lopsy_core::filters::blur::gaussian_kernel(radius);

    let tex_handle = match engine.inner.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.inner.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    // Pass 1: Threshold — extract bright pixels (layer → scratch B)
    let gl = &engine.inner.gl;
    let thresh_shader = &engine.inner.shaders.bloom_threshold;
    gl.use_program(Some(&thresh_shader.program));
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_b);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = thresh_shader.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = thresh_shader.location(gl, "u_threshold") {
        gl.uniform1f(Some(&loc), threshold);
    }
    if let Some(loc) = thresh_shader.location(gl, "u_softKnee") {
        gl.uniform1f(Some(&loc), soft_knee);
    }
    engine.inner.draw_fullscreen_quad();

    // Pass 2: Horizontal blur (scratch B → scratch A)
    let gl = &engine.inner.gl;
    let blur_shader = &engine.inner.shaders.gaussian_blur;
    gl.use_program(Some(&blur_shader.program));
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_b) = engine.inner.texture_pool.get(engine.inner.scratch_texture_b) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_b));
    }
    if let Some(loc) = blur_shader.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = blur_shader.location(gl, "u_direction") {
        gl.uniform2f(Some(&loc), 1.0, 0.0);
    }
    if let Some(loc) = blur_shader.location(gl, "u_radius") {
        gl.uniform1i(Some(&loc), radius as i32);
    }
    for (i, &wt) in kernel.iter().enumerate().take(64) {
        let name = format!("u_weights[{i}]");
        if let Some(loc) = blur_shader.location(gl, &name) {
            gl.uniform1f(Some(&loc), wt);
        }
    }
    engine.inner.draw_fullscreen_quad();

    // Pass 3: Vertical blur (scratch A → scratch B)
    let gl = &engine.inner.gl;
    let blur_shader = &engine.inner.shaders.gaussian_blur;
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_b);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_a) = engine.inner.texture_pool.get(engine.inner.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_a));
    }
    if let Some(loc) = blur_shader.location(gl, "u_direction") {
        gl.uniform2f(Some(&loc), 0.0, 1.0);
    }
    engine.inner.draw_fullscreen_quad();

    // Pass 4: Combine — add bloom onto original (layer + scratch B → scratch A)
    let gl = &engine.inner.gl;
    let combine_shader = &engine.inner.shaders.bloom_combine;
    gl.use_program(Some(&combine_shader.program));
    engine.inner.fbo_pool.bind(gl, engine.inner.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = combine_shader.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(scratch_b) = engine.inner.texture_pool.get(engine.inner.scratch_texture_b) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_b));
    }
    if let Some(loc) = combine_shader.location(gl, "u_bloomTex") {
        gl.uniform1i(Some(&loc), 1);
    }
    if let Some(loc) = combine_shader.location(gl, "u_intensity") {
        gl.uniform1f(Some(&loc), intensity);
    }
    engine.inner.draw_fullscreen_quad();

    // Copy scratch A → layer texture
    let scratch_a_tex = engine.inner.texture_pool.get(engine.inner.scratch_texture_a).cloned();
    engine.inner.render_to_texture(&layer_tex, w as i32, h as i32, |eng| {
        let gl = &eng.gl;
        gl.use_program(Some(&eng.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(s) = &scratch_a_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
        }
        if let Some(loc) = eng.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        eng.draw_fullscreen_quad();
    });

    engine.inner.mark_layer_dirty(layer_id);
}
