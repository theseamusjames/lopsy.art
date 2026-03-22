use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

pub fn begin_stroke(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    // If the layer has a lazy 1x1 texture, expand it to document size
    // so the stroke texture covers the full painting area.
    if let Some(&layer_tex) = engine.layer_textures.get(layer_id) {
        let (lw, lh) = engine.texture_pool.get_size(layer_tex).unwrap_or((1, 1));
        if lw <= 1 && lh <= 1 {
            let new_tex = engine.texture_pool.acquire(&engine.gl, engine.doc_width, engine.doc_height)?;
            let old = engine.layer_textures.insert(layer_id.to_string(), new_tex);
            if let Some(old_tex) = old {
                engine.texture_pool.release(old_tex);
            }
            engine.mark_layer_dirty(layer_id);
        }
    }

    // Create a stroke texture matching the layer size
    if let Some(&layer_tex) = engine.layer_textures.get(layer_id) {
        let (w, h) = engine.texture_pool.get_size(layer_tex).unwrap_or((1, 1));
        let stroke_tex = engine.texture_pool.acquire(&engine.gl, w, h)?;
        engine.stroke_textures.insert(layer_id.to_string(), stroke_tex);

        if engine.stroke_fbo.is_none() {
            let fbo = engine.fbo_pool.create(&engine.gl)?;
            engine.stroke_fbo = Some(fbo);
        }

        // Attach stroke texture to FBO
        if let (Some(fbo), Some(tex)) = (engine.stroke_fbo, engine.texture_pool.get(stroke_tex)) {
            engine.fbo_pool.attach_texture(&engine.gl, fbo, tex);
        }
    }
    Ok(())
}

pub fn apply_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64, cy: f64,
    size: f32, hardness: f32,
    r: f32, g: f32, b: f32, a: f32,
    opacity: f32, flow: f32,
) {
    apply_dab_batch(engine, layer_id, &[cx, cy], size, hardness, r, g, b, a, opacity, flow);
}

pub fn apply_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32, hardness: f32,
    r: f32, g: f32, b: f32, a: f32,
    opacity: f32, flow: f32,
) {
    let gl = &engine.gl;

    // Get stroke texture (or layer texture if no active stroke)
    let stroke_tex = engine.stroke_textures.get(layer_id).copied();
    let target_tex = stroke_tex.or_else(|| engine.layer_textures.get(layer_id).copied());
    let tex_handle = match target_tex {
        Some(h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    // Bind FBO targeting the stroke/layer texture
    if let Some(fbo) = engine.stroke_fbo {
        if let Some(tex) = engine.texture_pool.get(tex_handle) {
            engine.fbo_pool.attach_texture(gl, fbo, tex);
            engine.fbo_pool.bind(gl, fbo);
        }
    } else {
        let fbo = gl.create_framebuffer();
        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, fbo.as_ref());
        if let Some(tex) = engine.texture_pool.get(tex_handle) {
            gl.framebuffer_texture_2d(
                WebGl2RenderingContext::FRAMEBUFFER,
                WebGl2RenderingContext::COLOR_ATTACHMENT0,
                WebGl2RenderingContext::TEXTURE_2D,
                Some(tex),
                0,
            );
        }
    }
    gl.viewport(0, 0, w as i32, h as i32);

    // Enable blending for accumulative dabs
    gl.enable(WebGl2RenderingContext::BLEND);
    gl.blend_func(
        WebGl2RenderingContext::ONE,
        WebGl2RenderingContext::ONE_MINUS_SRC_ALPHA,
    );

    let prog = &engine.shaders.brush_dab.program;
    gl.use_program(Some(prog));

    // Set uniforms (no stamp texture needed — computed analytically in shader)
    if let Some(loc) = gl.get_uniform_location(prog, "u_brushColor") {
        gl.uniform4f(Some(&loc), r, g, b, a);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_opacity") {
        gl.uniform1f(Some(&loc), opacity);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_flow") {
        gl.uniform1f(Some(&loc), flow);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_hardness") {
        gl.uniform1f(Some(&loc), hardness);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_texSize") {
        gl.uniform2f(Some(&loc), w as f32, h as f32);
    }
    if let Some(loc) = gl.get_uniform_location(prog, "u_size") {
        gl.uniform1f(Some(&loc), size);
    }

    // Render each dab as a separate draw call
    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
            gl.uniform2f(Some(&loc), chunk[0] as f32, chunk[1] as f32);
        }
        engine.draw_fullscreen_quad();
    }

    gl.disable(WebGl2RenderingContext::BLEND);
    gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);

    engine.mark_layer_dirty(layer_id);
}

pub fn apply_eraser_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64, cy: f64,
    size: f32, hardness: f32, opacity: f32,
) {
    apply_eraser_dab_batch(engine, layer_id, &[cx, cy], size, hardness, opacity);
}

pub fn apply_eraser_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32, hardness: f32, opacity: f32,
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

    // Generate stamp
    let stamp_size = size.ceil() as u32;
    if stamp_size == 0 { return; }
    let stamp = lopsy_core::brush::generate_brush_stamp(stamp_size, hardness);
    let mut stamp_rgba = vec![0u8; (stamp_size * stamp_size * 4) as usize];
    for i in 0..(stamp_size * stamp_size) as usize {
        let v = if i < stamp.len() { (stamp[i] * 255.0) as u8 } else { 0 };
        stamp_rgba[i * 4] = v;
        stamp_rgba[i * 4 + 1] = 0;
        stamp_rgba[i * 4 + 2] = 0;
        stamp_rgba[i * 4 + 3] = 255;
    }

    let stamp_tex = match engine.texture_pool.acquire(gl, stamp_size, stamp_size) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.texture_pool.upload_rgba(
        gl, stamp_tex, 0, 0, stamp_size, stamp_size, &stamp_rgba,
    );

    // For each dab: render eraser pass (layer -> scratch with erased alpha -> copy back)
    let prog = &engine.shaders.eraser_dab.program;

    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }

        // Render to scratch
        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        gl.use_program(Some(prog));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(tex) = engine.texture_pool.get(stamp_tex) {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_stampTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = gl.get_uniform_location(prog, "u_layerTex") {
            gl.uniform1i(Some(&loc), 1);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_opacity") {
            gl.uniform1f(Some(&loc), opacity);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
            gl.uniform2f(Some(&loc), chunk[0] as f32, chunk[1] as f32);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }

        engine.draw_fullscreen_quad();

        // Copy scratch A -> layer
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

pub fn end_stroke(engine: &mut EngineInner, layer_id: &str) {
    let gl = &engine.gl;

    if let Some(stroke_tex) = engine.stroke_textures.remove(layer_id) {
        // Composite stroke texture onto layer texture using normal compositing
        if let Some(&layer_tex_handle) = engine.layer_textures.get(layer_id) {
            if let (Some(stroke_gl_tex), Some(layer_gl_tex)) = (
                engine.texture_pool.get(stroke_tex),
                engine.texture_pool.get(layer_tex_handle),
            ) {
                let stroke_gl_tex = stroke_gl_tex.clone();
                let layer_gl_tex = layer_gl_tex.clone();
                let (w, h) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));

                // Use composite shader (source-over) to blend stroke onto layer
                engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
                gl.viewport(0, 0, w as i32, h as i32);

                gl.use_program(Some(&engine.shaders.composite.program));
                gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&stroke_gl_tex));
                if let Some(loc) = gl.get_uniform_location(&engine.shaders.composite.program, "u_srcTex") {
                    gl.uniform1i(Some(&loc), 0);
                }
                gl.active_texture(WebGl2RenderingContext::TEXTURE1);
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_gl_tex));
                if let Some(loc) = gl.get_uniform_location(&engine.shaders.composite.program, "u_dstTex") {
                    gl.uniform1i(Some(&loc), 1);
                }
                if let Some(loc) = gl.get_uniform_location(&engine.shaders.composite.program, "u_opacity") {
                    gl.uniform1f(Some(&loc), 1.0);
                }
                engine.draw_fullscreen_quad();

                // Copy scratch A -> layer texture
                let temp_fbo = gl.create_framebuffer();
                gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, temp_fbo.as_ref());
                gl.framebuffer_texture_2d(
                    WebGl2RenderingContext::FRAMEBUFFER,
                    WebGl2RenderingContext::COLOR_ATTACHMENT0,
                    WebGl2RenderingContext::TEXTURE_2D,
                    Some(&layer_gl_tex),
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
        }

        engine.texture_pool.release(stroke_tex);
    }

    engine.mark_layer_dirty(layer_id);
}
