use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

pub fn apply_dodge_burn_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    size: f32,
    mode: u32,
    exposure: f32,
) {
    apply_dodge_burn_dab_batch(engine, layer_id, &[cx, cy], size, mode, exposure);
}

pub fn apply_dodge_burn_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    mode: u32,
    exposure: f32,
) {
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

    let prog = &engine.shaders.dodge_burn.program;
    gl.use_program(Some(prog));

    // Generate a simple soft stamp texture for the dab
    let stamp_size = size.ceil() as u32;
    let stamp = lopsy_core::brush::generate_brush_stamp(stamp_size, 0.5);
    let stamp_rgba: Vec<u8> = stamp.iter().map(|&v| (v * 255.0) as u8).collect();
    // Upload stamp as R8 via RGBA (stamp value in R)
    let mut stamp_tex_data = vec![0u8; (stamp_size * stamp_size * 4) as usize];
    for i in 0..(stamp_size * stamp_size) as usize {
        let v = if i < stamp_rgba.len() { stamp_rgba[i] } else { 0 };
        stamp_tex_data[i * 4] = v;
        stamp_tex_data[i * 4 + 1] = 0;
        stamp_tex_data[i * 4 + 2] = 0;
        stamp_tex_data[i * 4 + 3] = 255;
    }

    let stamp_tex = match engine.texture_pool.acquire(gl, stamp_size, stamp_size) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.texture_pool.upload_rgba(
        gl, stamp_tex, 0, 0, stamp_size, stamp_size, &stamp_tex_data,
    );

    // For each dab point, apply dodge/burn
    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        let _cx = chunk[0];
        let _cy = chunk[1];

        // Use the filter pattern: render layer with dodge/burn into scratch, copy back
        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        gl.use_program(Some(prog));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = gl.get_uniform_location(prog, "u_layerTex") {
            gl.uniform1i(Some(&loc), 0);
        }

        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(tex) = engine.texture_pool.get(stamp_tex) {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_stampTex") {
            gl.uniform1i(Some(&loc), 1);
        }

        if let Some(loc) = gl.get_uniform_location(prog, "u_mode") {
            gl.uniform1i(Some(&loc), mode as i32);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_exposure") {
            gl.uniform1f(Some(&loc), exposure);
        }

        engine.draw_fullscreen_quad();

        // Copy scratch A back to layer
        let temp_fbo = gl.create_framebuffer();
        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
        gl.framebuffer_texture_2d(
            WebGl2RenderingContext::FRAMEBUFFER,
            WebGl2RenderingContext::COLOR_ATTACHMENT0,
            WebGl2RenderingContext::TEXTURE_2D,
            Some(&layer_tex),
            0,
        );
        gl.use_program(Some(&engine.shaders.blit.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a) {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
        }
        if let Some(loc) = gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
            gl.uniform1i(Some(&loc), 0);
        }
        engine.draw_fullscreen_quad();

        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
        gl.delete_framebuffer(temp_fbo.as_ref());
    }

    engine.texture_pool.release(stamp_tex);
    engine.mark_layer_dirty(layer_id);
}
