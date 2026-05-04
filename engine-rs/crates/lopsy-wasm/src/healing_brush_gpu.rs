use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

/// Apply a healing brush dab entirely on the GPU, preserving FP16 precision.
///
/// Algorithm:
///  1. Compute mean color of source region (multi-tap shader → 1x1 readback)
///  2. Compute mean color of destination region
///  3. Apply healing formula in a fullscreen shader: healed = src - srcMean + dstMean
pub fn apply_healing_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    dest_x: f64,
    dest_y: f64,
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
    opacity: f32,
) {
    apply_healing_dab_batch(
        engine,
        layer_id,
        &[dest_x, dest_y],
        source_offset_x,
        source_offset_y,
        size,
        opacity,
    );
}

pub fn apply_healing_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
    opacity: f32,
) {
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let radius = size * 0.5;

    for chunk in points.chunks(2) {
        if chunk.len() < 2 {
            break;
        }
        let dx = chunk[0] as f32;
        let dy = chunk[1] as f32;

        // --- Pass 1: Compute source mean ---
        let src_mean = compute_region_mean(
            engine,
            &layer_tex,
            w,
            h,
            dx + source_offset_x as f32,
            dy + source_offset_y as f32,
            radius,
        );

        // --- Pass 2: Compute destination mean ---
        let dst_mean = compute_region_mean(engine, &layer_tex, w, h, dx, dy, radius);

        // --- Pass 3: Apply healing dab ---
        let gl = &engine.gl;
        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        let shader = &engine.shaders.healing_dab;
        gl.use_program(Some(&shader.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = shader.location(gl, "u_layerTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_center") {
            gl.uniform2f(Some(&loc), dx, dy);
        }
        if let Some(loc) = shader.location(gl, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }
        if let Some(loc) = shader.location(gl, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }
        if let Some(loc) = shader.location(gl, "u_sourceOffset") {
            gl.uniform2f(Some(&loc), source_offset_x as f32, source_offset_y as f32);
        }
        if let Some(loc) = shader.location(gl, "u_opacity") {
            gl.uniform1f(Some(&loc), opacity);
        }
        if let Some(loc) = shader.location(gl, "u_srcMeanRGB") {
            gl.uniform3f(Some(&loc), src_mean[0], src_mean[1], src_mean[2]);
        }
        if let Some(loc) = shader.location(gl, "u_dstMeanRGB") {
            gl.uniform3f(Some(&loc), dst_mean[0], dst_mean[1], dst_mean[2]);
        }

        engine.draw_fullscreen_quad();

        // Copy scratch A back to layer texture
        let scratch_a_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();
        engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
            let gl = &engine.gl;
            gl.use_program(Some(&engine.shaders.blit.program));
            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            if let Some(s) = &scratch_a_tex {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
            }
            if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
                gl.uniform1i(Some(&loc), 0);
            }
            engine.draw_fullscreen_quad();
        });
    }

    engine.mark_layer_dirty(layer_id);
}

/// Compute the mean RGB color of a circular region using the healing_mean shader.
/// Renders to a 1x1 pixel on scratch_fbo_b and reads back the result.
fn compute_region_mean(
    engine: &mut EngineInner,
    layer_tex: &web_sys::WebGlTexture,
    tex_w: u32,
    tex_h: u32,
    center_x: f32,
    center_y: f32,
    radius: f32,
) -> [f32; 3] {
    let gl = &engine.gl;

    // Render the mean shader to scratch FBO B at 1x1 viewport
    engine.fbo_pool.bind(gl, engine.scratch_fbo_b);
    gl.viewport(0, 0, 1, 1);

    let shader = &engine.shaders.healing_mean;
    gl.use_program(Some(&shader.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(layer_tex));
    if let Some(loc) = shader.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = shader.location(gl, "u_center") {
        gl.uniform2f(Some(&loc), center_x, center_y);
    }
    if let Some(loc) = shader.location(gl, "u_radius") {
        gl.uniform1f(Some(&loc), radius);
    }
    if let Some(loc) = shader.location(gl, "u_texSize") {
        gl.uniform2f(Some(&loc), tex_w as f32, tex_h as f32);
    }

    engine.draw_fullscreen_quad();

    // Read back the 1x1 pixel
    let mut buf = [0u8; 4];
    gl.read_pixels_with_opt_u8_array(
        0,
        0,
        1,
        1,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        Some(&mut buf),
    )
    .ok();

    engine.fbo_pool.unbind(gl);

    [
        buf[0] as f32 / 255.0,
        buf[1] as f32 / 255.0,
        buf[2] as f32 / 255.0,
    ]
}
