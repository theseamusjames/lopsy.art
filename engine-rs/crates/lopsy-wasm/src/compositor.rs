use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

/// Main compositing pipeline — called every frame
pub fn composite(engine: &mut EngineInner) {
    let gl = &engine.gl;
    let vp = &engine.viewport;

    // 1. Bind composite FBO and clear with background color
    engine.fbo_pool.bind(gl, engine.composite_fbo);
    gl.viewport(0, 0, engine.doc_width as i32, engine.doc_height as i32);
    gl.clear_color(
        engine.bg_color[0],
        engine.bg_color[1],
        engine.bg_color[2],
        engine.bg_color[3],
    );
    gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // 2. For each visible layer (bottom to top), blend onto composite
    for i in 0..engine.layer_stack.len() {
        let layer = &engine.layer_stack[i];
        if !layer.visible || layer.opacity < 1e-7 {
            continue;
        }

        let layer_id = layer.id.clone();
        let opacity = layer.opacity;
        let blend_mode = layer.blend_mode as i32;

        if let Some(&tex_handle) = engine.layer_textures.get(&layer_id) {
            if let Some(layer_tex) = engine.texture_pool.get(tex_handle) {
                // Use blend shader to composite this layer
                gl.use_program(Some(&engine.shaders.blend.program));

                // Bind source (layer) to texture unit 0
                gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(layer_tex));

                // Bind destination (current composite) to texture unit 1
                gl.active_texture(WebGl2RenderingContext::TEXTURE1);
                if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
                }

                // Set uniforms
                let prog = &engine.shaders.blend.program;
                if let Some(loc) = gl.get_uniform_location(prog, "u_srcTex") {
                    gl.uniform1i(Some(&loc), 0);
                }
                if let Some(loc) = gl.get_uniform_location(prog, "u_dstTex") {
                    gl.uniform1i(Some(&loc), 1);
                }
                if let Some(loc) = gl.get_uniform_location(prog, "u_opacity") {
                    gl.uniform1f(Some(&loc), opacity);
                }
                if let Some(loc) = gl.get_uniform_location(prog, "u_blendMode") {
                    gl.uniform1i(Some(&loc), blend_mode);
                }

                // Render to scratch A
                engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
                engine.draw_fullscreen_quad();

                // Copy scratch A back to composite
                // (swap composite and scratch textures for the blit)
                engine.fbo_pool.bind(gl, engine.composite_fbo);
                gl.use_program(Some(&engine.shaders.blit.program));
                gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a) {
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex));
                }
                if let Some(loc) = gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
                    gl.uniform1i(Some(&loc), 0);
                }
                engine.draw_fullscreen_quad();
            }
        }
    }

    // 3. Final blit to screen canvas
    engine.fbo_pool.unbind(gl);
    let canvas = gl.canvas().unwrap();
    let canvas_el: web_sys::HtmlCanvasElement = canvas.dyn_into().unwrap();
    let screen_w = canvas_el.width() as i32;
    let screen_h = canvas_el.height() as i32;
    gl.viewport(0, 0, screen_w, screen_h);

    gl.use_program(Some(&engine.shaders.final_blit.program));
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
    }

    let prog = &engine.shaders.final_blit.program;
    if let Some(loc) = gl.get_uniform_location(prog, "u_compositeTex") {
        gl.uniform1i(Some(&loc), 0);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_resolution") {
        gl.uniform2f(Some(&loc), screen_w as f32, screen_h as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_zoom") {
        gl.uniform1f(Some(&loc), vp.zoom as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_pan") {
        gl.uniform2f(Some(&loc), vp.pan_x as f32, vp.pan_y as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_docSize") {
        gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
    }

    engine.draw_fullscreen_quad();

    engine.dirty_layers.clear();
    engine.needs_recomposite = false;
}

/// Composite for export — render to FBO, readPixels
pub fn composite_for_export(engine: &mut EngineInner) -> Result<Vec<u8>, String> {
    let gl = &engine.gl;

    // Render composite (same as display but without viewport transform)
    engine.fbo_pool.bind(gl, engine.composite_fbo);
    gl.viewport(0, 0, engine.doc_width as i32, engine.doc_height as i32);
    gl.clear_color(
        engine.bg_color[0],
        engine.bg_color[1],
        engine.bg_color[2],
        engine.bg_color[3],
    );
    gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // Composite all layers
    for i in 0..engine.layer_stack.len() {
        let layer = &engine.layer_stack[i];
        if !layer.visible || layer.opacity < 1e-7 {
            continue;
        }

        let layer_id = layer.id.clone();
        let opacity = layer.opacity;
        let blend_mode = layer.blend_mode as i32;

        if let Some(&tex_handle) = engine.layer_textures.get(&layer_id) {
            if let Some(layer_tex) = engine.texture_pool.get(tex_handle) {
                gl.use_program(Some(&engine.shaders.blend.program));
                gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(layer_tex));
                gl.active_texture(WebGl2RenderingContext::TEXTURE1);
                if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
                }

                let prog = &engine.shaders.blend.program;
                if let Some(loc) = gl.get_uniform_location(prog, "u_srcTex") {
                    gl.uniform1i(Some(&loc), 0);
                }
                if let Some(loc) = gl.get_uniform_location(prog, "u_dstTex") {
                    gl.uniform1i(Some(&loc), 1);
                }
                if let Some(loc) = gl.get_uniform_location(prog, "u_opacity") {
                    gl.uniform1f(Some(&loc), opacity);
                }
                if let Some(loc) = gl.get_uniform_location(prog, "u_blendMode") {
                    gl.uniform1i(Some(&loc), blend_mode);
                }

                engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
                engine.draw_fullscreen_quad();

                engine.fbo_pool.bind(gl, engine.composite_fbo);
                gl.use_program(Some(&engine.shaders.blit.program));
                gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a) {
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex));
                }
                if let Some(loc) = gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") {
                    gl.uniform1i(Some(&loc), 0);
                }
                engine.draw_fullscreen_quad();
            }
        }
    }

    // Read pixels
    let w = engine.doc_width;
    let h = engine.doc_height;
    let mut pixels = vec![0u8; (w * h * 4) as usize];
    gl.read_pixels_with_opt_u8_array(
        0, 0, w as i32, h as i32,
        WebGl2RenderingContext::RGBA,
        WebGl2RenderingContext::UNSIGNED_BYTE,
        Some(&mut pixels),
    ).map_err(|e| format!("readPixels failed: {:?}", e))?;

    engine.fbo_pool.unbind(gl);

    Ok(pixels)
}

use wasm_bindgen::JsCast;
