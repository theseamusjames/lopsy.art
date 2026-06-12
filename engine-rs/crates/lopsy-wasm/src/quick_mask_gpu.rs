use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;
use crate::gradient_gpu::{GradientStop, set_gradient_uniforms};

/// Flood-fill the quick mask texture. Reads the mask from the GPU, runs a
/// region-fill based on mask-value tolerance, and writes the result back.
///
/// `mode` 0 = brush (fill matched region to white/selected),
///        1 = eraser (fill matched region to black/unselected).
pub fn fill_quick_mask(
    engine: &mut EngineInner,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    // Read mask texture as RGBA
    let fbo = match engine.gl.create_framebuffer() {
        Some(f) => f,
        None => return,
    };
    let tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => {
            engine.gl.delete_framebuffer(Some(&fbo));
            return;
        }
    };

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&tex),
        0,
    );
    let rgba = match engine.texture_pool.read_rgba(&engine.gl, 0, 0, w, h) {
        Ok(d) => d,
        Err(_) => {
            engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
            engine.gl.delete_framebuffer(Some(&fbo));
            return;
        }
    };
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));

    // Extract grayscale from RGBA
    let mut mask = vec![0u8; (w * h) as usize];
    for i in 0..(w * h) as usize {
        mask[i] = rgba[i * 4];
    }

    // Get seed value
    if start_x >= w || start_y >= h { return; }
    let seed_idx = start_y as usize * w as usize + start_x as usize;
    let seed_val = mask[seed_idx];

    // Flood fill: find all pixels within tolerance of the seed
    let fill_val: u8 = if mode == 0 { 255 } else { 0 };
    let tol = tolerance as i32;

    if contiguous {
        // Flood fill from seed point
        let mut visited = vec![false; mask.len()];
        let mut stack = vec![(start_x as i32, start_y as i32)];
        while let Some((px, py)) = stack.pop() {
            if px < 0 || px >= w as i32 || py < 0 || py >= h as i32 { continue; }
            let idx = py as usize * w as usize + px as usize;
            if visited[idx] { continue; }
            visited[idx] = true;
            let val = mask[idx] as i32;
            if (val - seed_val as i32).abs() <= tol {
                mask[idx] = fill_val;
                // 4-way neighbors
                stack.push((px + 1, py));
                stack.push((px - 1, py));
                stack.push((px, py + 1));
                stack.push((px, py - 1));
            }
        }
    } else {
        // Non-contiguous: fill all pixels within tolerance
        for i in 0..mask.len() {
            if (mask[i] as i32 - seed_val as i32).abs() <= tol {
                mask[i] = fill_val;
            }
        }
    }

    // Upload back as RGBA
    let mut rgba_out = vec![0u8; (w * h * 4) as usize];
    for i in 0..(w * h) as usize {
        let v = mask[i];
        rgba_out[i * 4] = v;
        rgba_out[i * 4 + 1] = v;
        rgba_out[i * 4 + 2] = v;
        rgba_out[i * 4 + 3] = 255;
    }
    let _ = engine.texture_pool.upload_rgba(&engine.gl, tex_handle, 0, 0, w, h, &rgba_out);
    engine.needs_recomposite = true;
}

/// Enter quick mask mode: copy selection_mask_texture to quick_mask_texture
/// using a GPU-to-GPU blit.
pub fn enter_quick_mask_mode(engine: &mut EngineInner) {
    let Some(sel_handle) = engine.selection_mask_texture else {
        // No selection: create an empty (all-zero) quick mask texture
        let (w, h) = (engine.doc_width, engine.doc_height);
        if let Some(old) = engine.quick_mask_texture.take() {
            engine.texture_pool.release(old);
        }
        let tex = match engine.texture_pool.acquire(&engine.gl, w, h) {
            Ok(t) => t,
            Err(_) => return,
        };
        engine.texture_pool.set_nearest_filter(&engine.gl, tex);
        // Clear to zero (fully unselected)
        let zero_data = vec![0u8; (w * h * 4) as usize];
        let _ = engine.texture_pool.upload_rgba(&engine.gl, tex, 0, 0, w, h, &zero_data);
        engine.quick_mask_texture = Some(tex);
        engine.needs_recomposite = true;
        return;
    };

    let (w, h) = engine.texture_pool.get_size(sel_handle).unwrap_or((engine.doc_width, engine.doc_height));

    // Release old quick mask texture
    if let Some(old) = engine.quick_mask_texture.take() {
        engine.texture_pool.release(old);
    }

    // Create new quick mask texture at selection mask size
    let tex = match engine.texture_pool.acquire(&engine.gl, w, h) {
        Ok(t) => t,
        Err(_) => return,
    };
    engine.texture_pool.set_nearest_filter(&engine.gl, tex);

    // GPU-to-GPU copy: blit selection mask to quick mask texture
    let sel_gl = match engine.texture_pool.get(sel_handle) {
        Some(t) => t.clone(),
        None => {
            engine.texture_pool.release(tex);
            return;
        }
    };
    let dst_gl = match engine.texture_pool.get(tex) {
        Some(t) => t.clone(),
        None => return,
    };

    engine.render_to_texture(&dst_gl, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        gl.use_program(Some(&engine.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&sel_gl));
        if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        engine.draw_fullscreen_quad();
    });

    engine.quick_mask_texture = Some(tex);
    engine.needs_recomposite = true;
}

/// Exit quick mask mode: read back the quick mask texture as single-channel
/// grayscale data. Returns the mask data so the TS side can convert it to
/// a selection.
pub fn exit_quick_mask_mode(engine: &mut EngineInner) -> Option<Vec<u8>> {
    let handle = engine.quick_mask_texture.take()?;
    let (w, h) = engine.texture_pool.get_size(handle)?;

    // Read RGBA from the texture
    let fbo = match engine.gl.create_framebuffer() {
        Some(f) => f,
        None => {
            engine.texture_pool.release(handle);
            return None;
        }
    };
    let tex = match engine.texture_pool.get(handle) {
        Some(t) => t.clone(),
        None => {
            engine.gl.delete_framebuffer(Some(&fbo));
            return None;
        }
    };

    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&fbo));
    engine.gl.framebuffer_texture_2d(
        WebGl2RenderingContext::FRAMEBUFFER,
        WebGl2RenderingContext::COLOR_ATTACHMENT0,
        WebGl2RenderingContext::TEXTURE_2D,
        Some(&tex),
        0,
    );
    let rgba = engine.texture_pool.read_rgba(&engine.gl, 0, 0, w, h).ok();
    engine.gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    engine.gl.delete_framebuffer(Some(&fbo));
    engine.texture_pool.release(handle);
    engine.needs_recomposite = true;

    // Extract single-channel from RGBA (R channel is the mask value)
    rgba.map(|data| {
        let mut single = vec![0u8; (w * h) as usize];
        for i in 0..(w * h) as usize {
            single[i] = data[i * 4];
        }
        single
    })
}

/// Read the quick mask texture as single-channel grayscale pixels.
/// Returns `(width, height, mask_bytes)` on success, or `(0, 0, vec![])`
/// when no quick mask texture is active.
pub fn read_quick_mask_pixels(engine: &EngineInner) -> (u32, u32, Vec<u8>) {
    let Some(handle) = engine.quick_mask_texture else { return (0, 0, Vec::new()) };
    let Some((w, h)) = engine.texture_pool.get_size(handle) else { return (0, 0, Vec::new()) };
    let Some(tex) = engine.texture_pool.get(handle).cloned() else { return (0, 0, Vec::new()) };

    match engine.read_texture_rgba8(&tex, w, h) {
        Some(data) => {
            let mut single = vec![0u8; (w * h) as usize];
            for i in 0..(w * h) as usize {
                single[i] = data[i * 4];
            }
            (w, h, single)
        }
        None => (0, 0, Vec::new()),
    }
}

/// Upload single-channel grayscale pixels into the quick mask texture.
/// Expands to RGBA (replicates the R channel into G/B and sets A=255).
/// No-op when no quick mask texture is active or when `data.len() != w * h`.
pub fn upload_quick_mask_pixels(
    engine: &mut EngineInner,
    data: &[u8],
    w: u32,
    h: u32,
) {
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    if data.len() != (w * h) as usize { return; }
    let (tex_w, tex_h) = match engine.texture_pool.get_size(tex_handle) {
        Some(s) => s,
        None => return,
    };
    if tex_w != w || tex_h != h { return; }

    let mut rgba = vec![0u8; (w * h * 4) as usize];
    for i in 0..(w * h) as usize {
        let v = data[i];
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }
    let _ = engine.texture_pool.upload_rgba(&engine.gl, tex_handle, 0, 0, w, h, &rgba);
    engine.needs_recomposite = true;
}

/// Paint a brush dab on the quick mask texture. Mode 0 = brush (add), 1 = eraser (remove).
pub fn paint_quick_mask_dab(
    engine: &mut EngineInner,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    paint_quick_mask_dab_batch(engine, &[cx, cy], size, hardness, opacity, mode);
}

/// Paint multiple dabs on the quick mask texture.
pub fn paint_quick_mask_dab_batch(
    engine: &mut EngineInner,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let mask_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let gl = &engine.gl;

    // Render each dab: read existing mask, apply dab, write back via scratch FBO
    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        let cx = chunk[0] as f32;
        let cy = chunk[1] as f32;

        // Render dab to scratch
        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        let shader = &engine.shaders.quick_mask_dab;
        gl.use_program(Some(&shader.program));

        // Bind existing mask texture
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&mask_tex));
        if let Some(loc) = shader.location(gl, "u_maskTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_center") {
            gl.uniform2f(Some(&loc), cx, cy);
        }
        if let Some(loc) = shader.location(gl, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }
        if let Some(loc) = shader.location(gl, "u_hardness") {
            gl.uniform1f(Some(&loc), hardness);
        }
        if let Some(loc) = shader.location(gl, "u_opacity") {
            gl.uniform1f(Some(&loc), opacity);
        }
        if let Some(loc) = shader.location(gl, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }
        if let Some(loc) = shader.location(gl, "u_mode") {
            gl.uniform1i(Some(&loc), mode as i32);
        }

        engine.draw_fullscreen_quad();

        // Blit scratch back to quick mask texture
        let scratch_a_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();
        engine.render_to_texture(&mask_tex, w as i32, h as i32, |engine| {
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

    engine.needs_recomposite = true;
}

/// Draw a pencil line on the quick mask texture.
pub fn draw_quick_mask_pencil_line(
    engine: &mut EngineInner,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    _r: f32,
    _g: f32,
    _b: f32,
    a: f32,
    size: f32,
    mode: u32,
) {
    // Pencil renders hard square pixel blocks — same GPU path as the
    // layer-mask pencil (one scissored draw per point, no CPU uploads).
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let value = if mode == 0 { a } else { 0.0 };
    crate::mask_paint_gpu::draw_pencil_blocks_gpu(engine, tex_handle, x0, y0, x1, y1, size, value);
    engine.needs_recomposite = true;
}

/// Render a linear gradient into the quick mask texture. Mirrors
/// `mask_paint_gpu::render_mask_linear_gradient` but targets
/// `engine.quick_mask_texture`. The quick mask texture covers the whole
/// document, so no per-layer offset is applied.
pub fn render_quick_mask_linear_gradient(
    engine: &mut EngineInner,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let mask_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let gl = &engine.gl;

    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&mask_tex));
    if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    let scratch_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();

    engine.render_to_texture(&mask_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.gradient_linear;
        gl.use_program(Some(&shader.program));

        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(s) = &scratch_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
        }
        if let Some(loc) = shader.location(gl, "u_existingTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_hasMask") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_docSize") {
            gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
        }
        if let Some(loc) = shader.location(gl, "u_layerOffset") {
            gl.uniform2f(Some(&loc), 0.0, 0.0);
        }

        set_gradient_uniforms(gl, shader, &stops, w, h);
        if let Some(loc) = shader.location(gl, "u_start") {
            gl.uniform2f(Some(&loc), start_x as f32, start_y as f32);
        }
        if let Some(loc) = shader.location(gl, "u_end") {
            gl.uniform2f(Some(&loc), end_x as f32, end_y as f32);
        }

        engine.draw_fullscreen_quad();
    });

    engine.needs_recomposite = true;
}

/// Render a radial gradient into the quick mask texture. Mirrors
/// `mask_paint_gpu::render_mask_radial_gradient` but targets
/// `engine.quick_mask_texture`.
pub fn render_quick_mask_radial_gradient(
    engine: &mut EngineInner,
    center_x: f64,
    center_y: f64,
    radius: f64,
    stops_json: &str,
) {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let mask_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let gl = &engine.gl;

    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&mask_tex));
    if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    let scratch_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();

    engine.render_to_texture(&mask_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.gradient_radial;
        gl.use_program(Some(&shader.program));

        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(s) = &scratch_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
        }
        if let Some(loc) = shader.location(gl, "u_existingTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_hasMask") {
            gl.uniform1i(Some(&loc), 0);
        }
        if let Some(loc) = shader.location(gl, "u_docSize") {
            gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
        }
        if let Some(loc) = shader.location(gl, "u_layerOffset") {
            gl.uniform2f(Some(&loc), 0.0, 0.0);
        }

        set_gradient_uniforms(gl, shader, &stops, w, h);
        if let Some(loc) = shader.location(gl, "u_center") {
            gl.uniform2f(Some(&loc), center_x as f32, center_y as f32);
        }
        if let Some(loc) = shader.location(gl, "u_radius") {
            gl.uniform1f(Some(&loc), radius as f32);
        }

        engine.draw_fullscreen_quad();
    });

    engine.needs_recomposite = true;
}
