use lopsy_core::geometry::Rect;
use crate::compositor::mask_doc_origin;
use crate::dab_pass_gpu::scratch_dab_pass;
use crate::engine::EngineInner;
use crate::gpu::pass::{Blend, Target};
use crate::gradient_gpu::{copy_to_scratch_a, gradient_pass, GradientShape};

// Every layer-mask writer here takes DOCUMENT-space coordinates and maps
// them into mask texels with `mask_doc_origin` — the same origin the
// compositor samples the mask at — so painting always lands where the
// mask is displayed, however the layer's own x/y has been re-origined by
// crop/expand/prewarm (#907).

pub fn paint_mask_dab(
    engine: &mut EngineInner,
    layer_id: &str,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    paint_mask_dab_batch(engine, layer_id, &[cx, cy], size, hardness, opacity, mode);
}

pub fn paint_mask_dab_batch(
    engine: &mut EngineInner,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let origin = mask_doc_origin(engine, layer_id);
    let dab = MaskDab { size, hardness, opacity, mode };
    paint_mask_dabs_scissored(engine, tex_handle, points, origin, dab);
    engine.mark_layer_dirty(layer_id);
}

#[derive(Clone, Copy)]
pub(crate) struct MaskDab {
    pub size: f32,
    pub hardness: f32,
    pub opacity: f32,
    pub mode: u32,
}

/// Paint round `quick_mask_dab` dabs into a mask-style RGBA texture.
/// `points` are (x, y) pairs; `origin` is subtracted to get texel
/// coordinates. Shared by layer masks and the Quick Mask.
///
/// The dab shader reads the mask it modifies, so each dab renders into
/// scratch and is copied back. Both passes are scissored to the dab's
/// bounding box (#1020): the shader passes every texel outside the
/// radius through unchanged, so the rect-limited result is identical to
/// rendering the whole texture — which cost two full-texture passes per
/// dab (~60 s of queued GPU work for one stroke on a 4096² mask). Texels
/// of scratch outside the rect are stale but never copied back.
pub(crate) fn paint_mask_dabs_scissored(
    engine: &mut EngineInner,
    tex_handle: crate::gpu::texture_pool::TextureHandle,
    points: &[f64],
    origin: (f32, f32),
    dab: MaskDab,
) {
    let Some((w, h)) = engine.texture_pool.get_size(tex_handle) else { return };
    if engine.texture_pool.get(tex_handle).is_none() { return; }
    // The copy-back samples scratch by v_uv, so scratch must match the mask exactly.
    if engine.ensure_scratch_size(w, h).is_err() { return; }
    if engine.texture_pool.get(engine.scratch_texture_a).is_none() { return; }
    let (ox, oy) = origin;

    for chunk in points.chunks_exact(2) {
        let cx = chunk[0] as f32 - ox;
        let cy = chunk[1] as f32 - oy;
        let Some([x, y, rw, rh]) =
            lopsy_core::brush::circle_dab_scissor_rect(cx, cy, dab.size, w, h) else { continue };

        scratch_dab_pass(
            engine,
            tex_handle,
            w,
            h,
            Rect::new(x, y, rw as u32, rh as u32),
            engine.pass(&engine.shaders.quick_mask_dab)
                .texture("u_maskTex", tex_handle)
                .f32("u_size", dab.size)
                .f32("u_hardness", dab.hardness)
                .f32("u_opacity", dab.opacity)
                .vec2("u_texSize", w as f32, h as f32)
                .i32("u_mode", dab.mode as i32)
                .vec2("u_center", cx, cy),
        );
    }
}

/// Render hard square pencil blocks into a mask-style RGBA texture
/// entirely on the GPU: one scissored draw per interpolated point with
/// the shared `pencil_dab` shader. Replaces the old CPU path that issued
/// a texSubImage2D upload per point, which made mask pencil strokes on
/// large documents unusably slow. `value` is the mask value to write
/// (1.0 = reveal/select, 0.0 = hide/deselect); the pixel geometry is
/// identical to the layer pencil (`brush_gpu::draw_pencil_line`).
pub(crate) fn draw_pencil_blocks_gpu(
    engine: &mut EngineInner,
    tex_handle: crate::gpu::texture_pool::TextureHandle,
    x0: f64, y0: f64, x1: f64, y1: f64,
    size: f32,
    value: f32,
) {
    if size <= 0.0 { return; }
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() { return; }

    let points = lopsy_core::brush::interpolate_points(x0, y0, x1, y1, 1.0);
    if points.len() < 2 { return; }

    let half = (size / 2.0).floor() as i32;
    let block = size.ceil() as i32;
    let tex_w_i = w as i32;
    let tex_h_i = h as i32;

    let pass = engine.pass(&engine.shaders.pencil_dab)
        .vec4("u_color", value, value, value, 1.0)
        .f32("u_size", size)
        .vec2("u_texSize", w as f32, h as f32)
        // Mask painting writes the mask itself — never clipped by selection.
        .i32("u_hasSelection", 0)
        .blend(Blend::Off);
    let Some(mut blocks) = pass.begin(Target::Texture(tex_handle)) else { return };
    let center = blocks.slot("u_center");
    for chunk in points.chunks(2) {
        if chunk.len() < 2 { break; }
        let cx = chunk[0] as f32;
        let cy = chunk[1] as f32;

        let lo_x = (cx.floor() as i32 - half).max(0);
        let lo_y = (cy.floor() as i32 - half).max(0);
        let hi_x = (cx.floor() as i32 - half + block).min(tex_w_i);
        let hi_y = (cy.floor() as i32 - half + block).min(tex_h_i);
        if hi_x <= lo_x || hi_y <= lo_y { continue; }

        blocks.set_vec2(&center, cx, cy);
        blocks.draw_in(Rect::new(lo_x, lo_y, (hi_x - lo_x) as u32, (hi_y - lo_y) as u32));
    }
    blocks.end();
}

pub fn draw_mask_pencil_line(
    engine: &mut EngineInner,
    layer_id: &str,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    a: f32,
    size: f32,
    mode: u32,
) {
    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let value = if mode == 0 { a } else { 0.0 };
    let (ox, oy) = mask_doc_origin(engine, layer_id);
    let (ox, oy) = (ox as f64, oy as f64);
    draw_pencil_blocks_gpu(engine, tex_handle, x0 - ox, y0 - oy, x1 - ox, y1 - oy, size, value);
    engine.mark_layer_dirty(layer_id);
}

pub fn fill_mask(
    engine: &mut EngineInner,
    layer_id: &str,
    doc_x: i32,
    doc_y: i32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    let (ox, oy) = mask_doc_origin(engine, layer_id);
    let local_x = doc_x - ox.round() as i32;
    let local_y = doc_y - oy.round() as i32;
    if local_x < 0 || local_y < 0 || local_x >= w as i32 || local_y >= h as i32 { return; }
    let (start_x, start_y) = (local_x as u32, local_y as u32);

    let Ok(rgba) = engine.gpu().read_rgba(tex_handle, 0, 0, w, h) else { return };

    let mut mask = vec![0u8; (w * h) as usize];
    for i in 0..(w * h) as usize {
        mask[i] = rgba[i * 4];
    }

    if start_x >= w || start_y >= h { return; }
    let seed_idx = start_y as usize * w as usize + start_x as usize;
    let seed_val = mask[seed_idx];
    let fill_val: u8 = if mode == 0 { 255 } else { 0 };
    let tol = tolerance as i32;

    if contiguous {
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
                stack.push((px + 1, py));
                stack.push((px - 1, py));
                stack.push((px, py + 1));
                stack.push((px, py - 1));
            }
        }
    } else {
        for i in 0..mask.len() {
            if (mask[i] as i32 - seed_val as i32).abs() <= tol {
                mask[i] = fill_val;
            }
        }
    }

    let mut rgba_out = vec![0u8; (w * h * 4) as usize];
    for i in 0..(w * h) as usize {
        let v = mask[i];
        rgba_out[i * 4] = v;
        rgba_out[i * 4 + 1] = v;
        rgba_out[i * 4 + 2] = v;
        rgba_out[i * 4 + 3] = 255;
    }
    let _ = engine.texture_pool.upload_rgba(&engine.gl, tex_handle, 0, 0, w, h, &rgba_out);
    engine.mark_layer_dirty(layer_id);
}

pub fn render_mask_linear_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    let stops: Vec<crate::gradient_gpu::GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    let (layer_x, layer_y) = mask_doc_origin(engine, layer_id);
    // Copies the mask into scratch at the mask's size and samples it back
    // by v_uv, so scratch must match the mask exactly.
    if engine.ensure_scratch_size(w, h).is_err() { return; }

    copy_to_scratch_a(engine, tex_handle, w, h);

    let shape = GradientShape::Linear {
        start: (start_x as f32 - layer_x, start_y as f32 - layer_y),
        end: (end_x as f32 - layer_x, end_y as f32 - layer_y),
    };
    gradient_pass(engine, &shape, &stops, engine.scratch_texture_a, w, h, (layer_x, layer_y))
        .i32("u_hasMask", 0)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(tex_handle));

    engine.mark_layer_dirty(layer_id);
}

pub fn render_mask_radial_gradient(
    engine: &mut EngineInner,
    layer_id: &str,
    center_x: f64,
    center_y: f64,
    radius: f64,
    stops_json: &str,
) {
    let stops: Vec<crate::gradient_gpu::GradientStop> = match serde_json::from_str(stops_json) {
        Ok(s) => s,
        Err(_) => return,
    };

    let Some(&tex_handle) = engine.layer_masks.get(layer_id) else { return };
    let (w, h) = engine.texture_pool.get_size(tex_handle).unwrap_or((1, 1));
    if engine.texture_pool.get(tex_handle).is_none() {
        return;
    }

    let (layer_x, layer_y) = mask_doc_origin(engine, layer_id);
    // Copies the mask into scratch at the mask's size and samples it back
    // by v_uv, so scratch must match the mask exactly.
    if engine.ensure_scratch_size(w, h).is_err() { return; }

    copy_to_scratch_a(engine, tex_handle, w, h);

    let shape = GradientShape::Radial {
        center: (center_x as f32 - layer_x, center_y as f32 - layer_y),
        radius: radius as f32,
    };
    gradient_pass(engine, &shape, &stops, engine.scratch_texture_a, w, h, (layer_x, layer_y))
        .i32("u_hasMask", 0)
        .viewport(0, 0, w as i32, h as i32)
        .draw(Target::Texture(tex_handle));

    engine.mark_layer_dirty(layer_id);
}

pub fn read_mask_texture(engine: &mut EngineInner, layer_id: &str) -> Option<Vec<u8>> {
    let &handle = engine.layer_masks.get(layer_id)?;
    let (w, h) = engine.texture_pool.get_size(handle)?;
    engine.texture_pool.get(handle)?;

    // R8 staging: 1 byte per pixel back over the bridge instead of 4,
    // and no CPU-side strided extract. See #745 — the RGBA path stalled
    // ~26 s per stroke on a 4K mask (60× worse than linear per pixel,
    // driven by the 16 M-iteration cache-hostile CPU loop).
    engine.read_texture_r8(handle, w, h)
}
