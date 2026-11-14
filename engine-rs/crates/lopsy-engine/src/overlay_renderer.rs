use crate::engine::EngineInner;

/// Overlay state stored in EngineInner. Rendering handled in compositor.
/// This module provides state management helpers.

pub fn set_transform_overlay(engine: &mut EngineInner, bounds_json: Option<String>) {
    engine.overlays.transform_overlay = bounds_json;
    engine.needs_recomposite = true;
}

pub fn set_gradient_guide(engine: &mut EngineInner, sx: f64, sy: f64, ex: f64, ey: f64) {
    engine.overlays.gradient_guide = Some([sx, sy, ex, ey]);
    engine.needs_recomposite = true;
}

pub fn clear_gradient_guide(engine: &mut EngineInner) {
    engine.overlays.gradient_guide = None;
    engine.needs_recomposite = true;
}

pub fn set_path_overlay(engine: &mut EngineInner, anchors_json: Option<String>) {
    engine.overlays.path_overlay = anchors_json;
    engine.needs_recomposite = true;
}

pub fn set_lasso_preview(engine: &mut EngineInner, points: Option<Vec<f64>>) {
    engine.overlays.lasso_points = points;
    engine.needs_recomposite = true;
}

pub fn set_crop_preview(engine: &mut EngineInner, x: f64, y: f64, w: f64, h: f64) {
    engine.overlays.crop_rect = Some([x, y, w, h]);
    engine.needs_recomposite = true;
}

pub fn clear_crop_preview(engine: &mut EngineInner) {
    engine.overlays.crop_rect = None;
    engine.needs_recomposite = true;
}

pub fn set_brush_cursor(engine: &mut EngineInner, x: f64, y: f64, radius: f64) {
    engine.overlays.brush_cursor = Some([x, y, radius]);
    engine.needs_recomposite = true;
}

pub fn clear_brush_cursor(engine: &mut EngineInner) {
    engine.overlays.brush_cursor = None;
    engine.needs_recomposite = true;
}
