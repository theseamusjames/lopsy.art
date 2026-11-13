use lopsy_core::geometry::Rect;
use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Target};
use crate::gpu::texture_pool::TextureHandle;
use crate::gpu::params::brush::{BrushDabParams, EraserDabParams, PencilDabParams};
use crate::gpu::uniforms::Mat2;
use crate::gpu::params::composite::CompositeParams;

/// `handle`, if it still names a live texture.
fn live_texture(engine: &EngineInner, handle: Option<TextureHandle>) -> Option<TextureHandle> {
    handle.filter(|&h| engine.texture_pool.get(h).is_some())
}

fn layer_offset(engine: &EngineInner, layer_id: &str) -> (f32, f32) {
    engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0))
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
        let stroke_tex = engine.texture_pool.acquire(w, h)?;
        engine.stroke_textures.insert(layer_id.to_string(), stroke_tex);

        if engine.stroke_fbo.is_none() {
            let fbo = engine.fbo_pool.create()?;
            engine.stroke_fbo = Some(fbo);
        }

        if let (Some(fbo), Some(tex)) = (engine.stroke_fbo, engine.texture_pool.get(stroke_tex)) {
            engine.fbo_pool.attach_texture(fbo, tex);
            engine.fbo_pool.unbind();
        }
    }
    Ok(())
}

/// Pre-allocate the GPU resources that `begin_stroke` would otherwise
/// allocate at the start of a stroke, so the first stroke on a large canvas
/// doesn't pay a visible texture-allocation hesitation. Idempotent — safe to
/// call repeatedly. No-op when there is already an active stroke for this
/// layer.
pub fn prewarm_stroke(engine: &mut EngineInner, layer_id: &str) -> Result<(), String> {
    // If a stroke is already in progress, the resources are already live —
    // don't disturb them.
    if engine.stroke_textures.contains_key(layer_id) {
        return Ok(());
    }

    engine.ensure_layer_full_size(layer_id)?;

    if engine.stroke_fbo.is_none() {
        let fbo = engine.fbo_pool.create()?;
        engine.stroke_fbo = Some(fbo);
    }

    if let Some(&layer_tex) = engine.layer_textures.get(layer_id) {
        if let Some((w, h)) = engine.texture_pool.get_size(layer_tex) {
            if w > 0 && h > 0 {
                // Acquire a stroke-sized texture and release it immediately
                // so a freshly-sized texture sits in the pool ready for the
                // next `begin_stroke` call.
                let warm = engine.texture_pool.acquire(w, h)?;
                engine.texture_pool.release(warm);
            }
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

    // Get stroke texture (or layer texture if no active stroke)
    let stroke_tex = engine.stroke_textures.get(layer_id).copied();
    let target_tex = stroke_tex.or_else(|| engine.layer_textures.get(layer_id).copied());
    let tex_handle = match target_tex {
        Some(h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    // Set stroke origin from first dab position if not yet set
    if !engine.stroke_texture_origin_set && points.len() >= 2 {
        engine.stroke_texture_origin = (points[0] as f32, points[1] as f32);
        engine.stroke_texture_origin_set = true;
    }

    // Break any accidental feedback loop: the stroke texture may still be
    // bound to a texture unit from acquire() or attach_texture(). If it's
    // simultaneously attached as the FBO color target AND bound to a
    // sampler unit, the WebGL implementation can silently discard the draw.
    engine.gpu().unbind_textures(3);

    // Dab accumulation blending.
    // Alpha/circle brushes: MAX blending — each pixel takes the highest
    // alpha from any overlapping dab, preventing opacity compounding.
    // Color brushes: premultiplied alpha "over" compositing — overlapping
    // rotated dabs layer correctly instead of per-channel MAX which would
    // create phantom colors (e.g. blue + orange → pink).
    let is_color_tip = engine.brush_has_tip && engine.brush_tip_is_color;
    let blend = if is_color_tip { Blend::PremulOver } else { Blend::Max };
    let shader = if is_color_tip {
        &engine.shaders.brush_dab_color
    } else if engine.brush_has_tip {
        &engine.shaders.brush_dab_alpha
    } else {
        &engine.shaders.brush_dab_circle
    };

    let has_selection = engine.selection_mask_texture.is_some();
    // Layer offset for selection mask coordinate mapping
    let (layer_ox, layer_oy) = layer_offset(engine, layer_id);
    let use_brush_tip = engine.brush_has_tip && engine.brush_tip_texture.is_some();
    let tip_aspect = if use_brush_tip && engine.brush_tip_width > 0 && engine.brush_tip_height > 0 {
        let max_dim = engine.brush_tip_width.max(engine.brush_tip_height) as f32;
        (engine.brush_tip_width as f32 / max_dim, engine.brush_tip_height as f32 / max_dim)
    } else {
        (1.0, 1.0)
    };
    let [m00, m01, m10, m11] = engine.brush_dab_transform;
    let use_brush_texture = engine.brush_has_texture && engine.brush_texture.is_some();

    // No stamp texture needed — computed analytically in shader
    let first_center = match points {
        [x, y, ..] => [*x as f32, *y as f32],
        _ => [0.0, 0.0],
    };
    let params = BrushDabParams {
        brush_color: [r, g, b, a],
        opacity,
        flow,
        hardness,
        center: first_center,
        size,
        tex_size: [w as f32, h as f32],
        has_selection: i32::from(has_selection),
        doc_size: [engine.doc_width as f32, engine.doc_height as f32],
        layer_offset: [layer_ox, layer_oy],
        angle: if use_brush_tip { engine.brush_angle } else { 0.0 },
        // GLSL mat2 is column-major.
        dab_transform: Mat2([m00, m10, m01, m11]),
        tip_aspect: [tip_aspect.0, tip_aspect.1],
        size_jitter,
        angle_jitter,
        opacity_jitter,
        has_brush_texture: i32::from(use_brush_texture),
        texture_scale: engine.brush_texture_scale,
        texture_blend_mode: engine.brush_texture_blend_mode as i32,
        brush_texture_size: [engine.brush_texture_width as f32, engine.brush_texture_height as f32],
        stroke_origin: [engine.stroke_texture_origin.0, engine.stroke_texture_origin.1],
        texture_rotation: engine.stroke_texture_rotation,
    };
    let mut pass = engine.pass(shader, params);
    if let Some(mask) = live_texture(engine, engine.selection_mask_texture) {
        pass = pass.texture("u_selectionMask", mask);
    }
    // Custom brush tip texture (for alpha and color variants)
    if use_brush_tip {
        if let Some(tip) = live_texture(engine, engine.brush_tip_texture) {
            pass = pass.texture("u_brushTip", tip);
        }
    }
    if use_brush_texture {
        if let Some(tex) = live_texture(engine, engine.brush_texture) {
            pass = pass.texture("u_brushTexture", tex);
        }
    }
    let pass = pass.blend(blend);

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

    if let Some(mut dabs) = pass.begin(Target::Texture(tex_handle)) {
        for chunk in points.chunks(2) {
            if chunk.len() < 2 { break; }
            let cx = chunk[0] as f32;
            let cy = chunk[1] as f32;

            let x0 = (cx.floor() as i32 - half_extent).max(0);
            let y0 = (cy.floor() as i32 - half_extent).max(0);
            let x1 = (cx.ceil() as i32 + half_extent).min(tex_w_i);
            let y1 = (cy.ceil() as i32 + half_extent).min(tex_h_i);
            if x1 <= x0 || y1 <= y0 { continue; }

            dabs.set(&BrushDabParams { center: [cx, cy], ..params });
            dabs.draw_in(Rect::new(x0, y0, (x1 - x0) as u32, (y1 - y0) as u32));
        }
        dabs.end();
    }

    engine.mark_layer_dirty(layer_id);
}

/// Render a pencil line as hard, aliased square dabs entirely on the GPU.
///
/// The previous implementation read the full selection mask back to the CPU on
/// every call and built/uploaded a pixel buffer per interpolated point, which
/// made strokes on large canvases unusably slow. This mirrors `apply_dab_batch`:
/// the dabs are drawn with a dedicated shader (scissored to each block) and the
/// selection mask is sampled on the GPU, so nothing leaves the GPU.
pub fn draw_pencil_line(
    engine: &mut EngineInner,
    layer_id: &str,
    x0: f64, y0: f64, x1: f64, y1: f64,
    r: f32, g: f32, b: f32, a: f32, size: f32,
) {
    if size <= 0.0 { return; }

    if !engine.stroke_textures.contains_key(layer_id) {
        if begin_stroke(engine, layer_id).is_err() { return; }
    }
    // Pencil strokes never use the brush texture during compositing.
    engine.stroke_use_brush_texture.insert(layer_id.to_string(), false);

    let Some(&stroke_tex) = engine.stroke_textures.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(stroke_tex).unwrap_or((1, 1));

    let points = lopsy_core::brush::interpolate_points(x0, y0, x1, y1, 1.0);
    if points.len() < 2 { return; }

    // Break any accidental feedback loop (see apply_dab_batch).
    engine.gpu().unbind_textures(1);

    let has_selection = engine.selection_mask_texture.is_some();
    let (layer_ox, layer_oy) = layer_offset(engine, layer_id);

    let params = PencilDabParams {
        color: [r, g, b, a],
        center: [points[0] as f32, points[1] as f32],
        size,
        tex_size: [w as f32, h as f32],
        has_selection: i32::from(has_selection),
        doc_size: [engine.doc_width as f32, engine.doc_height as f32],
        layer_offset: [layer_ox, layer_oy],
    };
    let mut pass = engine.pass(&engine.shaders.pencil_dab, params);
    if let Some(mask) = live_texture(engine, engine.selection_mask_texture) {
        pass = pass.texture("u_selectionMask", mask);
    }
    // MAX blending so overlapping dabs along the stroke don't compound alpha.
    let pass = pass.blend(Blend::Max);

    // Scissor each dab to its block so the fragment shader only runs over the
    // pixels it writes, not the whole stroke texture.
    let tex_w_i = w as i32;
    let tex_h_i = h as i32;
    let half = (size / 2.0).floor() as i32;
    let block = size.ceil() as i32;

    if let Some(mut dabs) = pass.begin(Target::Texture(stroke_tex)) {
        for chunk in points.chunks(2) {
            if chunk.len() < 2 { break; }
            let cx = chunk[0] as f32;
            let cy = chunk[1] as f32;

            let lo_x = (cx.floor() as i32 - half).max(0);
            let lo_y = (cy.floor() as i32 - half).max(0);
            let hi_x = (cx.floor() as i32 - half + block).min(tex_w_i);
            let hi_y = (cy.floor() as i32 - half + block).min(tex_h_i);
            if hi_x <= lo_x || hi_y <= lo_y { continue; }

            dabs.set(&PencilDabParams { center: [cx, cy], ..params });
            dabs.draw_in(Rect::new(lo_x, lo_y, (hi_x - lo_x) as u32, (hi_y - lo_y) as u32));
        }
        dabs.end();
    }

    engine.mark_layer_dirty(layer_id);
    engine.needs_recomposite = true;
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
    let tex_handle = match engine.layer_textures.get(layer_id) {
        Some(&h) => h,
        None => return,
    };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }
    // This pass renders at the layer's size and blits the whole scratch
    // back, so scratch must match the layer exactly (see ensure_scratch_size).
    if engine.ensure_scratch_size(w, h).is_err() { return; }

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

    let stamp_tex = match engine.texture_pool.acquire(stamp_size, stamp_size) {
        Ok(h) => h,
        Err(_) => return,
    };
    let _ = engine.texture_pool.upload_rgba(stamp_tex, 0, 0, stamp_size, stamp_size, &stamp_rgba,
    );

    let has_sel = engine.selection_mask_texture.is_some();
    let (layer_ox, layer_oy) = layer_offset(engine, layer_id);

    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }

        // Render to scratch
        let mut pass = engine.pass(&engine.shaders.eraser_dab, EraserDabParams {
            opacity,
            center: [chunk[0] as f32, chunk[1] as f32],
            size,
            tex_size: [w as f32, h as f32],
            has_selection: i32::from(has_sel),
            doc_size: [engine.doc_width as f32, engine.doc_height as f32],
            layer_offset: [layer_ox, layer_oy],
        })
            .texture("u_stampTex", stamp_tex)
            .texture("u_layerTex", tex_handle);
        if let Some(mask) = live_texture(engine, engine.selection_mask_texture) {
            pass = pass.texture("u_selectionMask", mask);
        }
        pass.viewport(0, 0, w as i32, h as i32)
            .draw(Target::Framebuffer(engine.scratch_fbo_a));

        // Copy scratch A -> layer
        engine.pass(&engine.shaders.blit, ())
            .texture("u_tex", engine.scratch_texture_a)
            .viewport(0, 0, w as i32, h as i32)
            .draw(Target::Texture(tex_handle));
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
    merge_stroke_texture(engine, layer_id, stroke_tex);
}

/// Composite a premultiplied, layer-sized stroke texture over the layer,
/// then release it and mark the layer dirty.
fn merge_stroke_texture(engine: &mut EngineInner, layer_id: &str, stroke_tex: TextureHandle) {
    if let Some(&layer_tex_handle) = engine.layer_textures.get(layer_id) {
        if engine.texture_pool.get(stroke_tex).is_some()
            && engine.texture_pool.get(layer_tex_handle).is_some()
        {
            let (w, h) = engine.texture_pool.get_size(layer_tex_handle).unwrap_or((1, 1));

            // The composite → blit round-trip needs an intermediate texture at
            // least as large as the layer. The shared scratch texture is only
            // doc-sized, so allocate a temporary when the layer has been
            // expanded beyond the doc (e.g. after alignment of a layer that
            // had been expanded to full doc size).
            let scratch_size = engine.texture_pool.get_size(engine.scratch_texture_a).unwrap_or((1, 1));
            let needs_temp = scratch_size.0 < w || scratch_size.1 < h;
            let intermediate_tex = if needs_temp {
                match engine.texture_pool.acquire(w, h) {
                    Ok(t) => {
                        engine.texture_pool.set_nearest_filter(t);
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

            if engine.texture_pool.get(intermediate_tex).is_some() {
                // Composite: stroke OVER layer → intermediate
                engine.pass(&engine.shaders.composite, CompositeParams { opacity: 1.0 })
                    .texture("u_srcTex", stroke_tex)
                    .texture("u_dstTex", layer_tex_handle)
                    .blend(Blend::Off)
                    .viewport(0, 0, w as i32, h as i32)
                    .draw(Target::Texture(intermediate_tex));

                // Blit intermediate → layer
                engine.pass(&engine.shaders.blit, ())
                    .texture("u_tex", intermediate_tex)
                    .viewport(0, 0, w as i32, h as i32)
                    .draw(Target::Texture(layer_tex_handle));
            }

            if needs_temp {
                engine.texture_pool.release(intermediate_tex);
            }
        }
    }

    engine.texture_pool.release(stroke_tex);
    engine.mark_layer_dirty(layer_id);
}

/// Composite a straight-alpha RGBA patch over a layer, with its top-left at
/// document position (`x`, `y`). The layer is first expanded to cover the
/// document (as a brush stroke does); the part of the patch outside the
/// layer texture is dropped. Only the patch crosses the bridge, so stroking
/// a path costs its bounding box, not a full-layer readback and re-upload
/// (#1292). Unlike a brush stroke, no brush tip or selection applies.
pub fn composite_patch_onto_layer(
    engine: &mut EngineInner,
    layer_id: &str,
    data: &[u8],
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<(), String> {
    if w == 0 || h == 0 || data.len() < (w * h * 4) as usize {
        return Err("patch data does not match its size".into());
    }
    engine.ensure_layer_full_size(layer_id)?;
    let layer_tex = *engine.layer_textures.get(layer_id).ok_or("layer has no texture")?;
    let (lw, lh) = engine.texture_pool.get_size(layer_tex).unwrap_or((1, 1));
    let (lx, ly) = engine.layer_stack.iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x, l.y))
        .unwrap_or((0, 0));

    // Clip the patch to the layer texture, in texture-local pixels.
    let x0 = (x - lx).max(0);
    let y0 = (y - ly).max(0);
    let x1 = (x - lx + w as i32).min(lw as i32);
    let y1 = (y - ly + h as i32).min(lh as i32);
    if x1 <= x0 || y1 <= y0 {
        return Ok(());
    }
    let cw = (x1 - x0) as usize;
    let ch = (y1 - y0) as usize;
    let src_x = (x0 - (x - lx)) as usize;
    let src_y = (y0 - (y - ly)) as usize;
    let mut premultiplied = Vec::with_capacity(cw * ch * 4);
    for row in 0..ch {
        let start = ((src_y + row) * w as usize + src_x) * 4;
        for px in data[start..start + cw * 4].chunks_exact(4) {
            let a = px[3] as u32;
            premultiplied.push(((px[0] as u32 * a + 127) / 255) as u8);
            premultiplied.push(((px[1] as u32 * a + 127) / 255) as u8);
            premultiplied.push(((px[2] as u32 * a + 127) / 255) as u8);
            premultiplied.push(px[3]);
        }
    }

    let stroke_tex = engine.texture_pool.acquire(lw, lh)?;
    if let Err(e) = engine.texture_pool.upload_rgba(stroke_tex, x0, y0, cw as u32, ch as u32, &premultiplied) {
        engine.texture_pool.release(stroke_tex);
        return Err(e);
    }
    merge_stroke_texture(engine, layer_id, stroke_tex);
    Ok(())
}
