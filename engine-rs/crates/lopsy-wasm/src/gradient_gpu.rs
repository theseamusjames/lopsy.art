use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

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

    let prog = &engine.shaders.gradient_linear.program;
    gl.use_program(Some(prog));

    // Render to temp FBO attached to layer texture
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

    set_gradient_uniforms(gl, prog, &stops, w, h);
    if let Some(loc) = gl.get_uniform_location(prog, "u_start") {
        gl.uniform2f(Some(&loc), start_x as f32, start_y as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_end") {
        gl.uniform2f(Some(&loc), end_x as f32, end_y as f32);
    }

    engine.draw_fullscreen_quad();

    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());
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

    let prog = &engine.shaders.gradient_radial.program;
    gl.use_program(Some(prog));

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

    set_gradient_uniforms(gl, prog, &stops, w, h);
    if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
        gl.uniform2f(Some(&loc), center_x as f32, center_y as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_radius") {
        gl.uniform1f(Some(&loc), radius as f32);
    }

    engine.draw_fullscreen_quad();

    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    gl.delete_framebuffer(temp_fbo.as_ref());
    engine.mark_layer_dirty(layer_id);
}

fn set_gradient_uniforms(
    gl: &WebGl2RenderingContext,
    prog: &web_sys::WebGlProgram,
    stops: &[GradientStop],
    w: u32,
    h: u32,
) {
    let count = stops.len().min(16) as i32;
    if let Some(loc) = gl.get_uniform_location(prog, "u_stopCount") {
        gl.uniform1i(Some(&loc), count);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_texSize") {
        gl.uniform2f(Some(&loc), w as f32, h as f32);
    }

    // Set stop colors and positions
    for (i, stop) in stops.iter().enumerate().take(16) {
        let name = format!("u_stops[{i}]");
        if let Some(loc) = gl.get_uniform_location(prog, &name) {
            gl.uniform4f(Some(&loc), stop.r, stop.g, stop.b, stop.a);
        }
        let name = format!("u_stopPositions[{i}]");
        if let Some(loc) = gl.get_uniform_location(prog, &name) {
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
