use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

pub fn apply_clone_stamp_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    dest_x: f64,
    dest_y: f64,
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
) {
    apply_clone_stamp_dab_batch(
        engine,
        layer_id,
        &[dest_x, dest_y],
        source_offset_x,
        source_offset_y,
        size,
    );
}

pub fn apply_clone_stamp_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
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

    let prog = &engine.shaders.clone_stamp.program;

    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }

        // Render to scratch A
        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        gl.use_program(Some(prog));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = gl.get_uniform_location(prog, "u_sourceTex") {
            gl.uniform1i(Some(&loc), 0);
        }

        // Pass dab center and size in pixel coordinates
        if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
            gl.uniform2f(Some(&loc), chunk[0] as f32, chunk[1] as f32);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }

        // Source offset in pixel coordinates
        if let Some(loc) = gl.get_uniform_location(prog, "u_sourceOffset") {
            gl.uniform2f(
                Some(&loc),
                source_offset_x as f32,
                source_offset_y as f32,
            );
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

    engine.mark_layer_dirty(layer_id);
}
