use web_sys::WebGl2RenderingContext;
use crate::engine::EngineInner;

/// Parse the 24-byte compressed snapshot header.
/// Matches the format written by `read_layer_pixels_compressed`.
fn parse_header(blob: &[u8]) -> Option<(i32, i32, i32, i32, i32, i32)> {
    if blob.len() < 24 {
        return None;
    }
    let crop_x = i32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]);
    let crop_y = i32::from_le_bytes([blob[4], blob[5], blob[6], blob[7]]);
    let crop_w = i32::from_le_bytes([blob[8], blob[9], blob[10], blob[11]]);
    let crop_h = i32::from_le_bytes([blob[12], blob[13], blob[14], blob[15]]);
    let full_w = i32::from_le_bytes([blob[16], blob[17], blob[18], blob[19]]);
    let full_h = i32::from_le_bytes([blob[20], blob[21], blob[22], blob[23]]);
    Some((crop_x, crop_y, crop_w, crop_h, full_w, full_h))
}

/// Start a History Brush stroke: decompress the snapshot blob and upload it
/// into a temporary texture sized to match the current layer texture. If
/// `blob` is empty, the source is all-transparent (used for the "Original"
/// history row).
///
/// The reconstructed source texture is always the same dimensions as the
/// active layer texture, with the snapshot's cropped content placed at its
/// local (crop_x, crop_y) offset. Content outside the current layer bounds
/// is clipped; content inside bounds not covered by the snapshot is
/// transparent.
pub fn begin(engine: &mut EngineInner, layer_id: &str, blob: &[u8]) -> Result<(), String> {
    // Release any prior session texture
    if let Some(tex) = engine.history_brush_source.take() {
        engine.texture_pool.release(tex);
    }
    engine.history_brush_layer_id = None;

    let tex_handle = engine
        .layer_textures
        .get(layer_id)
        .copied()
        .ok_or("History Brush: active layer has no texture")?;
    let (lw, lh) = engine
        .texture_pool
        .get_size(tex_handle)
        .ok_or("History Brush: cannot read layer dims")?;

    let new_tex = engine.texture_pool.acquire(&engine.gl, lw, lh)?;

    if !blob.is_empty() {
        let (crop_x, crop_y, crop_w, crop_h, _full_w, _full_h) =
            parse_header(blob).ok_or("History Brush: malformed snapshot header")?;
        if crop_w > 0 && crop_h > 0 {
            let pixel_start = 24usize;
            let expected = (crop_w as usize) * (crop_h as usize) * 4;
            if blob.len() >= pixel_start + expected {
                // Clip the cropped rect against the current layer texture bounds.
                let cx0 = crop_x.max(0);
                let cy0 = crop_y.max(0);
                let cx1 = (crop_x + crop_w).min(lw as i32);
                let cy1 = (crop_y + crop_h).min(lh as i32);
                if cx1 > cx0 && cy1 > cy0 {
                    let clipped_w = (cx1 - cx0) as usize;
                    let clipped_h = (cy1 - cy0) as usize;
                    let src_row_stride = (crop_w as usize) * 4;
                    let src_x0 = (cx0 - crop_x) as usize;
                    let src_y0 = (cy0 - crop_y) as usize;

                    let mut clipped = vec![0u8; clipped_w * clipped_h * 4];
                    for row in 0..clipped_h {
                        let src_off =
                            pixel_start + (src_y0 + row) * src_row_stride + src_x0 * 4;
                        let dst_off = row * clipped_w * 4;
                        clipped[dst_off..dst_off + clipped_w * 4]
                            .copy_from_slice(&blob[src_off..src_off + clipped_w * 4]);
                    }

                    engine.texture_pool.upload_rgba(
                        &engine.gl,
                        new_tex,
                        cx0,
                        cy0,
                        clipped_w as u32,
                        clipped_h as u32,
                        &clipped,
                    )?;
                }
            }
        }
    }

    engine.history_brush_source = Some(new_tex);
    engine.history_brush_layer_id = Some(layer_id.to_string());
    Ok(())
}

/// Release the History Brush session texture.
pub fn end(engine: &mut EngineInner) {
    if let Some(tex) = engine.history_brush_source.take() {
        engine.texture_pool.release(tex);
    }
    engine.history_brush_layer_id = None;
}

/// Apply a batch of History Brush dabs. Paints historical pixels from the
/// pre-bound source texture onto the active layer via a per-dab blend pass
/// into scratch-A, then blits back to the layer (same pattern as clone stamp).
pub fn apply_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
) {
    if points.len() < 2 {
        return;
    }
    // Session must be active for this layer.
    if engine.history_brush_layer_id.as_deref() != Some(layer_id) {
        return;
    }
    let source_handle = match engine.history_brush_source {
        Some(h) => h,
        None => return,
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
    let source_tex = match engine.texture_pool.get(source_handle) {
        Some(t) => t.clone(),
        None => return,
    };

    let prog = &engine.shaders.history_brush_dab.program;

    // Layer offset for selection-mask doc-space mapping
    let (layer_x, layer_y) = engine
        .layer_stack
        .iter()
        .find(|l| l.id == layer_id)
        .map(|l| (l.x as f32, l.y as f32))
        .unwrap_or((0.0, 0.0));
    let doc_w = engine.doc_width.max(1) as f32;
    let doc_h = engine.doc_height.max(1) as f32;

    for chunk in points.chunks(2) {
        if chunk.len() < 2 {
            break;
        }

        engine.fbo_pool.bind(gl, engine.scratch_fbo_a);
        gl.viewport(0, 0, w as i32, h as i32);

        gl.use_program(Some(prog));

        gl.active_texture(WebGl2RenderingContext::TEXTURE0);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&layer_tex));
        if let Some(loc) = gl.get_uniform_location(prog, "u_existingTex") {
            gl.uniform1i(Some(&loc), 0);
        }

        gl.active_texture(WebGl2RenderingContext::TEXTURE1);
        gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&source_tex));
        if let Some(loc) = gl.get_uniform_location(prog, "u_historyTex") {
            gl.uniform1i(Some(&loc), 1);
        }

        // Selection mask binding — optional
        let has_selection = engine.selection_mask_texture.is_some();
        if let Some(sel_handle) = engine.selection_mask_texture {
            if let Some(sel_tex) = engine.texture_pool.get(sel_handle) {
                gl.active_texture(WebGl2RenderingContext::TEXTURE2);
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(sel_tex));
                if let Some(loc) = gl.get_uniform_location(prog, "u_selectionMask") {
                    gl.uniform1i(Some(&loc), 2);
                }
            }
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_hasSelection") {
            gl.uniform1i(Some(&loc), if has_selection { 1 } else { 0 });
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_layerOffset") {
            gl.uniform2f(Some(&loc), layer_x, layer_y);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_docSize") {
            gl.uniform2f(Some(&loc), doc_w, doc_h);
        }

        if let Some(loc) = gl.get_uniform_location(prog, "u_center") {
            gl.uniform2f(Some(&loc), chunk[0] as f32, chunk[1] as f32);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_size") {
            gl.uniform1f(Some(&loc), size);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_hardness") {
            gl.uniform1f(Some(&loc), hardness);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_opacity") {
            gl.uniform1f(Some(&loc), opacity);
        }
        if let Some(loc) = gl.get_uniform_location(prog, "u_texSize") {
            gl.uniform2f(Some(&loc), w as f32, h as f32);
        }

        engine.draw_fullscreen_quad();

        // Blit scratch A back to the layer texture so subsequent dabs see it.
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
