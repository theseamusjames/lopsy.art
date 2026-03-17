use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

pub fn apply_clone_stamp_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    _dest_x: f64,
    _dest_y: f64,
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
) {
    apply_clone_stamp_dab_batch(
        engine,
        layer_id,
        &[_dest_x, _dest_y],
        source_offset_x,
        source_offset_y,
        size,
    );
}

pub fn apply_clone_stamp_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    _points: &[f64],
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

    // Generate stamp texture
    let stamp_size = size.ceil() as u32;
    let stamp = lopsy_core::brush::generate_brush_stamp(stamp_size, 0.8);
    let mut stamp_tex_data = vec![0u8; (stamp_size * stamp_size * 4) as usize];
    for i in 0..(stamp_size * stamp_size) as usize {
        let v = if i < stamp.len() { (stamp[i] * 255.0) as u8 } else { 0 };
        stamp_tex_data[i * 4] = v;
        stamp_tex_data[i * 4 + 1] = 0;
        stamp_tex_data[i * 4 + 2] = 0;
        stamp_tex_data[i * 4 + 3] = 255;
    }

    let stamp_tex = match engine.texture_pool.acquire(gl, stamp_size, stamp_size) {
        Ok(h) => h,
        Err(_) => return,
    };
    if let Some(tex) = engine.texture_pool.get(stamp_tex) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
        let _ = gl.tex_sub_image_2d_with_i32_and_i32_and_u32_and_type_and_opt_u8_array(
            WebGl2RenderingContext::TEXTURE_2D,
            0, 0, 0,
            stamp_size as i32, stamp_size as i32,
            WebGl2RenderingContext::RGBA,
            WebGl2RenderingContext::UNSIGNED_BYTE,
            Some(&stamp_tex_data),
        );
    }

    let prog = &engine.shaders.clone_stamp.program;
    gl.use_program(Some(prog));

    // Render to scratch, then copy back
    engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
    gl.viewport(0, 0, w as i32, h as i32);

    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
    if let Some(loc) = gl.get_uniform_location(prog, "u_sourceTex") {
        gl.uniform1i(Some(&loc), 0);
    }

    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(tex) = engine.texture_pool.get(stamp_tex) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_stampTex") {
        gl.uniform1i(Some(&loc), 1);
    }

    if let Some(loc) = gl.get_uniform_location(prog, "u_sourceOffset") {
        gl.uniform2f(
            Some(&loc),
            source_offset_x as f32 / w as f32,
            source_offset_y as f32 / h as f32,
        );
    }

    gl.enable(WebGl2RenderingContext::BLEND);
    gl.blend_func(
        WebGl2RenderingContext::ONE,
        WebGl2RenderingContext::ONE_MINUS_SRC_ALPHA,
    );
    engine.draw_fullscreen_quad();
    gl.disable(WebGl2RenderingContext::BLEND);

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

    engine.texture_pool.release(stamp_tex);
    engine.mark_layer_dirty(layer_id);
}
