//! Selection API: upload/clear the GPU selection mask, and CPU-side
//! builders for rect/ellipse/polygon masks plus boolean combines, bounds,
//! contour tracing, and edge extraction.


use crate::engine::EngineInner;
use crate::{selection_gpu, quick_mask_gpu};

// ============================================================
// Selection
// ============================================================

pub fn set_selection_mask(
    engine: &mut EngineInner, mask_data: &[u8], width: u32, height: u32,
) {
    selection_gpu::set_selection_mask(&mut *engine, mask_data, width, height);
}

pub fn feather_selection_mask(engine: &mut EngineInner, radius: u32) {
    selection_gpu::feather_selection_mask(&mut *engine, radius);
}

pub fn read_selection_mask(engine: &EngineInner) -> Vec<u8> {
    let (w, h, mask) = selection_gpu::read_selection_mask(&*engine);
    if mask.is_empty() { return Vec::new(); }
    let mut result = Vec::with_capacity(8 + mask.len());
    result.extend_from_slice(&w.to_le_bytes());
    result.extend_from_slice(&h.to_le_bytes());
    result.extend_from_slice(&mask);
    result
}

pub fn clear_selection(engine: &mut EngineInner) {
    if let Some(tex) = engine.selection_mask_texture.take() {
        engine.texture_pool.release(tex);
    }
    engine.needs_recomposite = true;
}

pub fn create_rect_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    lopsy_core::selection::create_rect_selection(width, height, x, y, w, h)
}

pub fn create_ellipse_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    lopsy_core::selection::create_ellipse_selection(width, height, x, y, w, h)
}

pub fn invert_selection(mask: &[u8]) -> Vec<u8> {
    lopsy_core::selection::invert_selection(mask)
}

pub fn combine_selections(a: &[u8], b: &[u8], mode: u32) -> Vec<u8> {
    lopsy_core::selection::combine_selections(a, b, mode)
}

pub fn selection_bounds(mask: &[u8], width: u32, height: u32) -> Vec<i32> {
    match lopsy_core::selection::selection_bounds(mask, width, height) {
        Some(r) => vec![r.x, r.y, r.width as i32, r.height as i32],
        None => Vec::new(),
    }
}

pub fn is_empty_selection(mask: &[u8]) -> bool {
    lopsy_core::selection::is_empty_selection(mask)
}

pub fn trace_selection_contours(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    lopsy_core::selection::trace_selection_contours(mask, width, height)
}

pub fn get_selection_edges(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    lopsy_core::selection::get_selection_edges(mask, width, height)
}

pub fn create_polygon_mask(points_flat: &[f64], width: u32, height: u32) -> Vec<u8> {
    lopsy_core::selection::create_polygon_mask(points_flat, width, height)
}

// ============================================================
// Quick Mask
// ============================================================

pub fn enter_quick_mask_mode(engine: &mut EngineInner) {
    quick_mask_gpu::enter_quick_mask_mode(&mut *engine);
}

pub fn exit_quick_mask_mode(engine: &mut EngineInner) -> Option<Vec<u8>> {
    quick_mask_gpu::exit_quick_mask_mode(&mut *engine)
}

pub fn paint_quick_mask_dab(
    engine: &mut EngineInner,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    quick_mask_gpu::paint_quick_mask_dab(&mut *engine, cx, cy, size, hardness, opacity, mode);
}

pub fn paint_quick_mask_dab_batch(
    engine: &mut EngineInner,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    quick_mask_gpu::paint_quick_mask_dab_batch(&mut *engine, points, size, hardness, opacity, mode);
}

pub fn draw_quick_mask_pencil_line(
    engine: &mut EngineInner,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    size: f32,
    mode: u32,
) {
    quick_mask_gpu::draw_quick_mask_pencil_line(&mut *engine, x0, y0, x1, y1, r, g, b, a, size, mode);
}

pub fn fill_quick_mask(
    engine: &mut EngineInner,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    quick_mask_gpu::fill_quick_mask(&mut *engine, start_x, start_y, tolerance, contiguous, mode);
}

pub fn render_quick_mask_linear_gradient(
    engine: &mut EngineInner,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    quick_mask_gpu::render_quick_mask_linear_gradient(
        &mut *engine, start_x, start_y, end_x, end_y, stops_json,
    );
}

pub fn render_quick_mask_radial_gradient(
    engine: &mut EngineInner,
    cx: f64,
    cy: f64,
    radius: f64,
    stops_json: &str,
) {
    quick_mask_gpu::render_quick_mask_radial_gradient(
        &mut *engine, cx, cy, radius, stops_json,
    );
}

/// Read the quick-mask texture as single-channel grayscale pixels.
///
/// Returns an empty buffer when no quick-mask texture exists. Otherwise the
/// layout is `[width_i32_le, height_i32_le, ...mask_bytes]` (8-byte header +
/// `width * height` grayscale bytes). Used by the move tool to snapshot the
/// quick mask at drag-start so subsequent move events can translate the
/// painted content with the marquee (#315).
pub fn read_quick_mask_pixels(engine: &EngineInner) -> Vec<u8> {
    let (w, h, mask) = quick_mask_gpu::read_quick_mask_pixels(&*engine);
    if mask.is_empty() { return Vec::new(); }
    let mut result = Vec::with_capacity(8 + mask.len());
    result.extend_from_slice(&(w as i32).to_le_bytes());
    result.extend_from_slice(&(h as i32).to_le_bytes());
    result.extend_from_slice(&mask);
    result
}

/// Upload single-channel grayscale pixels back into the quick-mask texture.
/// No-op when no quick-mask texture exists or when dimensions don't match.
pub fn upload_quick_mask_pixels(
    engine: &mut EngineInner,
    data: &[u8],
    width: u32,
    height: u32,
) {
    quick_mask_gpu::upload_quick_mask_pixels(&mut *engine, data, width, height);
}


/// Snapshot the quick mask and the selection mask on the GPU so a quick-mask
/// marquee move can redraw each frame without a readback (#1482). Returns
/// false when there is nothing to move.
pub fn begin_quick_mask_move(engine: &mut EngineInner) -> bool {
    quick_mask_gpu::begin_quick_mask_move(&mut *engine)
}

/// Redraw the quick mask with the marquee's content moved by (dx, dy) from
/// where it was at `beginQuickMaskMove`.
pub fn translate_quick_mask(engine: &mut EngineInner, dx: i32, dy: i32) {
    quick_mask_gpu::translate_quick_mask(&mut *engine, dx, dy);
}

pub fn end_quick_mask_move(engine: &mut EngineInner) {
    quick_mask_gpu::end_quick_mask_move(&mut *engine);
}
