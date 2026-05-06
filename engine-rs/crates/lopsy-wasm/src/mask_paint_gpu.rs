use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

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
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let mask_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let gl = &engine.gl;

    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        let cx = chunk[0] as f32;
        let cy = chunk[1] as f32;

        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        let shader = &engine.shaders.quick_mask_dab;
        gl.use_program(Some(&shader.program));

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
    let points = lopsy_core::brush::interpolate_points(x0, y0, x1, y1, 1.0);
    let half = (size / 2.0).floor() as i32;
    let block_size = size.ceil() as i32;

    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (tex_w, tex_h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    for i in (0..points.len()).step_by(2) {
        let cx = points[i] as i32;
        let cy = points[i + 1] as i32;
        let bx = (cx - half).max(0);
        let by = (cy - half).max(0);
        let bw = block_size.min(tex_w as i32 - bx);
        let bh = block_size.min(tex_h as i32 - by);
        if bw <= 0 || bh <= 0 { continue; }

        let count = (bw * bh) as usize;

        if mode == 0 {
            let mut rgba = vec![0u8; count * 4];
            for j in 0..count {
                let v = (a * 255.0) as u8;
                rgba[j * 4] = v;
                rgba[j * 4 + 1] = v;
                rgba[j * 4 + 2] = v;
                rgba[j * 4 + 3] = 255;
            }
            let _ = engine.texture_pool.upload_rgba(
                &engine.gl, tex_handle, bx, by, bw as u32, bh as u32, &rgba,
            );
        } else {
            let mut rgba = vec![0u8; count * 4];
            for j in 0..count {
                rgba[j * 4 + 3] = 255;
            }
            let _ = engine.texture_pool.upload_rgba(
                &engine.gl, tex_handle, bx, by, bw as u32, bh as u32, &rgba,
            );
        }
    }

    engine.needs_recomposite = true;
}

pub fn fill_mask(
    engine: &mut EngineInner,
    layer_id: &str,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

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
    engine.needs_recomposite = true;
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

    let gl = &engine.gl;

    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id);
    let layer_x = layer_desc.map(|l| l.x as f32).unwrap_or(0.0);
    let layer_y = layer_desc.map(|l| l.y as f32).unwrap_or(0.0);

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
            gl.uniform2f(Some(&loc), start_x as f32, start_y as f32);
        }
        if let Some(loc) = shader.location(gl, "u_end") {
            gl.uniform2f(Some(&loc), end_x as f32, end_y as f32);
        }

        engine.draw_fullscreen_quad();
    });

    engine.needs_recomposite = true;
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

    let gl = &engine.gl;

    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id);
    let layer_x = layer_desc.map(|l| l.x as f32).unwrap_or(0.0);
    let layer_y = layer_desc.map(|l| l.y as f32).unwrap_or(0.0);

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
            gl.uniform2f(Some(&loc), center_x as f32, center_y as f32);
        }
        if let Some(loc) = shader.location(gl, "u_radius") {
            gl.uniform1f(Some(&loc), radius as f32);
        }

        engine.draw_fullscreen_quad();
    });

    engine.needs_recomposite = true;
}

pub fn read_mask_texture(engine: &mut EngineInner, layer_id: &str) -> Option<Vec<u8>> {
    let &handle = engine.layer_masks.get(layer_id)?;
    let (w, h) = engine.texture_pool.get_size(handle)?;

    let fbo = engine.gl.create_framebuffer()?;
    let tex = engine.texture_pool.get(handle)?.clone();

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

    rgba.map(|data| {
        let mut single = vec![0u8; (w * h) as usize];
        for i in 0..(w * h) as usize {
            single[i] = data[i * 4];
        }
        single
    })
}
