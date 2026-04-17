//! Selection API: upload/clear the GPU selection mask, and CPU-side
//! builders for rect/ellipse/polygon masks plus boolean combines, bounds,
//! contour tracing, and edge extraction.

use wasm_bindgen::prelude::*;

use crate::{Engine, selection_gpu};

// ============================================================
// Selection
// ============================================================

#[wasm_bindgen(js_name = "setSelectionMask")]
pub fn set_selection_mask(
    engine: &mut Engine, mask_data: &[u8], width: u32, height: u32,
) {
    selection_gpu::set_selection_mask(&mut engine.inner, mask_data, width, height);
}

#[wasm_bindgen(js_name = "clearSelection")]
pub fn clear_selection(engine: &mut Engine) {
    if let Some(tex) = engine.inner.selection_mask_texture.take() {
        engine.inner.texture_pool.release(tex);
    }
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "createRectSelection")]
pub fn create_rect_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    lopsy_core::selection::create_rect_selection(width, height, x, y, w, h)
}

#[wasm_bindgen(js_name = "createEllipseSelection")]
pub fn create_ellipse_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    lopsy_core::selection::create_ellipse_selection(width, height, x, y, w, h)
}

#[wasm_bindgen(js_name = "invertSelection")]
pub fn invert_selection(mask: &[u8]) -> Vec<u8> {
    lopsy_core::selection::invert_selection(mask)
}

#[wasm_bindgen(js_name = "combineSelections")]
pub fn combine_selections(a: &[u8], b: &[u8], mode: u32) -> Vec<u8> {
    lopsy_core::selection::combine_selections(a, b, mode)
}

#[wasm_bindgen(js_name = "selectionBounds")]
pub fn selection_bounds(mask: &[u8], width: u32, height: u32) -> Vec<i32> {
    match lopsy_core::selection::selection_bounds(mask, width, height) {
        Some(r) => vec![r.x, r.y, r.width as i32, r.height as i32],
        None => Vec::new(),
    }
}

#[wasm_bindgen(js_name = "isEmptySelection")]
pub fn is_empty_selection(mask: &[u8]) -> bool {
    lopsy_core::selection::is_empty_selection(mask)
}

#[wasm_bindgen(js_name = "traceSelectionContours")]
pub fn trace_selection_contours(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    lopsy_core::selection::trace_selection_contours(mask, width, height)
}

#[wasm_bindgen(js_name = "getSelectionEdges")]
pub fn get_selection_edges(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    lopsy_core::selection::get_selection_edges(mask, width, height)
}

#[wasm_bindgen(js_name = "createPolygonMask")]
pub fn create_polygon_mask(points_flat: &[f64], width: u32, height: u32) -> Vec<u8> {
    lopsy_core::selection::create_polygon_mask(points_flat, width, height)
}

