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

    // 2. Iterate layers by index so we can take fresh borrows of engine
    //    inside the loop without holding a long-lived borrow of layer_stack.
    //    For each layer we read the scalar fields + clone only the enabled
    //    effect descs in a short scope, then the `&mut engine` render calls
    //    run freely. This avoids the previous per-frame Vec<tuple>
    //    allocation and the unconditional EffectsDesc.clone().
    let mask_edit_id = engine.mask_edit_layer_id.clone();
    let n = engine.layer_stack.len();

    for idx in 0..n {
        let (
            layer_id,
            visible,
            opacity,
            blend_mode,
            layer_x,
            layer_y,
            layer_w,
            layer_h,
            outer_glow,
            inner_glow,
            drop_shadow,
            stroke_eff,
            color_overlay,
            is_mask_editing,
        ) = {
            let layer = &engine.layer_stack[idx];
            let is_editing = mask_edit_id.as_deref() == Some(layer.id.as_str());
            (
                layer.id.clone(),
                layer.visible,
                layer.opacity,
                layer.blend_mode as i32,
                layer.x as f32,
                layer.y as f32,
                layer.width as f32,
                layer.height as f32,
                layer.effects.outer_glow.as_ref().filter(|g| g.enabled).cloned(),
                layer.effects.inner_glow.as_ref().filter(|g| g.enabled).cloned(),
                layer.effects.drop_shadow.as_ref().filter(|s| s.enabled).cloned(),
                layer.effects.stroke.as_ref().filter(|s| s.enabled).cloned(),
                layer.effects.color_overlay.as_ref().filter(|o| o.enabled).cloned(),
                is_editing,
            )
        };

        if !visible || opacity < 1e-7 {
            continue;
        }

        let mask_info = engine.layer_masks.get(&layer_id).copied().and_then(|mask_handle| {
            let (mw, mh) = engine.texture_pool.get_size(mask_handle)?;
            let mask_gl = engine.texture_pool.get(mask_handle)?.clone();
            let mask_enabled = engine.layer_stack[idx].mask.as_ref().map_or(false, |m| m.enabled);
            Some((mask_gl, mw, mh, mask_enabled))
        });

        let tex_handle = match engine.layer_textures.get(&layer_id) {
            Some(&h) => h,
            None => continue,
        };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((layer_w as u32, layer_h as u32));

        // If a brush stroke is in progress for this layer, pre-merge
        // (layer + stroke_texture) into a scratch so effects (drop shadow,
        // stroke, glows) sample the in-progress stroke as if it were part
        // of the layer. Without this, effects lag by one stroke because
        // endStroke is deferred until the next mousedown (shift-click
        // continuation).
        let merged_handle: Option<TextureHandle> = engine.stroke_textures.get(&layer_id)
            .copied()
            .and_then(|stroke_handle| render_layer_plus_stroke(engine, tex_handle, stroke_handle, tw, th));
        let effect_tex_handle = merged_handle.unwrap_or(tex_handle);

        // --- "Behind" effects: outer glow, drop shadow ---
        if let Some(ref glow) = outer_glow {
            render_glow(engine, effect_tex_handle, tw, th, glow, 0, layer_x, layer_y);
        }
        if let Some(ref shadow) = drop_shadow {
            render_shadow(engine, effect_tex_handle, tw, th, shadow, layer_x, layer_y);
        }

        // --- Color overlay + blend layer onto composite ---
        // In mask edit mode: skip mask clipping so full layer content is visible
        let overlay_desc = color_overlay.as_ref();
        let mask_arg = if is_mask_editing {
            None
        } else {
            mask_info.as_ref().and_then(|(tex, mw, mh, enabled)| {
                if *enabled { Some((tex, *mw, *mh)) } else { None }
            })
        };
        // If an in-progress dodge/burn stroke exists for this layer, render
        // the preview (layer + coverage via dodge/burn shader) into the
        // per-stroke preview texture and composite that instead of the raw
        // layer. This way the stroke is non-destructive until `endStroke`
        // bakes it in.
        let composite_src = if engine.stroke_dodge_textures.contains_key(&layer_id) {
            render_dodge_burn_preview(engine, &layer_id, effect_tex_handle, tw, th)
                .map(|h| (h, tw, th))
        } else if merged_handle.is_some() {
            Some((effect_tex_handle, tw, th))
        } else {
            None
        };
        let (src_handle, src_w, src_h) = composite_src.unwrap_or((tex_handle, tw, th));
        if let Some(src_tex) = engine.texture_pool.get(src_handle).cloned() {
            blend_onto_composite(engine, &src_tex, opacity, blend_mode, layer_x, layer_y, src_w, src_h, false, overlay_desc, mask_arg.as_ref().map(|(t, w, h)| (&**t, *w, *h)));
        }

        // --- Active stroke texture ---
        // Skipped when we merged the stroke into effect_tex_handle above —
        // it's already in the composite source.
        if merged_handle.is_none() {
            if let Some(&stroke_handle) = engine.stroke_textures.get(&layer_id) {
                if let Some(stroke_tex) = engine.texture_pool.get(stroke_handle).cloned() {
                    let (sw, sh) = engine.texture_pool.get_size(stroke_handle).unwrap_or((1, 1));
                    blend_onto_composite(engine, &stroke_tex, opacity, 0, layer_x, layer_y, sw, sh, true, None, mask_arg.as_ref().map(|(t, w, h)| (&**t, *w, *h)));
                }
            }
        }

        // --- Mask edit overlay: translucent blue showing mask coverage ---
        if is_mask_editing {
            if let Some((mask_gl, mw, mh, _)) = &mask_info {
                render_mask_overlay(engine, mask_gl, *mw, *mh, layer_x, layer_y);
            }
        }

        // --- "On top" effects: inner glow, stroke effect ---
        if let Some(ref glow) = inner_glow {
            render_glow(engine, effect_tex_handle, tw, th, glow, 1, layer_x, layer_y);
        }
        if let Some(ref stroke) = stroke_eff {
            render_stroke(engine, effect_tex_handle, tw, th, stroke, layer_x, layer_y);
        }

        if let Some(merged) = merged_handle {
            engine.texture_pool.release(merged);
        }
    }

    // 4. Apply image adjustments (exposure, contrast, etc.) if any are active
    apply_image_adjustments(engine);

    // 5. Final blit to screen canvas
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

    let shader = &engine.shaders.final_blit;
    if let Some(loc) = shader.location(&engine.gl, "u_compositeTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_resolution") { engine.gl.uniform2f(Some(&loc), screen_w as f32, screen_h as f32); }
    if let Some(loc) = shader.location(&engine.gl, "u_zoom") { engine.gl.uniform1f(Some(&loc), vp_zoom as f32); }
    if let Some(loc) = shader.location(&engine.gl, "u_pan") { engine.gl.uniform2f(Some(&loc), vp_pan_x as f32, vp_pan_y as f32); }
    if let Some(loc) = shader.location(&engine.gl, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }
    if let Some(loc) = shader.location(&engine.gl, "u_bgAlpha") { engine.gl.uniform1f(Some(&loc), bg[3]); }

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
    mask_tex: Option<(&web_sys::WebGlTexture, u32, u32)>,
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
    let shader = &engine.shaders.blend;
    if let Some(loc) = shader.location(&engine.gl, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = shader.location(&engine.gl, "u_opacity") { engine.gl.uniform1f(Some(&loc), opacity); }
    if let Some(loc) = shader.location(&engine.gl, "u_blendMode") { engine.gl.uniform1i(Some(&loc), blend_mode); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
    if let Some(loc) = shader.location(&engine.gl, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), if premultiplied { 1 } else { 0 }); }

    // Color overlay — applied inline in the blend shader
    if let Some(ov) = overlay {
        if let Some(loc) = shader.location(&engine.gl, "u_overlayEnabled") { engine.gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = shader.location(&engine.gl, "u_overlayColor") { engine.gl.uniform3f(Some(&loc), ov.color[0], ov.color[1], ov.color[2]); }
        if let Some(loc) = shader.location(&engine.gl, "u_overlayOpacity") { engine.gl.uniform1f(Some(&loc), ov.opacity); }
    } else {
        if let Some(loc) = shader.location(&engine.gl, "u_overlayEnabled") { engine.gl.uniform1i(Some(&loc), 0); }
    }

    // Layer mask
    if let Some((mask_gl_tex, mask_w, mask_h)) = mask_tex {
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE2);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_gl_tex));
        if let Some(loc) = shader.location(&engine.gl, "u_maskTex") { engine.gl.uniform1i(Some(&loc), 2); }
        if let Some(loc) = shader.location(&engine.gl, "u_hasMask") { engine.gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = shader.location(&engine.gl, "u_maskSize") { engine.gl.uniform2f(Some(&loc), mask_w as f32, mask_h as f32); }
    } else {
        if let Some(loc) = shader.location(&engine.gl, "u_hasMask") { engine.gl.uniform1i(Some(&loc), 0); }
    }
    if let Some(loc) = shader.location(&engine.gl, "u_maskOverlay") { engine.gl.uniform1i(Some(&loc), 0); }

    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    // Explicit viewport: earlier passes (e.g. render_layer_plus_stroke) may
    // have left the viewport at an oversized layer texture size, and
    // scratch_texture_a / composite_texture are both doc-sized.
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.draw_fullscreen_quad();

    // Break the feedback loop: composite_texture is still bound to TEXTURE1
    // from the blend shader above. Since composite_fbo is backed by composite_texture,
    // rendering to it while the same texture is bound causes undefined behavior on
    // real GPUs (software renderers in headless tests tolerate it).
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex));
    }
    if let Some(loc) = engine.shaders.blit.location(&engine.gl, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    engine.draw_fullscreen_quad();
}

/// Render the mask as a translucent blue overlay on top of the composite.
/// Used during mask edit mode so the user can see what's under the mask.
fn render_mask_overlay(
    engine: &mut EngineInner,
    mask_tex: &web_sys::WebGlTexture,
    mask_w: u32,
    mask_h: u32,
    layer_x: f32,
    layer_y: f32,
) {
    let doc_w = engine.doc_width as f32;
    let doc_h = engine.doc_height as f32;

    engine.gl.use_program(Some(&engine.shaders.blend.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(mask_tex));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    if let Some(comp_tex) = engine.texture_pool.get(engine.composite_texture) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(comp_tex));
    }
    let shader = &engine.shaders.blend;
    if let Some(loc) = shader.location(&engine.gl, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = shader.location(&engine.gl, "u_opacity") { engine.gl.uniform1f(Some(&loc), 1.0); }
    if let Some(loc) = shader.location(&engine.gl, "u_blendMode") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcSize") { engine.gl.uniform2f(Some(&loc), mask_w as f32, mask_h as f32); }
    if let Some(loc) = shader.location(&engine.gl, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_overlayEnabled") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_hasMask") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_maskOverlay") { engine.gl.uniform1i(Some(&loc), 1); }

    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.draw_fullscreen_quad();

    // Break feedback loop and blit back to composite
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(scratch_tex) = engine.texture_pool.get(engine.scratch_texture_a) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch_tex));
    }
    if let Some(loc) = engine.shaders.blit.location(&engine.gl, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
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
    let shader = &engine.shaders.blend;
    engine.gl.use_program(Some(&shader.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&effect_tex));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&comp_tex));
    if let Some(loc) = shader.location(&engine.gl, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_dstTex") { engine.gl.uniform1i(Some(&loc), 1); }
    if let Some(loc) = shader.location(&engine.gl, "u_opacity") { engine.gl.uniform1f(Some(&loc), 1.0); }
    if let Some(loc) = shader.location(&engine.gl, "u_blendMode") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), 0.0, 0.0); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = shader.location(&engine.gl, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w, doc_h); }
    if let Some(loc) = shader.location(&engine.gl, "u_srcPremultiplied") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_hasMask") { engine.gl.uniform1i(Some(&loc), 0); }
    if let Some(loc) = shader.location(&engine.gl, "u_maskOverlay") { engine.gl.uniform1i(Some(&loc), 0); }

    engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_b);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.draw_fullscreen_quad();

    // Break feedback loop: unbind composite_texture from TEXTURE1 before
    // rendering to composite_fbo (which is backed by composite_texture).
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    // Copy scratch_b → composite
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.use_program(Some(&engine.shaders.blit.program));
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    if let Some(tex) = engine.texture_pool.get(engine.scratch_texture_b) {
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(tex));
    }
    if let Some(loc) = engine.shaders.blit.location(&engine.gl, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
    engine.draw_fullscreen_quad();
}

/// Render (layer + pending stroke) into a scratch texture via the
/// source-over composite shader, matching what `end_stroke` will bake into
/// the layer. Returns the merged texture handle (caller must release), or
/// `None` if the stroke texture size doesn't match the layer.
fn render_layer_plus_stroke(
    engine: &mut EngineInner,
    layer_handle: TextureHandle,
    stroke_handle: TextureHandle,
    tw: u32,
    th: u32,
) -> Option<TextureHandle> {
    if engine.texture_pool.get_size(stroke_handle).map_or(true, |(w, h)| w != tw || h != th) {
        return None;
    }
    let layer_gl = engine.texture_pool.get(layer_handle)?.clone();
    let stroke_gl = engine.texture_pool.get(stroke_handle)?.clone();
    let merged = engine.texture_pool.acquire(&engine.gl, tw, th).ok()?;
    let merged_gl = engine.texture_pool.get(merged)?.clone();

    engine.gl.disable(WebGl2RenderingContext::BLEND);
    engine.render_to_texture(&merged_gl, tw as i32, th as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.composite;
        gl.use_program(Some(&shader.program));
        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&stroke_gl));
        if let Some(loc) = shader.location(gl, "u_srcTex") { gl.uniform1i(Some(&loc), 0); }
        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_gl));
        if let Some(loc) = shader.location(gl, "u_dstTex") { gl.uniform1i(Some(&loc), 1); }
        if let Some(loc) = shader.location(gl, "u_opacity") { gl.uniform1f(Some(&loc), 1.0); }
        engine.draw_fullscreen_quad();
    });

    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    Some(merged)
}

/// Render the in-progress dodge/burn stroke into its per-layer preview
/// texture: `preview = dodge_burn(layer, coverage, mode, exposure=1.0)`.
/// Returns the preview texture handle, or `None` if no preview slot is
/// available. Exposure is already baked into the coverage values, so we
/// pass 1.0 here.
fn render_dodge_burn_preview(
    engine: &mut EngineInner,
    layer_id: &str,
    layer_handle: TextureHandle,
    tw: u32,
    th: u32,
) -> Option<TextureHandle> {
    let coverage_handle = *engine.stroke_dodge_textures.get(layer_id)?;
    let preview_handle = *engine.stroke_dodge_preview_textures.get(layer_id)?;
    let mode = *engine.stroke_dodge_modes.get(layer_id).unwrap_or(&0);

    // Layer texture may have been resized (ensure_layer_full_size) since
    // begin_stroke — if coverage/preview are stale, skip preview and let
    // the raw layer through.
    if engine.texture_pool.get_size(coverage_handle).map_or(true, |(w, h)| w != tw || h != th) {
        return None;
    }
    if engine.texture_pool.get_size(preview_handle).map_or(true, |(w, h)| w != tw || h != th) {
        return None;
    }

    let layer_gl_tex = engine.texture_pool.get(layer_handle)?.clone();
    let coverage_gl_tex = engine.texture_pool.get(coverage_handle)?.clone();
    let preview_gl_tex = engine.texture_pool.get(preview_handle)?.clone();

    let gl = &engine.gl;
    gl.disable(WebGl2RenderingContext::BLEND);

    engine.render_to_texture(&preview_gl_tex, tw as i32, th as i32, |engine| {
        let gl = &engine.gl;
        let shader = &engine.shaders.dodge_burn;
        gl.use_program(Some(&shader.program));

        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_gl_tex));
        if let Some(loc) = shader.location(gl, "u_layerTex") { gl.uniform1i(Some(&loc), 0); }

        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&coverage_gl_tex));
        if let Some(loc) = shader.location(gl, "u_stampTex") { gl.uniform1i(Some(&loc), 1); }

        if let Some(loc) = shader.location(gl, "u_mode") { gl.uniform1i(Some(&loc), mode as i32); }
        if let Some(loc) = shader.location(gl, "u_exposure") { gl.uniform1f(Some(&loc), 1.0); }

        engine.draw_fullscreen_quad();
    });

    // Unbind to avoid feedback loops in subsequent passes.
    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);
    gl.active_texture(WebGl2RenderingContext::TEXTURE1);
    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, None);

    Some(preview_handle)
}

/// Render outer or inner glow.
fn render_glow(engine: &mut EngineInner, tex_handle: TextureHandle, tw: u32, th: u32, glow: &GlowDesc, mode: i32, layer_x: f32, layer_y: f32) {
    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;
    if let Some(layer_tex) = engine.texture_pool.get(tex_handle).cloned() {
        engine.gl.use_program(Some(&engine.shaders.glow.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        let shader = &engine.shaders.glow;
        if let Some(loc) = shader.location(&engine.gl, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = shader.location(&engine.gl, "u_glowColor") { engine.gl.uniform4f(Some(&loc), glow.color[0], glow.color[1], glow.color[2], glow.color[3]); }
        if let Some(loc) = shader.location(&engine.gl, "u_size") { engine.gl.uniform1f(Some(&loc), glow.size); }
        if let Some(loc) = shader.location(&engine.gl, "u_spread") { engine.gl.uniform1f(Some(&loc), glow.spread); }
        if let Some(loc) = shader.location(&engine.gl, "u_opacity") { engine.gl.uniform1f(Some(&loc), glow.opacity); }
        if let Some(loc) = shader.location(&engine.gl, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }
        if let Some(loc) = shader.location(&engine.gl, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
        if let Some(loc) = shader.location(&engine.gl, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
        if let Some(loc) = shader.location(&engine.gl, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }
        if let Some(loc) = shader.location(&engine.gl, "u_mode") { engine.gl.uniform1i(Some(&loc), mode); }

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
        let shader = &engine.shaders.shadow;
        if let Some(loc) = shader.location(&engine.gl, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = shader.location(&engine.gl, "u_shadowColor") { engine.gl.uniform4f(Some(&loc), shadow.color[0], shadow.color[1], shadow.color[2], shadow.color[3]); }
        if let Some(loc) = shader.location(&engine.gl, "u_offset") { engine.gl.uniform2f(Some(&loc), shadow.offset_x, shadow.offset_y); }
        if let Some(loc) = shader.location(&engine.gl, "u_blur") { engine.gl.uniform1f(Some(&loc), shadow.blur); }
        if let Some(loc) = shader.location(&engine.gl, "u_spread") { engine.gl.uniform1f(Some(&loc), shadow.spread); }
        if let Some(loc) = shader.location(&engine.gl, "u_opacity") { engine.gl.uniform1f(Some(&loc), shadow.opacity); }
        if let Some(loc) = shader.location(&engine.gl, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }
        if let Some(loc) = shader.location(&engine.gl, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
        if let Some(loc) = shader.location(&engine.gl, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
        if let Some(loc) = shader.location(&engine.gl, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);
        engine.gl.clear_color(0.0, 0.0, 0.0, 0.0);
        engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);
        engine.draw_fullscreen_quad();

        blend_effect_onto_composite(engine);
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
        let shader = &engine.shaders.stroke_edt;
        if let Some(loc) = shader.location(&engine.gl, "u_srcTex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = shader.location(&engine.gl, "u_strokeColor") { engine.gl.uniform4f(Some(&loc), stroke.color[0], stroke.color[1], stroke.color[2], stroke.color[3]); }
        if let Some(loc) = shader.location(&engine.gl, "u_width") { engine.gl.uniform1f(Some(&loc), stroke.width); }
        if let Some(loc) = shader.location(&engine.gl, "u_position") { engine.gl.uniform1i(Some(&loc), position); }
        if let Some(loc) = shader.location(&engine.gl, "u_opacity") { engine.gl.uniform1f(Some(&loc), stroke.opacity); }
        if let Some(loc) = shader.location(&engine.gl, "u_texelSize") { engine.gl.uniform2f(Some(&loc), 1.0 / tw as f32, 1.0 / th as f32); }
        if let Some(loc) = shader.location(&engine.gl, "u_srcOffset") { engine.gl.uniform2f(Some(&loc), layer_x, layer_y); }
        if let Some(loc) = shader.location(&engine.gl, "u_srcSize") { engine.gl.uniform2f(Some(&loc), tw as f32, th as f32); }
        if let Some(loc) = shader.location(&engine.gl, "u_docSize") { engine.gl.uniform2f(Some(&loc), doc_w as f32, doc_h as f32); }

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

    // Reset GL state — brush/shape/selection tools may have left blending enabled.
    // If BLEND is on, the blit passes in blend_onto_composite would blend
    // instead of overwrite, corrupting alpha.
    engine.gl.disable(WebGl2RenderingContext::BLEND);

    // Render composite (same as display but without viewport transform)
    engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
    engine.gl.viewport(0, 0, doc_w as i32, doc_h as i32);
    engine.gl.clear_color(bg[0], bg[1], bg[2], bg[3]);
    engine.gl.clear(WebGl2RenderingContext::COLOR_BUFFER_BIT);

    // Collect layer info
    let layer_info: Vec<_> = engine.layer_stack.iter().map(|layer| {
        let mask_info = engine.layer_masks.get(&layer.id).and_then(|&mask_handle| {
            let (mw, mh) = engine.texture_pool.get_size(mask_handle)?;
            let mask_gl = engine.texture_pool.get(mask_handle)?.clone();
            let mask_enabled = layer.mask.as_ref().map_or(false, |m| m.enabled);
            Some((mask_gl, mw, mh, mask_enabled))
        });
        (layer.id.clone(), layer.visible, layer.opacity, layer.blend_mode as i32, layer.x as f32, layer.y as f32, layer.width as f32, layer.height as f32, layer.effects.clone(), mask_info)
    }).collect();

    for (layer_id, visible, opacity, blend_mode, layer_x, layer_y, layer_w, layer_h, effects, mask_info) in &layer_info {
        if !visible || *opacity < 1e-7 { continue; }
        let tex_handle = match engine.layer_textures.get(layer_id) { Some(&h) => h, None => continue };
        let (tw, th) = engine.texture_pool.get_size(tex_handle).unwrap_or((*layer_w as u32, *layer_h as u32));

        let mask_arg = mask_info.as_ref().and_then(|(tex, mw, mh, enabled)| {
            if *enabled { Some((tex, *mw, *mh)) } else { None }
        });

        // Behind effects
        if let Some(ref glow) = effects.outer_glow { if glow.enabled { render_glow(engine, tex_handle, tw, th, glow, 0, *layer_x, *layer_y); } }
        if let Some(ref shadow) = effects.drop_shadow { if shadow.enabled { render_shadow(engine, tex_handle, tw, th, shadow, *layer_x, *layer_y); } }

        // Color overlay + blend layer
        let overlay_desc = effects.color_overlay.as_ref().filter(|o| o.enabled);
        if let Some(src_tex) = engine.texture_pool.get(tex_handle).cloned() {
            blend_onto_composite(engine, &src_tex, *opacity, *blend_mode, *layer_x, *layer_y, tw, th, false, overlay_desc, mask_arg.as_ref().map(|(t, w, h)| (&**t, *w, *h)));
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
            blend_onto_composite(engine, &src_tex, opacity, 0, layer_x, layer_y, tw, th, false, overlay_desc, None);
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

/// Apply image adjustments (exposure, contrast, highlights, shadows, whites, blacks)
/// to the composite texture. Renders composite → scratch_a via adjustments shader,
/// then copies scratch_a → composite.
fn apply_image_adjustments(engine: &mut EngineInner) {
    let has_adjustments =
        engine.adjustments.exposure.abs() > 1e-6
        || engine.adjustments.contrast.abs() > 1e-6
        || engine.adjustments.highlights.abs() > 1e-6
        || engine.adjustments.shadows.abs() > 1e-6
        || engine.adjustments.whites.abs() > 1e-6
        || engine.adjustments.blacks.abs() > 1e-6
        || engine.adjustments.saturation.abs() > 1e-6
        || engine.adjustments.vibrance.abs() > 1e-6
        || engine.adjustments.has_curves
        || engine.adjustments.has_levels;
    let has_vignette = engine.adjustments.vignette.abs() > 1e-6;

    if !has_adjustments && !has_vignette { return; }

    let doc_w = engine.doc_width as i32;
    let doc_h = engine.doc_height as i32;

    if has_adjustments {
        // Render composite → scratch_a via adjustments shader
        let comp_tex = match engine.texture_pool.get(engine.composite_texture) {
            Some(t) => t.clone(),
            None => return,
        };

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);

        let shader = &engine.shaders.adjustments;
        engine.gl.use_program(Some(&shader.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&comp_tex));
        if let Some(loc) = shader.location(&engine.gl, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = shader.location(&engine.gl, "u_brightness") { engine.gl.uniform1f(Some(&loc), 0.0); }
        if let Some(loc) = shader.location(&engine.gl, "u_contrast") { engine.gl.uniform1f(Some(&loc), engine.adjustments.contrast / 100.0); }
        if let Some(loc) = shader.location(&engine.gl, "u_exposure") { engine.gl.uniform1f(Some(&loc), engine.adjustments.exposure); }
        if let Some(loc) = shader.location(&engine.gl, "u_highlights") { engine.gl.uniform1f(Some(&loc), engine.adjustments.highlights); }
        if let Some(loc) = shader.location(&engine.gl, "u_shadows") { engine.gl.uniform1f(Some(&loc), engine.adjustments.shadows); }
        if let Some(loc) = shader.location(&engine.gl, "u_whites") { engine.gl.uniform1f(Some(&loc), engine.adjustments.whites); }
        if let Some(loc) = shader.location(&engine.gl, "u_blacks") { engine.gl.uniform1f(Some(&loc), engine.adjustments.blacks); }
        if let Some(loc) = shader.location(&engine.gl, "u_saturation") { engine.gl.uniform1f(Some(&loc), engine.adjustments.saturation / 100.0); }
        if let Some(loc) = shader.location(&engine.gl, "u_vibrance") { engine.gl.uniform1f(Some(&loc), engine.adjustments.vibrance / 100.0); }
        // Levels LUT — bound to TEXTURE2 so it doesn't clobber u_tex or u_curveLut.
        let has_levels = engine.adjustments.has_levels && engine.adjustments.levels_texture.is_some();
        if has_levels {
            if let Some(levels_tex) = engine.adjustments.levels_texture.and_then(|h| engine.texture_pool.get(h)) {
                let levels_tex = levels_tex.clone();
                engine.gl.active_texture(WebGl2RenderingContext::TEXTURE2);
                engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&levels_tex));
                if let Some(loc) = shader.location(&engine.gl, "u_levelsLut") { engine.gl.uniform1i(Some(&loc), 2); }
                engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            }
        }
        if let Some(loc) = shader.location(&engine.gl, "u_hasLevels") {
            engine.gl.uniform1f(Some(&loc), if has_levels { 1.0 } else { 0.0 });
        }

        // Curves LUT — bound to TEXTURE1 so it doesn't clobber u_tex or u_levelsLut.
        let has_curves = engine.adjustments.has_curves && engine.adjustments.curves_texture.is_some();
        if has_curves {
            if let Some(curve_tex) = engine.adjustments.curves_texture.and_then(|h| engine.texture_pool.get(h)) {
                let curve_tex = curve_tex.clone();
                engine.gl.active_texture(WebGl2RenderingContext::TEXTURE1);
                engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&curve_tex));
                if let Some(loc) = shader.location(&engine.gl, "u_curveLut") { engine.gl.uniform1i(Some(&loc), 1); }
                engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
            }
        }
        if let Some(loc) = shader.location(&engine.gl, "u_hasCurves") {
            engine.gl.uniform1f(Some(&loc), if has_curves { 1.0 } else { 0.0 });
        }
        engine.draw_fullscreen_quad();

        // Copy scratch_a → composite
        engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
        engine.gl.use_program(Some(&engine.shaders.blit.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a) {
            engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
        }
        if let Some(loc) = engine.shaders.blit.location(&engine.gl, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
        engine.draw_fullscreen_quad();
    }

    if has_vignette {
        let comp_tex = match engine.texture_pool.get(engine.composite_texture) {
            Some(t) => t.clone(),
            None => return,
        };

        engine.fbo_pool.bind(&engine.gl, engine.scratch_fbo_a);
        engine.gl.viewport(0, 0, doc_w, doc_h);

        let shader = &engine.shaders.vignette;
        engine.gl.use_program(Some(&shader.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&comp_tex));
        if let Some(loc) = shader.location(&engine.gl, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
        if let Some(loc) = shader.location(&engine.gl, "u_amount") { engine.gl.uniform1f(Some(&loc), engine.adjustments.vignette); }
        engine.draw_fullscreen_quad();

        // Copy scratch_a → composite
        engine.fbo_pool.bind(&engine.gl, engine.composite_fbo);
        engine.gl.use_program(Some(&engine.shaders.blit.program));
        engine.gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        if let Some(scratch) = engine.texture_pool.get(engine.scratch_texture_a) {
            engine.gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(scratch));
        }
        if let Some(loc) = engine.shaders.blit.location(&engine.gl, "u_tex") { engine.gl.uniform1i(Some(&loc), 0); }
        engine.draw_fullscreen_quad();
    }
}

use wasm_bindgen::JsCast;
