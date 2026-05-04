use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

pub fn set_selection_mask(
    engine: &mut EngineInner,
    mask_data: &[u8],
    width: u32,
    height: u32,
) {
    let gl = &engine.gl;

    // Release old selection texture if present
    if let Some(old_tex) = engine.selection_mask_texture.take() {
        engine.texture_pool.release(old_tex);
    }

    // Create new texture for the mask
    let tex_handle = match engine.texture_pool.acquire(gl, width, height) {
        Ok(h) => h,
        Err(_) => return,
    };

    // Upload mask as RGBA (mask value in R channel, replicated to all channels)
    // The mask data is single-channel, so expand to RGBA
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for i in 0..(width * height) as usize {
        let v = if i < mask_data.len() { mask_data[i] } else { 0 };
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }

    let _ = engine.texture_pool.upload_rgba(
        gl, tex_handle, 0, 0, width, height, &rgba,
    );

    // Use NEAREST filtering to avoid interpolation at mask boundaries
    engine.texture_pool.set_nearest_filter(gl, tex_handle);

    engine.selection_mask_texture = Some(tex_handle);
    engine.needs_recomposite = true;
}

/// Apply a Gaussian blur to the current selection mask texture on the GPU.
/// This implements feathering entirely in GPU space, preserving precision
/// and running at interactive speed regardless of document size.
pub fn feather_selection_mask(engine: &mut EngineInner, radius: u32) {
    if radius == 0 { return; }

    let mask_handle = match engine.selection_mask_texture {
        Some(h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(mask_handle).unwrap_or((1, 1));
    let mask_tex = match engine.texture_pool.get(mask_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    // Switch to LINEAR filtering for smooth blur sampling
    engine.texture_pool.set_linear_filter(&engine.gl, mask_handle);

    let clamped_radius = radius.min(63) as usize;
    let weights = gaussian_weights(clamped_radius);

    let gl = &engine.gl;
    let shader = &engine.shaders.gaussian_blur;
    gl.use_program(Some(&shader.program));

    // Upload weights
    if let Some(loc) = shader.location(gl, "u_radius") {
        gl.uniform1i(Some(&loc), clamped_radius as i32);
    }
    if let Some(loc) = shader.location(gl, "u_weights[0]") {
        let mut w64 = [0.0f32; 64];
        for (i, &v) in weights.iter().enumerate() {
            if i < 64 { w64[i] = v; }
        }
        gl.uniform1fv_with_f32_array(Some(&loc), &w64);
    }

    // Pass 1: horizontal — mask → scratch A
    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&mask_tex));
    if let Some(loc) = shader.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = shader.location(gl, "u_direction") {
        gl.uniform2f(Some(&loc), 1.0, 0.0);
    }
    engine.draw_fullscreen_quad();

    // Pass 2: vertical — scratch A → scratch B
    engine.fbo_pool.bind(gl, engine.scratch_fbo_b);
    gl.viewport(0, 0, w as i32, h as i32);
    if let Some(scratch_a) = engine.texture_pool.get(engine.scratch_texture_a) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_a));
    }
    if let Some(loc) = shader.location(gl, "u_direction") {
        gl.uniform2f(Some(&loc), 0.0, 1.0);
    }
    engine.draw_fullscreen_quad();
    engine.fbo_pool.unbind(gl);

    // Copy scratch B → mask texture
    let scratch_b_tex = engine.texture_pool.get(engine.scratch_texture_b).cloned();
    engine.render_to_texture(&mask_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        gl.use_program(Some(&engine.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(s) = &scratch_b_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
        }
        if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        engine.draw_fullscreen_quad();
    });

    // Keep LINEAR filtering so feathered mask samples smoothly
    engine.needs_recomposite = true;
}

fn gaussian_weights(radius: usize) -> Vec<f32> {
    let sigma = (radius as f32) / 2.0;
    let mut weights = Vec::with_capacity(radius + 1);
    let mut sum = 0.0f32;
    for i in 0..=radius {
        let w = (-((i as f32) * (i as f32)) / (2.0 * sigma * sigma)).exp();
        weights.push(w);
        sum += if i == 0 { w } else { 2.0 * w };
    }
    for w in weights.iter_mut() {
        *w /= sum;
    }
    weights
}
