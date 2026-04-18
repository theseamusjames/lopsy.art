use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;
use crate::gpu::shader::ShaderProgram;

#[derive(serde::Deserialize)]
struct GradientStop {
    position: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
}

pub fn render_linear_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
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

    let _ = engine.ensure_layer_full_size(layer_id);

    let gl = &engine.gl;
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id);
    let layer_x = layer_desc.map(|l| l.x as f32).unwrap_or(0.0);
    let layer_y = layer_desc.map(|l| l.y as f32).unwrap_or(0.0);

    // Copy existing layer content to scratch_a for reading
    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    let scratch_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();
    let mask_tex_opt = engine.selection_mask_texture
        .and_then(|h| engine.texture_pool.get(h).cloned());
    let has_mask = mask_tex_opt.is_some();

    engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.gradient_linear;
        gl.use_program(Some(&shader.program));

        // Bind existing content (from scratch_a)
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(s) = &scratch_tex {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(s));
        }
        if let Some(loc) = shader.location(gl, "u_existingTex") {
            gl.uniform1i(Some(&loc), 0);
        }

        // Bind selection mask
        if let Some(m) = &mask_tex_opt {
            gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(m));
        }
        if let Some(loc) = shader.location(gl, "u_maskTex") {
            gl.uniform1i(Some(&loc), 1);
        }
        if let Some(loc) = shader.location(gl, "u_hasMask") {
            gl.uniform1i(Some(&loc), if has_mask { 1 } else { 0 });
        }
        if let Some(loc) = shader.location(gl, "u_docSize") {
            gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
        }
        if let Some(loc) = shader.location(gl, "u_layerOffset") {
            gl.uniform2f(Some(&loc), layer_x, layer_y);
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

    engine.mark_layer_dirty(layer_id);
}

pub fn render_radial_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
    center_x: f64,
    center_y: f64,
    radius: f64,
    stops_json: &str,
) {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let _ = engine.ensure_layer_full_size(layer_id);

    let gl = &engine.gl;
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let layer_tex = match engine.texture_pool.get(tex_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let layer_desc = engine.layer_stack.iter().find(|l| l.id == layer_id);
    let layer_x = layer_desc.map(|l| l.x as f32).unwrap_or(0.0);
    let layer_y = layer_desc.map(|l| l.y as f32).unwrap_or(0.0);

    // Copy existing layer content to scratch_a
    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.use_program(Some(&engine.shaders.blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
        gl.uniform1i(Some(&loc), 0);
    }
    engine.draw_fullscreen_quad();

    let scratch_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();
    let mask_tex_opt = engine.selection_mask_texture
        .and_then(|h| engine.texture_pool.get(h).cloned());
    let has_mask = mask_tex_opt.is_some();

    engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
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

        if let Some(m) = &mask_tex_opt {
            gl.active_texture(WebGl2RenderingContext::TEXTURE1);
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(m));
        }
        if let Some(loc) = shader.location(gl, "u_maskTex") {
            gl.uniform1i(Some(&loc), 1);
        }
        if let Some(loc) = shader.location(gl, "u_hasMask") {
            gl.uniform1i(Some(&loc), if has_mask { 1 } else { 0 });
        }
        if let Some(loc) = shader.location(gl, "u_docSize") {
            gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
        }
        if let Some(loc) = shader.location(gl, "u_layerOffset") {
            gl.uniform2f(Some(&loc), layer_x, layer_y);
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

    engine.mark_layer_dirty(layer_id);
}

fn set_gradient_uniforms(
    gl: &WebGl2RenderingContext,
    shader: &ShaderProgram,
    stops: &[GradientStop],
    w: u32,
    h: u32,
) {
    let count = stops.len().min(16) as i32;
    if let Some(loc) = shader.location(gl, "u_stopCount") {
        gl.uniform1i(Some(&loc), count);
    }
    if let Some(loc) = shader.location(gl, "u_texSize") {
        gl.uniform2f(Some(&loc), w as f32, h as f32);
    }

    // Set stop colors and positions
    for (i, stop) in stops.iter().enumerate().take(16) {
        let name = format!("u_stops[{i}]");
        if let Some(loc) = shader.location(gl, &name) {
            gl.uniform4f(Some(&loc), stop.r, stop.g, stop.b, stop.a);
        }
        let name = format!("u_stopPositions[{i}]");
        if let Some(loc) = shader.location(gl, &name) {
            gl.uniform1f(Some(&loc), stop.position);
        }
    }
}

/// CPU-side gradient interpolation
pub fn interpolate_gradient(stops_json: &str, t: f64) -> Vec<u8> {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return vec![0, 0, 0, 255],
    };
    if stops.is_empty() {
        return vec![0, 0, 0, 255];
    }
    let t = t.clamp(0.0, 1.0) as f32;

    // Find surrounding stops
    if t <= stops[0].position {
        let s = &stops[0];
        return vec![
            (s.r * 255.0) as u8,
            (s.g * 255.0) as u8,
            (s.b * 255.0) as u8,
            (s.a * 255.0) as u8,
        ];
    }
    for i in 1..stops.len() {
        if t <= stops[i].position {
            let a = &stops[i - 1];
            let b = &stops[i];
            let seg = if (b.position - a.position).abs() < 0.001 {
                0.0
            } else {
                (t - a.position) / (b.position - a.position)
            };
            let lerp = |x: f32, y: f32| x + (y - x) * seg;
            return vec![
                (lerp(a.r, b.r) * 255.0) as u8,
                (lerp(a.g, b.g) * 255.0) as u8,
                (lerp(a.b, b.b) * 255.0) as u8,
                (lerp(a.a, b.a) * 255.0) as u8,
            ];
        }
    }
    let s = stops.last().unwrap();
    vec![
        (s.r * 255.0) as u8,
        (s.g * 255.0) as u8,
        (s.b * 255.0) as u8,
        (s.a * 255.0) as u8,
    ]
}
