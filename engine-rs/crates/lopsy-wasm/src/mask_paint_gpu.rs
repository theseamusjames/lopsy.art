use web_sys::WebGl2RenderingContext;
use crate::compositor::mask_doc_origin;
use crate::engine::EngineInner;

// Every layer-mask writer here takes DOCUMENT-space coordinates and maps
// them into mask texels with `mask_doc_origin` — the same origin the
// compositor samples the mask at — so painting always lands where the
// mask is displayed, however the layer's own x/y has been re-origined by
// crop/expand/prewarm (#907).

pub fn paint_mask_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    paint_mask_dab_batch(engine, layer_id, &[cx, cy], size, hardness, opacity, mode);
}

pub fn paint_mask_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let origin = mask_doc_origin(engine, layer_id);
    let dab = MaskDab { size, hardness, opacity, mode };
    paint_mask_dabs_scissored(engine, tex_handle, points, origin, dab);
    engine.mark_layer_dirty(layer_id);
}

#[derive(Clone, Copy)]
pub(crate) struct MaskDab {
    pub size: f32,
    pub hardness: f32,
    pub opacity: f32,
    pub mode: u32,
}

/// Paint round `quick_mask_dab` dabs into a mask-style RGBA texture.
/// `points` are (x, y) pairs; `origin` is subtracted to get texel
/// coordinates. Shared by layer masks and the Quick Mask.
///
/// The dab shader reads the mask it modifies, so each dab renders into
/// scratch and is copied back. Both passes are scissored to the dab's
/// bounding box (#1020): the shader passes every texel outside the
/// radius through unchanged, so the rect-limited result is identical to
/// rendering the whole texture — which cost two full-texture passes per
/// dab (~60 s of queued GPU work for one stroke on a 4096² mask). Texels
/// of scratch outside the rect are stale but never copied back.
pub(crate) fn paint_mask_dabs_scissored(
    engine: &mut EngineInner,
    tex_handle: crate::gpu::texture_pool::TextureHandle,
    points: &[f64],
    origin: (f32, f32),
    dab: MaskDab,
) {
    let Some((w, h)) = engine.texture_pool.get_size(tex_handle) else { return };
    let Some(mask_tex) = engine.texture_pool.get(tex_handle).cloned() else { return };
    // The copy-back samples scratch by v_uv, so scratch must match the mask exactly.
    if engine.ensure_scratch_size(w, h).is_err() { return; }
    let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a).cloned() else { return };
    let (ox, oy) = origin;

    let gl = &engine.gl;
    let dab_shader = &engine.shaders.quick_mask_dab;
    gl.use_program(Some(&dab_shader.program));
    if let Some(loc) = dab_shader.location(gl, "u_maskTex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = dab_shader.location(gl, "u_size") {
        gl.uniform1f(Some(&loc), dab.size);
    }
    if let Some(loc) = dab_shader.location(gl, "u_hardness") {
        gl.uniform1f(Some(&loc), dab.hardness);
    }
    if let Some(loc) = dab_shader.location(gl, "u_opacity") {
        gl.uniform1f(Some(&loc), dab.opacity);
    }
    if let Some(loc) = dab_shader.location(gl, "u_texSize") {
        gl.uniform2f(Some(&loc), w as f32, h as f32);
    }
    if let Some(loc) = dab_shader.location(gl, "u_mode") {
        gl.uniform1i(Some(&loc), dab.mode as i32);
    }
    let u_center_loc = dab_shader.location(gl, "u_center");
    let blit = &engine.shaders.blit;
    gl.use_program(Some(&blit.program));
    if let Some(loc) = blit.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }

    gl.enable(WebGl2RenderingContext::SCISSOR_TEST);
    for chunk in points.chunks_exact(2) {
        let cx = chunk[0] as f32 - ox;
        let cy = chunk[1] as f32 - oy;
        let Some([x, y, rw, rh]) =
            lopsy_core::brush::circle_dab_scissor_rect(cx, cy, dab.size, w, h) else { continue };

        let gl = &engine.gl;
        gl.scissor(x, y, rw, rh);
        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);
        gl.use_program(Some(&engine.shaders.quick_mask_dab.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&mask_tex));
        if let Some(loc) = &u_center_loc {
            gl.uniform2f(Some(loc), cx, cy);
        }
        engine.draw_fullscreen_quad();

        engine.render_to_texture(&mask_tex, w as i32, h as i32, |engine| {
            let gl = &engine.gl;
            gl.use_program(Some(&engine.shaders.blit.program));
            gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&scratch_tex));
            engine.draw_fullscreen_quad();
        });
    }
    engine.gl.disable(WebGl2RenderingContext::SCISSOR_TEST);
}

/// Render hard square pencil blocks into a mask-style RGBA texture
/// entirely on the GPU: one scissored draw per interpolated point with
/// the shared `pencil_dab` shader. Replaces the old CPU path that issued
/// a texSubImage2D upload per point, which made mask pencil strokes on
/// large documents unusably slow. `value` is the mask value to write
/// (1.0 = reveal/select, 0.0 = hide/deselect); the pixel geometry is
/// identical to the layer pencil (`brush_gpu::draw_pencil_line`).
pub(crate) fn draw_pencil_blocks_gpu(
    engine: &mut EngineInner,
    tex_handle: crate::gpu::texture_pool::TextureHandle,
    x0: f64, y0: f64, x1: f64, y1: f64,
    size: f32,
    value: f32,
) {
    if size <= 0.0 { return; }
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let Some(target_tex) = engine.texture_pool.get(tex_handle).cloned() else { return };

    let points = lopsy_core::brush::interpolate_points(x0, y0, x1, y1, 1.0);
    if points.len() < 2 { return; }

    let half = (size / 2.0).floor() as i32;
    let block = size.ceil() as i32;
    let tex_w_i = w as i32;
    let tex_h_i = h as i32;

    engine.render_to_texture(&target_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        gl.disable(WebGl2RenderingContext::BLEND);

        let shader = &engine.shaders.pencil_dab;
        gl.use_program(Some(&shader.program));
        if let Some(loc) = shader.location(gl, "u_color") {
            gl.uniform4f(Some(&loc), value, value, value, 1.0);
        }
        if let Some(loc) = shader.location(gl, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }
        if let Some(loc) = shader.location(gl, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }
        // Mask painting writes the mask itself — never clipped by selection.
        if let Some(loc) = shader.location(gl, "u_hasSelection") {
            gl.uniform1i(Some(&loc), 0);
        }

        gl.enable(WebGl2RenderingContext::SCISSOR_TEST);
        let u_center_loc = shader.location(gl, "u_center");
        for chunk in points.chunks(2) {
            if chunk.len() < 2 { break; }
            let cx = chunk[0] as f32;
            let cy = chunk[1] as f32;

            let lo_x = (cx.floor() as i32 - half).max(0);
            let lo_y = (cy.floor() as i32 - half).max(0);
            let hi_x = (cx.floor() as i32 - half + block).min(tex_w_i);
            let hi_y = (cy.floor() as i32 - half + block).min(tex_h_i);
            if hi_x <= lo_x || hi_y <= lo_y { continue; }
            gl.scissor(lo_x, lo_y, hi_x - lo_x, hi_y - lo_y);

            if let Some(loc) = &u_center_loc {
                gl.uniform2f(Some(loc), cx, cy);
            }
            engine.draw_fullscreen_quad();
        }
        gl.disable(WebGl2RenderingContext::SCISSOR_TEST);
    });
}

pub fn draw_mask_pencil_line(
    engine: &mut EngineInner,
    layer_id: &str,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    a: f32,
    size: f32,
    mode: u32,
) {
    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let value = if mode == 0 { a } else { 0.0 };
    let (ox, oy) = mask_doc_origin(engine, layer_id);
    let (ox, oy) = (ox as f64, oy as f64);
    draw_pencil_blocks_gpu(engine, tex_handle, x0 - ox, y0 - oy, x1 - ox, y1 - oy, size, value);
    engine.mark_layer_dirty(layer_id);
}

pub fn fill_mask(
    engine: &mut EngineInner,
    layer_id: &str,
    doc_x: i32,
    doc_y: i32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let (ox, oy) = mask_doc_origin(engine, layer_id);
    let local_x = doc_x - ox.round() as i32;
    let local_y = doc_y - oy.round() as i32;
    if local_x < 0 || local_y < 0 || local_x >= w as i32 || local_y >= h as i32 { return; }
    let (start_x, start_y) = (local_x as u32, local_y as u32);

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

    let mut mask = vec![0u8; (w * h) as usize];
    for i in 0..(w * h) as usize {
        mask[i] = rgba[i * 4];
    }

    if start_x >= w || start_y >= h { return; }
    let seed_idx = start_y as usize * w as usize + start_x as usize;
    let seed_val = mask[seed_idx];
    let fill_val: u8 = if mode == 0 { 255 } else { 0 };
    let tol = tolerance as i32;

    if contiguous {
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
                stack.push((px + 1, py));
                stack.push((px - 1, py));
                stack.push((px, py + 1));
                stack.push((px, py - 1));
            }
        }
    } else {
        for i in 0..mask.len() {
            if (mask[i] as i32 - seed_val as i32).abs() <= tol {
                mask[i] = fill_val;
            }
        }
    }

    let mut rgba_out = vec![0u8; (w * h * 4) as usize];
    for i in 0..(w * h) as usize {
        let v = mask[i];
        rgba_out[i * 4] = v;
        rgba_out[i * 4 + 1] = v;
        rgba_out[i * 4 + 2] = v;
        rgba_out[i * 4 + 3] = 255;
    }
    let _ = engine.texture_pool.upload_rgba(&engine.gl, tex_handle, 0, 0, w, h, &rgba_out);
    engine.mark_layer_dirty(layer_id);
}

pub fn render_mask_linear_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    let stops: Vec<crate::gradient_gpu::GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let mask_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let (layer_x, layer_y) = mask_doc_origin(engine, layer_id);
    // Copies the mask into scratch at the mask's size and samples it back
    // by v_uv, so scratch must match the mask exactly.
    if engine.ensure_scratch_size(w, h).is_err() { return; }

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
            gl.uniform2f(Some(&loc), layer_x, layer_y);
        }

        crate::gradient_gpu::set_gradient_uniforms(gl, shader, &stops, w, h);
        if let Some(loc) = shader.location(gl, "u_start") {
            gl.uniform2f(Some(&loc), start_x as f32 - layer_x, start_y as f32 - layer_y);
        }
        if let Some(loc) = shader.location(gl, "u_end") {
            gl.uniform2f(Some(&loc), end_x as f32 - layer_x, end_y as f32 - layer_y);
        }

        engine.draw_fullscreen_quad();
    });

    engine.mark_layer_dirty(layer_id);
}

pub fn render_mask_radial_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
    center_x: f64,
    center_y: f64,
    radius: f64,
    stops_json: &str,
) {
    let stops: Vec<crate::gradient_gpu::GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let mask_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let (layer_x, layer_y) = mask_doc_origin(engine, layer_id);
    // Copies the mask into scratch at the mask's size and samples it back
    // by v_uv, so scratch must match the mask exactly.
    if engine.ensure_scratch_size(w, h).is_err() { return; }

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
            gl.uniform2f(Some(&loc), layer_x, layer_y);
        }

        crate::gradient_gpu::set_gradient_uniforms(gl, shader, &stops, w, h);
        if let Some(loc) = shader.location(gl, "u_center") {
            gl.uniform2f(Some(&loc), center_x as f32 - layer_x, center_y as f32 - layer_y);
        }
        if let Some(loc) = shader.location(gl, "u_radius") {
            gl.uniform1f(Some(&loc), radius as f32);
        }

        engine.draw_fullscreen_quad();
    });

    engine.mark_layer_dirty(layer_id);
}

pub fn read_mask_texture(engine: &mut EngineInner, layer_id: &str) -> Option<Vec<u8>> {
    let &handle = engine.layer_masks.get(layer_id)?;
    let (w, h) = engine.texture_pool.get_size(handle)?;
    let tex = engine.texture_pool.get(handle)?.clone();

    // R8 staging: 1 byte per pixel back over the bridge instead of 4,
    // and no CPU-side strided extract. See #745 — the RGBA path stalled
    // ~26 s per stroke on a 4K mask (60× worse than linear per pixel,
    // driven by the 16 M-iteration cache-hostile CPU loop).
    engine.read_texture_r8(&tex, w, h)
}
