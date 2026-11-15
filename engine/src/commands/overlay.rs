//! Viewport- and overlay-side UI state: grid, rulers, the path/lasso/crop
//! previews, gradient guide, brush cursor, and transform overlay.


use crate::engine::EngineInner;
use crate::{overlay_renderer, stamp_preview_gpu};
use crate::stamp_preview_gpu::StampPreview;

// ============================================================
// Tool UI Overlays
// ============================================================

pub fn set_grid_visible(engine: &mut EngineInner, visible: bool) {
    engine.overlays.grid_visible = visible;
    engine.needs_recomposite = true;
}

pub fn set_grid_size(engine: &mut EngineInner, size: f32) {
    engine.overlays.grid_size = size;
    engine.needs_recomposite = true;
}

pub fn set_transform_overlay(engine: &mut EngineInner, bounds_json: Option<String>) {
    overlay_renderer::set_transform_overlay(&mut *engine, bounds_json);
}

pub fn set_gradient_guide(
    engine: &mut EngineInner,
    start_x: f64, start_y: f64, end_x: f64, end_y: f64,
) {
    overlay_renderer::set_gradient_guide(&mut *engine, start_x, start_y, end_x, end_y);
}

pub fn clear_gradient_guide(engine: &mut EngineInner) {
    overlay_renderer::clear_gradient_guide(&mut *engine);
}

pub fn set_path_overlay(engine: &mut EngineInner, anchors_json: Option<String>) {
    overlay_renderer::set_path_overlay(&mut *engine, anchors_json);
}

pub fn set_lasso_preview(engine: &mut EngineInner, points_flat: Option<Vec<f64>>) {
    overlay_renderer::set_lasso_preview(&mut *engine, points_flat);
}

pub fn set_crop_preview(engine: &mut EngineInner, x: f64, y: f64, w: f64, h: f64) {
    overlay_renderer::set_crop_preview(&mut *engine, x, y, w, h);
}

pub fn clear_crop_preview(engine: &mut EngineInner) {
    overlay_renderer::clear_crop_preview(&mut *engine);
}

pub fn set_brush_cursor(engine: &mut EngineInner, x: f64, y: f64, radius: f64) {
    overlay_renderer::set_brush_cursor(&mut *engine, x, y, radius);
}

pub fn clear_brush_cursor(engine: &mut EngineInner) {
    overlay_renderer::clear_brush_cursor(&mut *engine);
}

/// Show the Clone Stamp / Healing Brush source preview: inside the disc of
/// `radius` document px at (`cursor_x`, `cursor_y`), `layer_id` as it is at
/// (`source_x`, `source_y`).
pub fn set_stamp_source_preview(
    engine: &mut EngineInner,
    layer_id: &str,
    cursor_x: f64,
    cursor_y: f64,
    source_x: f64,
    source_y: f64,
    radius: f64,
) {
    stamp_preview_gpu::set_stamp_preview(&mut *engine, Some(StampPreview {
        layer_id: layer_id.to_string(),
        cursor: (cursor_x, cursor_y),
        source: (source_x, source_y),
        radius,
    }));
}

pub fn clear_stamp_source_preview(engine: &mut EngineInner) {
    stamp_preview_gpu::set_stamp_preview(&mut *engine, None);
}

pub fn set_rulers_visible(engine: &mut EngineInner, visible: bool) {
    engine.overlays.rulers_visible = visible;
    engine.needs_recomposite = true;
}

pub fn set_seamless_pattern(engine: &mut EngineInner, enabled: bool, dim: bool, wrap: bool) {
    engine.overlays.seamless_pattern = enabled;
    engine.overlays.seamless_dim = dim;
    engine.overlays.seamless_wrap = wrap;
    engine.needs_recomposite = true;
}

pub fn set_channel_mask(engine: &mut EngineInner, r: f32, g: f32, b: f32, a: f32) {
    engine.overlays.channel_mask = [r, g, b, a];
    engine.needs_present = true;
}

