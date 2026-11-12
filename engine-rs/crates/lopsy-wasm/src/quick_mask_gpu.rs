use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Target};
use crate::gpu::texture_pool::TextureHandle;
use crate::gradient_gpu::{copy_to_scratch_a, gradient_pass, GradientShape, GradientStop};

/// Flood-fill the quick mask texture. Reads the mask from the GPU, runs a
/// region-fill based on mask-value tolerance, and writes the result back.
///
/// `mode` 0 = brush (fill matched region to white/selected),
///        1 = eraser (fill matched region to black/unselected).
pub fn fill_quick_mask(
    engine: &mut EngineInner,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));

    // Read mask texture as RGBA
    if engine.texture_pool.get(tex_handle).is_none() { return; }
    let Ok(rgba) = engine.gpu().read_rgba(tex_handle, 0, 0, w, h) else { return };

    // Extract grayscale from RGBA
    let mut mask = vec![0u8; (w * h) as usize];
    for i in 0..(w * h) as usize {
        mask[i] = rgba[i * 4];
    }

    // Get seed value
    if start_x >= w || start_y >= h { return; }
    let seed_idx = start_y as usize * w as usize + start_x as usize;
    let seed_val = mask[seed_idx];

    // Flood fill: find all pixels within tolerance of the seed
    let fill_val: u8 = if mode == 0 { 255 } else { 0 };
    let tol = tolerance as i32;

    if contiguous {
        // Flood fill from seed point
        let mut visited = vec![false; mask.len()];
        let mut stack = vec![(start_x as i32, start_y as i32)];
        while let Some((px, py)) = stack.pop() {
            if px < 0 || px >= w as i32 || py < 0 || py >= h as i32 { continue; }
            let idx = py as usize * w as usize + px as usize;
            if visited[idx] { continue; }
            visited[idx] = true;
            let val = mask[idx] as i32;
            if (val - seed_val as i32).abs() <= tol {
                mask[idx] = fill_val;
                // 4-way neighbors
                stack.push((px + 1, py));
                stack.push((px - 1, py));
                stack.push((px, py + 1));
                stack.push((px, py - 1));
            }
        }
    } else {
        // Non-contiguous: fill all pixels within tolerance
        for i in 0..mask.len() {
            if (mask[i] as i32 - seed_val as i32).abs() <= tol {
                mask[i] = fill_val;
            }
        }
    }

    if let Err(e) = engine.expand_mask_bytes_into(tex_handle, &mask, w, h) {
        web_sys::console::warn_1(&format!("fill_quick_mask: {e}").into());
    }
    engine.needs_recomposite = true;
}

/// Enter quick mask mode: copy selection_mask_texture to quick_mask_texture
/// using a GPU-to-GPU blit.
pub fn enter_quick_mask_mode(engine: &mut EngineInner) {
    let Some(sel_handle) = engine.selection_mask_texture else {
        // No selection: create an empty (all-zero) quick mask texture
        let (w, h) = (engine.doc_width, engine.doc_height);
        if let Some(old) = engine.quick_mask_texture.take() {
            engine.texture_pool.release(old);
        }
        let tex = match engine.texture_pool.acquire(&engine.gl, w, h) {
            Ok(t) => t,
            Err(_) => return,
        };
        engine.texture_pool.set_nearest_filter(&engine.gl, tex);
        // Fully unselected, in the (v, v, v, 1) layout the mask samplers
        // expect. A clear: uploading a zero buffer went through the
        // 16-bytes-per-texel CPU path on every Q press (#1481).
        engine.gpu().clear(tex, [0.0, 0.0, 0.0, 1.0]);
        engine.quick_mask_texture = Some(tex);
        engine.needs_recomposite = true;
        return;
    };

    let (w, h) = engine.texture_pool.get_size(sel_handle).unwrap_or((engine.doc_width, engine.doc_height));

    // Release old quick mask texture
    if let Some(old) = engine.quick_mask_texture.take() {
        engine.texture_pool.release(old);
    }

    // Create new quick mask texture at selection mask size
    let tex = match engine.texture_pool.acquire(&engine.gl, w, h) {
        Ok(t) => t,
        Err(_) => return,
    };
    engine.texture_pool.set_nearest_filter(&engine.gl, tex);

    // GPU-to-GPU copy: blit selection mask to quick mask texture
    if engine.texture_pool.get(sel_handle).is_none() {
        engine.texture_pool.release(tex);
        return;
    }
    if engine.texture_pool.get(tex).is_none() {
        return;
    }

    engine.pass(&engine.shaders.blit)
        .texture("u_tex", sel_handle)
        .draw(Target::Texture(tex));

    engine.quick_mask_texture = Some(tex);
    engine.needs_recomposite = true;
}

/// Exit quick mask mode: read back the quick mask texture as single-channel
/// grayscale data. Returns the mask data so the TS side can convert it to
/// a selection.
pub fn exit_quick_mask_mode(engine: &mut EngineInner) -> Option<Vec<u8>> {
    end_quick_mask_move(engine);
    let handle = engine.quick_mask_texture.take()?;
    let (w, h) = engine.texture_pool.get_size(handle)?;

    // Read RGBA from the texture
    if engine.texture_pool.get(handle).is_none() {
        return None;
    }
    let rgba = engine.gpu().read_rgba(handle, 0, 0, w, h).ok();
    engine.texture_pool.release(handle);
    engine.needs_recomposite = true;

    // Extract single-channel from RGBA (R channel is the mask value)
    rgba.map(|data| {
        let mut single = vec![0u8; (w * h) as usize];
        for i in 0..(w * h) as usize {
            single[i] = data[i * 4];
        }
        single
    })
}

/// Read the quick mask texture as single-channel grayscale pixels.
/// Returns `(width, height, mask_bytes)` on success, or `(0, 0, vec![])`
/// when no quick mask texture is active.
pub fn read_quick_mask_pixels(engine: &EngineInner) -> (u32, u32, Vec<u8>) {
    let Some(handle) = engine.quick_mask_texture else { return (0, 0, Vec::new()) };
    let Some((w, h)) = engine.texture_pool.get_size(handle) else { return (0, 0, Vec::new()) };
    if engine.texture_pool.get(handle).is_none() { return (0, 0, Vec::new()); }

    // R8 staging: 1 byte per pixel back over the bridge instead of 4,
    // and no CPU-side strided extract (#745).
    match engine.read_texture_r8(handle, w, h) {
        Some(data) => (w, h, data),
        None => (0, 0, Vec::new()),
    }
}

/// Upload single-channel grayscale pixels into the quick mask texture as
/// (v, v, v, 1), through the R8 staging + GPU expand path (#1481).
/// No-op when no quick mask texture is active or when `data.len() != w * h`.
pub fn upload_quick_mask_pixels(
    engine: &mut EngineInner,
    data: &[u8],
    w: u32,
    h: u32,
) {
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    if data.len() != (w * h) as usize { return; }
    let (tex_w, tex_h) = match engine.texture_pool.get_size(tex_handle) {
        Some(s) => s,
        None => return,
    };
    if tex_w != w || tex_h != h { return; }
    if engine.texture_pool.get(tex_handle).is_none() { return; }
    if let Err(e) = engine.expand_mask_bytes_into(tex_handle, data, w, h) {
        web_sys::console::warn_1(&format!("upload_quick_mask_pixels: {e}").into());
        return;
    }
    engine.needs_recomposite = true;
}

fn copy_texture(engine: &mut EngineInner, src: TextureHandle) -> Option<TextureHandle> {
    let (w, h) = engine.texture_pool.get_size(src)?;
    engine.texture_pool.get(src)?;
    let dst = engine.texture_pool.acquire(&engine.gl, w, h).ok()?;
    if engine.texture_pool.get(dst).is_none() {
        engine.texture_pool.release(dst);
        return None;
    }
    engine.pass(&engine.shaders.blit)
        .texture("u_tex", src)
        .blend(Blend::Off)
        .draw(Target::Texture(dst));
    Some(dst)
}

/// Start moving the quick-mask content under the marquee: keep GPU copies
/// of the quick mask and the selection mask as they are now, so each frame
/// of the move is one GPU pass with no readback or upload (#1482). The
/// selection mask must already be on the GPU at its pre-move position.
/// Returns false when there is no quick mask or selection mask to move.
pub fn begin_quick_mask_move(engine: &mut EngineInner) -> bool {
    end_quick_mask_move(engine);
    let (Some(quick), Some(sel)) = (engine.quick_mask_texture, engine.selection_mask_texture) else {
        return false;
    };
    let Some(base) = copy_texture(engine, quick) else { return false };
    let Some(marquee) = copy_texture(engine, sel) else {
        engine.texture_pool.release(base);
        return false;
    };
    engine.quick_mask_move_base = Some(base);
    engine.quick_mask_move_marquee = Some(marquee);
    true
}

/// Rewrite the quick mask as the move's starting quick mask with the
/// marquee's content shifted by (dx, dy) document pixels. No-op outside a
/// move begun with `begin_quick_mask_move`.
pub fn translate_quick_mask(engine: &mut EngineInner, dx: i32, dy: i32) {
    let (Some(quick), Some(base), Some(marquee)) = (
        engine.quick_mask_texture,
        engine.quick_mask_move_base,
        engine.quick_mask_move_marquee,
    ) else {
        return;
    };
    let Some((w, h)) = engine.texture_pool.get_size(quick) else { return };
    if engine.texture_pool.get_size(base) != Some((w, h)) { return; }
    if engine.texture_pool.get(quick).is_none()
        || engine.texture_pool.get(base).is_none()
        || engine.texture_pool.get(marquee).is_none()
    {
        return;
    }
    engine.pass(&engine.shaders.quick_mask_translate)
        .texture("u_base", base)
        .texture("u_marquee", marquee)
        .ivec2("u_offset", dx, dy)
        .blend(Blend::Off)
        .draw(Target::Texture(quick));
    // Leave unit 0 active, with neither move copy still bound to a sampler.
    engine.gpu().unbind_textures(2);
    engine.needs_recomposite = true;
}

/// Release the copies a quick-mask move kept. Safe to call with no move active.
pub fn end_quick_mask_move(engine: &mut EngineInner) {
    if let Some(tex) = engine.quick_mask_move_base.take() {
        engine.texture_pool.release(tex);
    }
    if let Some(tex) = engine.quick_mask_move_marquee.take() {
        engine.texture_pool.release(tex);
    }
}

/// Paint a brush dab on the quick mask texture. Mode 0 = brush (add), 1 = eraser (remove).
pub fn paint_quick_mask_dab(
    engine: &mut EngineInner,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    paint_quick_mask_dab_batch(engine, &[cx, cy], size, hardness, opacity, mode);
}

/// Paint multiple dabs on the quick mask texture (doc space; the quick
/// mask covers the whole document). Scissored per dab — see
/// `mask_paint_gpu::paint_mask_dabs_scissored` (#1020).
pub fn paint_quick_mask_dab_batch(
    engine: &mut EngineInner,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let dab = crate::mask_paint_gpu::MaskDab { size, hardness, opacity, mode };
    crate::mask_paint_gpu::paint_mask_dabs_scissored(engine, tex_handle, points, (0.0, 0.0), dab);
    engine.needs_recomposite = true;
}

/// Draw a pencil line on the quick mask texture.
pub fn draw_quick_mask_pencil_line(
    engine: &mut EngineInner,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    _r: f32,
    _g: f32,
    _b: f32,
    a: f32,
    size: f32,
    mode: u32,
) {
    // Pencil renders hard square pixel blocks — same GPU path as the
    // layer-mask pencil (one scissored draw per point, no CPU uploads).
    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let value = if mode == 0 { a } else { 0.0 };
    crate::mask_paint_gpu::draw_pencil_blocks_gpu(engine, tex_handle, x0, y0, x1, y1, size, value);
    engine.needs_recomposite = true;
}

/// Render a linear gradient into the quick mask texture. Mirrors
/// `mask_paint_gpu::render_mask_linear_gradient` but targets
/// `engine.quick_mask_texture`. The quick mask texture covers the whole
/// document, so no per-layer offset is applied.
pub fn render_quick_mask_linear_gradient(
    engine: &mut EngineInner,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    copy_to_scratch_a(engine, tex_handle, w, h);

    let shape = GradientShape::Linear {
        start: (start_x as f32, start_y as f32),
        end: (end_x as f32, end_y as f32),
    };
    gradient_pass(engine, &shape, &stops, engine.scratch_texture_a, w, h, (0.0, 0.0))
        .i32("u_hasMask", 0)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(tex_handle));

    engine.needs_recomposite = true;
}

/// Render a radial gradient into the quick mask texture. Mirrors
/// `mask_paint_gpu::render_mask_radial_gradient` but targets
/// `engine.quick_mask_texture`.
pub fn render_quick_mask_radial_gradient(
    engine: &mut EngineInner,
    center_x: f64,
    center_y: f64,
    radius: f64,
    stops_json: &str,
) {
    let stops: Vec<GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(tex_handle) = engine.quick_mask_texture else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    copy_to_scratch_a(engine, tex_handle, w, h);

    let shape = GradientShape::Radial {
        center: (center_x as f32, center_y as f32),
        radius: radius as f32,
    };
    gradient_pass(engine, &shape, &stops, engine.scratch_texture_a, w, h, (0.0, 0.0))
        .i32("u_hasMask", 0)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(tex_handle));

    engine.needs_recomposite = true;
}
