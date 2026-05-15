use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;
use crate::gpu::shader::ShaderProgram;

pub fn set_brush_texture_uniforms(
    engine: &EngineInner,
    shader: &ShaderProgram,
    layer_id: &str,
    texture_unit: u32,
) {
    let gl = &engine.gl;
    let use_tex = engine.brush_has_texture && engine.brush_texture.is_some();
    if use_tex {
        gl.active_texture(WebGl2RenderingContext::TEXTURE0 + texture_unit);
        if let Some(tex_handle) = engine.brush_texture {
            if let Some(tex_gl) = engine.texture_pool.get(tex_handle) {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex_gl));
            }
        }
        if let Some(loc) = shader.location(gl, "u_brushTexture") {
            gl.uniform1i(Some(&loc), texture_unit as i32);
        }
    }
    if let Some(loc) = shader.location(gl, "u_hasBrushTexture") {
        gl.uniform1i(Some(&loc), if use_tex { 1 } else { 0 });
    }
    if let Some(loc) = shader.location(gl, "u_textureScale") {
        gl.uniform1f(Some(&loc), engine.brush_texture_scale);
    }
    if let Some(loc) = shader.location(gl, "u_textureBlendMode") {
        gl.uniform1i(Some(&loc), engine.brush_texture_blend_mode as i32);
    }
    if let Some(loc) = shader.location(gl, "u_brushTextureSize") {
        gl.uniform2f(Some(&loc), engine.brush_texture_width as f32, engine.brush_texture_height as f32);
    }
    let (layer_ox, layer_oy) = engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));
    if let Some(loc) = shader.location(gl, "u_layerOffset") {
        gl.uniform2f(Some(&loc), layer_ox, layer_oy);
    }
}

pub fn begin_stroke(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    engine.ensure_layer_full_size(layer_id)?;

    // Track whether this stroke should apply the brush texture during compositing.
    // Only brush strokes use texture; pencil/eraser override this to false.
    engine.stroke_use_brush_texture.insert(
        layer_id.to_string(),
        engine.brush_has_texture,
    );

    // Generate random texture rotation for this stroke.
    // Use a simple hash of the layer_id bytes as seed since we don't have rand.
    let seed: u32 = layer_id.bytes().enumerate().fold(0x9E3779B9u32, |acc, (i, b)| {
        acc.wrapping_add((b as u32).wrapping_mul(i as u32 + 1))
            .wrapping_mul(0x85EBCA6Bu32)
    });
    let seed = seed ^ (js_sys::Date::now() as u32);
    engine.stroke_texture_rotation = (seed as f32 / u32::MAX as f32) * std::f32::consts::TAU;
    engine.stroke_texture_origin_set = false;

    // Create a stroke texture matching the layer size
    if let Some(&layer_tex) = engine.layer_textures.get(layer_id) {
        let (w, h) = engine.texture_pool.get_size(layer_tex).unwrap_or((1, 1));
        let stroke_tex = engine.texture_pool.acquire(&engine.gl, w, h)?;
        engine.stroke_textures.insert(layer_id.to_string(), stroke_tex);

        if engine.stroke_fbo.is_none() {
            let fbo = engine.fbo_pool.create(&engine.gl)?;
            engine.stroke_fbo = Some(fbo);
        }

        if let (Some(fbo), Some(tex)) = (engine.stroke_fbo, engine.texture_pool.get(stroke_tex)) {
            engine.fbo_pool.attach_texture(&engine.gl, fbo, tex);
            engine.fbo_pool.unbind(&engine.gl);
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
    size_jitter: f32, angle_jitter: f32, opacity_jitter: f32,
) {
    apply_dab_batch(engine, layer_id, &[cx, cy], size, hardness, r, g, b, a, opacity, flow, size_jitter, angle_jitter, opacity_jitter);
}

pub fn apply_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32, hardness: f32,
    r: f32, g: f32, b: f32, a: f32,
    opacity: f32, flow: f32,
    size_jitter: f32, angle_jitter: f32, opacity_jitter: f32,
) {
    // Track brush opacity for this stroke so end_stroke and the compositor can use it
    engine.stroke_opacity.insert(layer_id.to_string(), opacity);

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

    // Break any accidental feedback loop: the stroke texture may still be
    // bound to a texture unit from acquire() or attach_texture(). If it's
    // simultaneously attached as the FBO color target AND bound to a
    // sampler unit, the WebGL implementation can silently discard the draw.
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    gl.active_texture(WebGl2RenderingContext::TEXTURE2);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    // Dab accumulation blending.
    // Alpha/circle brushes: MAX blending — each pixel takes the highest
    // alpha from any overlapping dab, preventing opacity compounding.
    // Color brushes: premultiplied alpha "over" compositing — overlapping
    // rotated dabs layer correctly instead of per-channel MAX which would
    // create phantom colors (e.g. blue + orange → pink).
    gl.enable(WebGl2RenderingContext::BLEND);
    let is_color_tip = engine.brush_has_tip && engine.brush_tip_is_color;
    if is_color_tip {
        gl.blend_equation(WebGl2RenderingContext::FUNC_ADD);
        gl.blend_func(WebGl2RenderingContext::ONE, WebGl2RenderingContext::ONE_MINUS_SRC_ALPHA);
    } else {
        gl.blend_equation(WebGl2RenderingContext::MAX);
    }

    let shader = if is_color_tip {
        &engine.shaders.brush_dab_color
    } else if engine.brush_has_tip {
        &engine.shaders.brush_dab_alpha
    } else {
        &engine.shaders.brush_dab_circle
    };
    gl.use_program(Some(&shader.program));

    // Set uniforms (no stamp texture needed — computed analytically in shader)
    if let Some(loc) = shader.location(gl, "u_brushColor") {
        gl.uniform4f(Some(&loc), r, g, b, a);
    }
    if let Some(loc) = shader.location(gl, "u_opacity") {
        gl.uniform1f(Some(&loc), opacity);
    }
    if let Some(loc) = shader.location(gl, "u_flow") {
        gl.uniform1f(Some(&loc), flow);
    }
    if let Some(loc) = shader.location(gl, "u_hardness") {
        gl.uniform1f(Some(&loc), hardness);
    }
    if let Some(loc) = shader.location(gl, "u_texSize") {
        gl.uniform2f(Some(&loc), w as f32, h as f32);
    }
    if let Some(loc) = shader.location(gl, "u_size") {
        gl.uniform1f(Some(&loc), size);
    }

    // Bind selection mask if present
    let has_selection = engine.selection_mask_texture.is_some();
    if has_selection {
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(mask_handle) = engine.selection_mask_texture {
            if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
            }
        }
        if let Some(loc) = shader.location(gl, "u_selectionMask") {
            gl.uniform1i(Some(&loc), 0);
        }
    }
    if let Some(loc) = shader.location(gl, "u_hasSelection") {
        gl.uniform1i(Some(&loc), if has_selection { 1 } else { 0 });
    }
    if let Some(loc) = shader.location(gl, "u_docSize") {
        gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
    }
    // Get layer offset for selection mask coordinate mapping
    let (layer_ox, layer_oy) = engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));
    if let Some(loc) = shader.location(gl, "u_layerOffset") {
        gl.uniform2f(Some(&loc), layer_ox, layer_oy);
    }

    // Bind custom brush tip texture if present (for alpha and color variants)
    let use_brush_tip = engine.brush_has_tip && engine.brush_tip_texture.is_some();
    if use_brush_tip {
        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        if let Some(tip_handle) = engine.brush_tip_texture {
            if let Some(tip_tex) = engine.texture_pool.get(tip_handle) {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tip_tex));
            }
        }
        if let Some(loc) = shader.location(gl, "u_brushTip") {
            gl.uniform1i(Some(&loc), 1);
        }
    }
    if let Some(loc) = shader.location(gl, "u_angle") {
        gl.uniform1f(Some(&loc), if use_brush_tip { engine.brush_angle } else { 0.0 });
    }
    if let Some(loc) = shader.location(gl, "u_tipAspect") {
        if use_brush_tip && engine.brush_tip_width > 0 && engine.brush_tip_height > 0 {
            let max_dim = engine.brush_tip_width.max(engine.brush_tip_height) as f32;
            gl.uniform2f(
                Some(&loc),
                engine.brush_tip_width as f32 / max_dim,
                engine.brush_tip_height as f32 / max_dim,
            );
        } else {
            gl.uniform2f(Some(&loc), 1.0, 1.0);
        }
    }

    // Jitter uniforms
    if let Some(loc) = shader.location(gl, "u_sizeJitter") {
        gl.uniform1f(Some(&loc), size_jitter);
    }
    if let Some(loc) = shader.location(gl, "u_angleJitter") {
        gl.uniform1f(Some(&loc), angle_jitter);
    }
    if let Some(loc) = shader.location(gl, "u_opacityJitter") {
        gl.uniform1f(Some(&loc), opacity_jitter);
    }

    // Bind brush texture if present
    let use_brush_texture = engine.brush_has_texture && engine.brush_texture.is_some();
    if use_brush_texture {
        gl.active_texture(WebGl2RenderingContext::TEXTURE2);
        if let Some(tex_handle) = engine.brush_texture {
            if let Some(tex_gl) = engine.texture_pool.get(tex_handle) {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex_gl));
            }
        }
        if let Some(loc) = shader.location(gl, "u_brushTexture") {
            gl.uniform1i(Some(&loc), 2);
        }
    }
    if let Some(loc) = shader.location(gl, "u_hasBrushTexture") {
        gl.uniform1i(Some(&loc), if use_brush_texture { 1 } else { 0 });
    }
    if let Some(loc) = shader.location(gl, "u_textureScale") {
        gl.uniform1f(Some(&loc), engine.brush_texture_scale);
    }
    if let Some(loc) = shader.location(gl, "u_textureBlendMode") {
        gl.uniform1i(Some(&loc), engine.brush_texture_blend_mode as i32);
    }
    if let Some(loc) = shader.location(gl, "u_brushTextureSize") {
        gl.uniform2f(Some(&loc), engine.brush_texture_width as f32, engine.brush_texture_height as f32);
    }

    // Set stroke origin from first dab position if not yet set
    if !engine.stroke_texture_origin_set && points.len() >= 2 {
        engine.stroke_texture_origin = (points[0] as f32, points[1] as f32);
        engine.stroke_texture_origin_set = true;
    }
    if let Some(loc) = shader.location(gl, "u_strokeOrigin") {
        gl.uniform2f(Some(&loc), engine.stroke_texture_origin.0, engine.stroke_texture_origin.1);
    }
    if let Some(loc) = shader.location(gl, "u_textureRotation") {
        gl.uniform1f(Some(&loc), engine.stroke_texture_rotation);
    }

    // Scissor each dab to its bounding box so the fragment shader only
    // runs on the pixels it will actually write. Without this, every dab
    // runs the FS on the full stroke texture (e.g. 2550x3300 for a letter
    // canvas) and discards >99.98% of invocations for a typical brush size.
    //
    // The bounding half-extent uses sqrt(2)/2 * size so rotated custom
    // brush tips (whose sampled region is a rotated unit square scaled by
    // size) fit inside. +2 px covers the smoothstep edge feather and any
    // sub-pixel drift from the float→int conversion.
    let tex_w_i = w as i32;
    let tex_h_i = h as i32;
    let effective_size = size; // jitter only shrinks, never grows past base size
    let half_extent = (effective_size * 0.5 * std::f32::consts::SQRT_2).ceil() as i32 + 2;
    gl.enable(WebGl2RenderingContext::SCISSOR_TEST);

    let u_center_loc = shader.location(gl, "u_center");
    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        let cx = chunk[0] as f32;
        let cy = chunk[1] as f32;

        let x0 = (cx.floor() as i32 - half_extent).max(0);
        let y0 = (cy.floor() as i32 - half_extent).max(0);
        let x1 = (cx.ceil() as i32 + half_extent).min(tex_w_i);
        let y1 = (cy.ceil() as i32 + half_extent).min(tex_h_i);
        if x1 <= x0 || y1 <= y0 { continue; }
        gl.scissor(x0, y0, x1 - x0, y1 - y0);

        if let Some(loc) = &u_center_loc {
            gl.uniform2f(Some(loc), cx, cy);
        }
        engine.draw_fullscreen_quad();
    }

    gl.disable(WebGl2RenderingContext::SCISSOR_TEST);
    gl.disable(WebGl2RenderingContext::BLEND);
    gl.blend_equation(WebGl2RenderingContext::FUNC_ADD);
    gl.blend_func(WebGl2RenderingContext::ONE, WebGl2RenderingContext::ZERO);

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

    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }

        // Render to scratch
        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        let shader = &engine.shaders.eraser_dab;
        gl.use_program(Some(&shader.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(tex) = engine.texture_pool.get(stamp_tex) {
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
        }
        if let Some(loc) = shader.location(gl, "u_stampTex") {
            gl.uniform1i(Some(&loc), 0);
        }
        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = shader.location(gl, "u_layerTex") {
            gl.uniform1i(Some(&loc), 1);
        }
        if let Some(loc) = shader.location(gl, "u_opacity") {
            gl.uniform1f(Some(&loc), opacity);
        }
        if let Some(loc) = shader.location(gl, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }
        if let Some(loc) = shader.location(gl, "u_center") {
            gl.uniform2f(Some(&loc), chunk[0] as f32, chunk[1] as f32);
        }
        if let Some(loc) = shader.location(gl, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }

        // Bind selection mask
        let has_sel = engine.selection_mask_texture.is_some();
        if has_sel {
            gl.active_texture(WebGl2RenderingContext::TEXTURE2);
            if let Some(mask_handle) = engine.selection_mask_texture {
                if let Some(mask_tex) = engine.texture_pool.get(mask_handle) {
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
                }
            }
            if let Some(loc) = shader.location(gl, "u_selectionMask") {
                gl.uniform1i(Some(&loc), 2);
            }
        }
        if let Some(loc) = shader.location(gl, "u_hasSelection") {
            gl.uniform1i(Some(&loc), if has_sel { 1 } else { 0 });
        }
        if let Some(loc) = shader.location(gl, "u_docSize") {
            gl.uniform2f(Some(&loc), engine.doc_width as f32, engine.doc_height as f32);
        }
        let (erase_layer_ox, erase_layer_oy) = engine.layer_stack.iter()
            .find(|l| l.id == layer_id)
            .map(|l| (l.x as f32, l.y as f32))
            .unwrap_or((0.0, 0.0));
        if let Some(loc) = shader.location(gl, "u_layerOffset") {
            gl.uniform2f(Some(&loc), erase_layer_ox, erase_layer_oy);
        }

        engine.draw_fullscreen_quad();

        // Copy scratch A -> layer
        let scratch_a_tex = engine.texture_pool.get(engine.scratch_texture_a).cloned();
        engine.render_to_texture(&layer_tex, w as i32, h as i32, |engine| {
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

    engine.texture_pool.release(stamp_tex);
    engine.mark_layer_dirty(layer_id);
}

pub fn end_stroke(engine: &mut EngineInner, layer_id: &str) {
    let _stroke_opacity = engine.stroke_opacity.remove(layer_id).unwrap_or(1.0);

    engine.stroke_use_brush_texture.remove(layer_id);
    let Some(stroke_tex) = engine.stroke_textures.remove(layer_id) else {
        engine.mark_layer_dirty(layer_id);
        return;
    };

    if let Some(&layer_tex_handle) = engine.layer_textures.get(layer_id) {
        let stroke_gl_tex_opt = engine.texture_pool.get(stroke_tex).cloned();
        let layer_gl_tex_opt = engine.texture_pool.get(layer_tex_handle).cloned();
        if let (Some(stroke_gl_tex), Some(layer_gl_tex)) = (stroke_gl_tex_opt, layer_gl_tex_opt) {
            let (w, h) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));

            // The composite → blit round-trip needs an intermediate texture at
            // least as large as the layer. The shared scratch texture is only
            // doc-sized, so allocate a temporary when the layer has been
            // expanded beyond the doc (e.g. after alignment of a layer that
            // had been expanded to full doc size).
            let scratch_size = engine.texture_pool.get_size(engine.scratch_texture_a).unwrap_or((1, 1));
            let needs_temp = scratch_size.0 < w || scratch_size.1 < h;
            let intermediate_tex = if needs_temp {
                match engine.texture_pool.acquire(&engine.gl, w, h) {
                    Ok(t) => {
                        engine.texture_pool.set_nearest_filter(&engine.gl, t);
                        t
                    }
                    Err(_) => {
                        engine.texture_pool.release(stroke_tex);
                        engine.mark_layer_dirty(layer_id);
                        return;
                    }
                }
            } else {
                engine.scratch_texture_a
            };

            if let Some(int_gl_tex) = engine.texture_pool.get(intermediate_tex).cloned() {
                // Composite: stroke OVER layer → intermediate
                let stroke_cl = stroke_gl_tex.clone();
                let layer_cl = layer_gl_tex.clone();
                engine.render_to_texture(&int_gl_tex, w as i32, h as i32, |engine| {
                    let gl = &engine.gl;
                    gl.disable(WebGl2RenderingContext::BLEND);
                    gl.use_program(Some(&engine.shaders.composite.program));
                    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&stroke_cl));
                    if let Some(loc) = engine.shaders.composite.location(gl, "u_srcTex") {
                        gl.uniform1i(Some(&loc), 0);
                    }
                    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_cl));
                    if let Some(loc) = engine.shaders.composite.location(gl, "u_dstTex") {
                        gl.uniform1i(Some(&loc), 1);
                    }
                    if let Some(loc) = engine.shaders.composite.location(gl, "u_opacity") {
                        gl.uniform1f(Some(&loc), 1.0);
                    }
                    // Stroke texture size for brush texture doc-space sampling
                    if let Some(loc) = engine.shaders.composite.location(gl, "u_strokeTexSize") {
                        gl.uniform2f(Some(&loc), w as f32, h as f32);
                    }
                    set_brush_texture_uniforms(engine, &engine.shaders.composite, layer_id, 2);
                    engine.draw_fullscreen_quad();
                });

                // Blit intermediate → layer
                engine.render_to_texture(&layer_gl_tex, w as i32, h as i32, |engine| {
                    let gl = &engine.gl;
                    gl.use_program(Some(&engine.shaders.blit.program));
                    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&int_gl_tex));
                    if let Some(loc) = engine.shaders.blit.location(gl, "u_tex") {
                        gl.uniform1i(Some(&loc), 0);
                    }
                    engine.draw_fullscreen_quad();
                });
            }

            if needs_temp {
                engine.texture_pool.release(intermediate_tex);
            }
        }
    }

    engine.texture_pool.release(stroke_tex);
    engine.mark_layer_dirty(layer_id);
}
