use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;
use crate::gpu::texture_pool::TextureHandle;
use lopsy_core::layer::{GlowDesc, ShadowDesc, StrokeDesc, ColorOverlayDesc};

/// Main compositing pipeline — called every frame
pub fn composite(engine: &mut EngineInner) {
    // Copy viewport state so we don't borrow engine
    let vp_zoom = engine.viewport.zoom;
    let vp_pan_x = engine.viewport.pan_x;
    let vp_pan_y = engine.viewport.pan_y;
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    let bg = engine.bg_color;

    // Reset GL state — brush/shape/selection tools may have left blending enabled.
    // If BLEND is on, the blit passes in blend_onto_composite would blend
    // instead of overwrite, corrupting alpha.
    engine.gl.disable(WebGl2RenderingContext::BLEND);

    // 1. Bind composite FBO and clear with background color
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.clear_color(bg[0], bg[1], bg[2], bg[3]);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // 2. Collect layer info (avoids borrowing engine.layer_stack during rendering)
    let layer_info: Vec<_> = engine.layer_stack.iter().map(|layer| {
        (
            layer.id.clone(),
            layer.visible,
            layer.opacity,
            layer.blend_mode as i32,
            layer.x as f32,
            layer.y as f32,
            layer.width as f32,
            layer.height as f32,
            layer.effects.clone(),
        )
    }).collect();

    // 3. For each visible layer, render with effects
    for (layer_id, visible, opacity, blend_mode, layer_x, layer_y, layer_w, layer_h, effects) in &layer_info {
        if !visible || *opacity < 1e-7 {
            continue;
        }

        let tex_handle = match engine.layer_textures.get(layer_id) {
            Some(&h) => h,
            None => continue,
        };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((*layer_w as u32, *layer_h as u32));

        // --- "Behind" effects: outer glow, drop shadow ---
        if let Some(ref glow) = effects.outer_glow {
            if glow.enabled {
                render_glow(engine, tex_handle, tw, th, glow, 0, *layer_x, *layer_y);
            }
        }
        if let Some(ref shadow) = effects.drop_shadow {
            if shadow.enabled {
                render_shadow(engine, tex_handle, tw, th, shadow, *layer_x, *layer_y);
            }
        }

        // --- Color overlay + blend layer onto composite ---
        let overlay_desc = effects.color_overlay.as_ref().filter(|o| o.enabled);
        if let Some(src_tex) = engine.texture_pool.get(tex_handle).cloned() {
            blend_onto_composite(engine, &src_tex, *opacity, *blend_mode, *layer_x, *layer_y, tw, th, false, overlay_desc);
        }

        // --- Active stroke texture ---
        if let Some(&stroke_handle) = engine.stroke_textures.get(layer_id) {
            if let Some(stroke_tex) = engine.texture_pool.get(stroke_handle).cloned() {
                let (sw, sh) = engine.texture_pool.get_size(stroke_handle).unwrap_or((1, 1));
                blend_onto_composite(engine, &stroke_tex, *opacity, 0, *layer_x, *layer_y, sw, sh, true, None);
            }
        }

        // --- "On top" effects: inner glow, stroke effect ---
        if let Some(ref glow) = effects.inner_glow {
            if glow.enabled {
                render_glow(engine, tex_handle, tw, th, glow, 1, *layer_x, *layer_y);
            }
        }
        if let Some(ref stroke) = effects.stroke {
            if stroke.enabled {
                render_stroke(engine, tex_handle, tw, th, stroke, *layer_x, *layer_y);
            }
        }
    }

    // 4. Final blit to screen canvas
    engine.fbo_pool.unbind(&engine.gl);
    let canvas = engine.gl.canvas().unwrap();
    let canvas_el: web_sys::HtmlCanvasElement = canvas.dyn_into().unwrap();
    let screen_w = canvas_el.width() as i32;
    let screen_h = canvas_el.height() as i32;
    engine.gl.viewport(0, 0, screen_w, screen_h);

    engine.gl.use_program(Some(&engine.shaders.final_blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
    }

    let prog = &engine.shaders.final_blit.program;
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_compositeTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_resolution") { engine.gl.uniform2f(Some(&loc), screen_w as f32, screen_h as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_zoom") { engine.gl.uniform1f(Some(&loc), vp_zoom as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_pan") { engine.gl.uniform2f(Some(&loc), vp_pan_x as f32, vp_pan_y as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_bgAlpha") { engine.gl.uniform1f(Some(&loc), bg[3]); }

    engine.draw_fullscreen_quad();

    engine.dirty_layers.clear();
    engine.needs_recomposite = false;
}

// ---------------------------------------------------------------------------
// Effect rendering helpers
// ---------------------------------------------------------------------------

/// Blend a source texture onto the composite using the blend shader.
fn blend_onto_composite(
    engine: &mut EngineInner,
    src_tex: &web_sys::WebGlTexture,
    opacity: f32,
    blend_mode: i32,
    layer_x: f32,
    layer_y: f32,
    tw: u32,
    th: u32,
    premultiplied: bool,
    overlay: Option<&ColorOverlayDesc>,
) {
    let doc_w = engine.doc_width as f32;
    let doc_h = engine.doc_height as f32;

    engine.gl.use_program(Some(&engine.shaders.blend.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(src_tex));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
    }
    let prog = &engine.shaders.blend.program;
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), opacity); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_blendMode") { engine.gl.uniform1i(Some(&loc), blend_mode); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), if premultiplied { 1 } else { 0 }); }

    // Color overlay — applied inline in the blend shader
    if let Some(ov) = overlay {
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayEnabled") { engine.gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayColor") { engine.gl.uniform3f(Some(&loc), ov.color[0], ov.color[1], ov.color[2]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayOpacity") { engine.gl.uniform1f(Some(&loc), ov.opacity); }
    } else {
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayEnabled") { engine.gl.uniform1i(Some(&loc), 0); }
    }

    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.draw_fullscreen_quad();

    // Break the feedback loop: composite_texture is still bound to TEXTURE1
    // from the blend shader above. Since composite_fbo is backed by composite_texture,
    // rendering to it while the same texture is bound causes undefined behavior on
    // real GPUs (software renderers in headless tests tolerate it).
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    engine.draw_fullscreen_quad();
}

/// Blend an effect result (in scratch_a) onto the composite using the blend shader.
/// Uses the same shader-based compositing as layer blending — no GL blend state needed.
fn blend_effect_onto_composite(engine: &mut EngineInner) {
    let effect_tex = match engine.texture_pool.get(engine.scratch_texture_a) {
        Some(t) => t.clone(),
        None => return,
    };
    let comp_tex = match engine.texture_pool.get(engine.composite_texture) {
        Some(t) => t.clone(),
        None => return,
    };
    let doc_w = engine.doc_width as f32;
    let doc_h = engine.doc_height as f32;

    // Use the blend shader: src=effect, dst=composite → render into scratch_b
    let prog = &engine.shaders.blend.program;
    engine.gl.use_program(Some(prog));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&effect_tex));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&comp_tex));
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), 1.0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_blendMode") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), 0.0, 0.0); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), 0); }

    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_b);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.draw_fullscreen_quad();

    // Break feedback loop: unbind composite_texture from TEXTURE1 before
    // rendering to composite_fbo (which is backed by composite_texture).
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    // Copy scratch_b → composite
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(tex) = engine.texture_pool.get(engine.scratch_texture_b) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
    }
    if let Some(loc) = engine.gl.get_uniform_location(&engine.shaders.blit.program, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    engine.draw_fullscreen_quad();
}

/// Render outer or inner glow.
fn render_glow(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, glow: &GlowDesc, mode: i32, layer_x: f32, layer_y: f32) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.glow.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let prog = &engine.shaders.glow.program;
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_glowColor") { engine.gl.uniform4f(Some(&loc), glow.color[0], glow.color[1], glow.color[2], glow.color[3]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_size") { engine.gl.uniform1f(Some(&loc), glow.size); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_spread") { engine.gl.uniform1f(Some(&loc), glow.spread); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), glow.opacity); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_mode") { engine.gl.uniform1i(Some(&loc), mode); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();

        blend_effect_onto_composite(engine);
    }
}

/// Render drop shadow.
fn render_shadow(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, shadow: &ShadowDesc, layer_x: f32, layer_y: f32) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.shadow.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let prog = &engine.shaders.shadow.program;
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_shadowColor") { engine.gl.uniform4f(Some(&loc), shadow.color[0], shadow.color[1], shadow.color[2], shadow.color[3]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_offset") { engine.gl.uniform2f(Some(&loc), shadow.offset_x, shadow.offset_y); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_blur") { engine.gl.uniform1f(Some(&loc), shadow.blur); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_spread") { engine.gl.uniform1f(Some(&loc), shadow.spread); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), shadow.opacity); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();

        blend_effect_onto_composite(engine);
    }
}

/// Render color overlay into scratch_b.
/// Uses scratch_b (not scratch_a) because blend_onto_composite reads the
/// overlay result as its source while using scratch_a as the intermediate
/// render target — using scratch_a for both would be a feedback loop.
fn render_color_overlay(engine: &mut EngineInner, tex_handle: TextureHandle, overlay: &ColorOverlayDesc) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.color_overlay.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let prog = &engine.shaders.color_overlay.program;
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_overlayColor") { engine.gl.uniform4f(Some(&loc), overlay.color[0], overlay.color[1], overlay.color[2], overlay.color[3]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), overlay.opacity); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_b);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();
    }
}

/// Render stroke effect using proper hard-edge distance check.
fn render_stroke(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, stroke: &StrokeDesc, layer_x: f32, layer_y: f32) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    let position = match stroke.position {
        lopsy_core::layer::StrokePosition::Inside => 1,
        lopsy_core::layer::StrokePosition::Outside => 0,
        lopsy_core::layer::StrokePosition::Center => 2,
    };
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.stroke_edt.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let prog = &engine.shaders.stroke_edt.program;
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_strokeColor") { engine.gl.uniform4f(Some(&loc), stroke.color[0], stroke.color[1], stroke.color[2], stroke.color[3]); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_width") { engine.gl.uniform1f(Some(&loc), stroke.width); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_position") { engine.gl.uniform1i(Some(&loc), position); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_opacity") { engine.gl.uniform1f(Some(&loc), stroke.opacity); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
        if let Some(loc) = engine.gl.get_uniform_location(prog, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();

        blend_effect_onto_composite(engine);
    }
}

/// Composite for export — render to FBO, readPixels
pub fn composite_for_export(engine: &mut EngineInner) -> Result<Vec<u8>, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;
    let bg = engine.bg_color;

    // Render composite (same as display but without viewport transform)
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.clear_color(bg[0], bg[1], bg[2], bg[3]);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // Collect layer info
    let layer_info: Vec<_> = engine.layer_stack.iter().map(|layer| {
        (layer.id.clone(), layer.visible, layer.opacity, layer.blend_mode as i32, layer.x as f32, layer.y as f32, layer.width as f32, layer.height as f32, layer.effects.clone())
    }).collect();

    for (layer_id, visible, opacity, blend_mode, layer_x, layer_y, layer_w, layer_h, effects) in &layer_info {
        if !visible || *opacity < 1e-7 { continue; }
        let tex_handle = match engine.layer_textures.get(layer_id) { Some(&h) => h, None => continue };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((*layer_w as u32, *layer_h as u32));

        // Behind effects
        if let Some(ref glow) = effects.outer_glow { if glow.enabled { render_glow(engine, tex_handle, tw, th, glow, 0, *layer_x, *layer_y); } }
        if let Some(ref shadow) = effects.drop_shadow { if shadow.enabled { render_shadow(engine, tex_handle, tw, th, shadow, *layer_x, *layer_y); } }

        // Color overlay + blend layer
        let overlay_desc = effects.color_overlay.as_ref().filter(|o| o.enabled);
        if let Some(src_tex) = engine.texture_pool.get(tex_handle).cloned() {
            blend_onto_composite(engine, &src_tex, *opacity, *blend_mode, *layer_x, *layer_y, tw, th, false, overlay_desc);
        }

        // On-top effects
        if let Some(ref glow) = effects.inner_glow { if glow.enabled { render_glow(engine, tex_handle, tw, th, glow, 1, *layer_x, *layer_y); } }
        if let Some(ref stroke) = effects.stroke { if stroke.enabled { render_stroke(engine, tex_handle, tw, th, stroke, *layer_x, *layer_y); } }
    }

    // Read pixels
    let pixels = engine.texture_pool.read_rgba(&engine.gl, 0, 0, doc_w, doc_h)?;

    engine.fbo_pool.unbind(&engine.gl);
    Ok(pixels)
}

/// Composite a single layer with its effects onto a transparent canvas.
/// Returns (pixels, offsetX, offsetY, width, height) for the rasterized result.
pub fn composite_single_layer(engine: &mut EngineInner, layer_id: &str) -> Result<Vec<u8>, String> {
    let doc_w = engine.doc_width;
    let doc_h = engine.doc_height;

    // Render to composite FBO with transparent background
    engine.gl.disable(WebGl2RenderingContext::BLEND);
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // Find the layer
    let layer_info = engine.layer_stack.iter().find(|l| l.id == layer_id).map(|layer| {
        (layer.id.clone(), layer.opacity, layer.blend_mode as i32, layer.x as f32, layer.y as f32, layer.width as f32, layer.height as f32, layer.effects.clone())
    });

    if let Some((lid, opacity, _blend_mode, layer_x, layer_y, layer_w, layer_h, effects)) = layer_info {
        let tex_handle = match engine.layer_textures.get(&lid) { Some(&h) => h, None => return Err("Layer texture not found".to_string()) };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((layer_w as u32, layer_h as u32));

        // Behind effects
        if let Some(ref glow) = effects.outer_glow { if glow.enabled { render_glow(engine, tex_handle, tw, th, glow, 0, layer_x, layer_y); } }
        if let Some(ref shadow) = effects.drop_shadow { if shadow.enabled { render_shadow(engine, tex_handle, tw, th, shadow, layer_x, layer_y); } }

        // Layer content with color overlay (use Normal blend, not the layer's blend mode)
        let overlay_desc = effects.color_overlay.as_ref().filter(|o| o.enabled);
        if let Some(src_tex) = engine.texture_pool.get(tex_handle).cloned() {
            blend_onto_composite(engine, &src_tex, opacity, 0, layer_x, layer_y, tw, th, false, overlay_desc);
        }

        // On-top effects
        if let Some(ref glow) = effects.inner_glow { if glow.enabled { render_glow(engine, tex_handle, tw, th, glow, 1, layer_x, layer_y); } }
        if let Some(ref stroke) = effects.stroke { if stroke.enabled { render_stroke(engine, tex_handle, tw, th, stroke, layer_x, layer_y); } }
    }

    // Read pixels
    let pixels = engine.texture_pool.read_rgba(&engine.gl, 0, 0, doc_w, doc_h)?;

    engine.fbo_pool.unbind(&engine.gl);
    engine.needs_recomposite = true;
    Ok(pixels)
}

use wasm_bindgen::JsCast;
