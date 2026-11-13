//! wasm-bindgen exports for `commands::selection`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "setSelectionMask")]
pub fn set_selection_mask(engine: &mut Engine, mask_data: &[u8], width: u32, height: u32) {
    crate::commands::selection::set_selection_mask(&mut engine.inner, mask_data, width, height)
}

#[wasm_bindgen(js_name = "featherSelectionMask")]
pub fn feather_selection_mask(engine: &mut Engine, radius: u32) {
    crate::commands::selection::feather_selection_mask(&mut engine.inner, radius)
}

#[wasm_bindgen(js_name = "readSelectionMask")]
pub fn read_selection_mask(engine: &Engine) -> Vec<u8> {
    crate::commands::selection::read_selection_mask(&engine.inner)
}

#[wasm_bindgen(js_name = "clearSelection")]
pub fn clear_selection(engine: &mut Engine) {
    crate::commands::selection::clear_selection(&mut engine.inner)
}

#[wasm_bindgen(js_name = "createRectSelection")]
pub fn create_rect_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    crate::commands::selection::create_rect_selection(width, height, x, y, w, h)
}

#[wasm_bindgen(js_name = "createEllipseSelection")]
pub fn create_ellipse_selection(width: u32, height: u32, x: i32, y: i32, w: u32, h: u32) -> Vec<u8> {
    crate::commands::selection::create_ellipse_selection(width, height, x, y, w, h)
}

#[wasm_bindgen(js_name = "invertSelection")]
pub fn invert_selection(mask: &[u8]) -> Vec<u8> {
    crate::commands::selection::invert_selection(mask)
}

#[wasm_bindgen(js_name = "combineSelections")]
pub fn combine_selections(a: &[u8], b: &[u8], mode: u32) -> Vec<u8> {
    crate::commands::selection::combine_selections(a, b, mode)
}

#[wasm_bindgen(js_name = "selectionBounds")]
pub fn selection_bounds(mask: &[u8], width: u32, height: u32) -> Vec<i32> {
    crate::commands::selection::selection_bounds(mask, width, height)
}

#[wasm_bindgen(js_name = "isEmptySelection")]
pub fn is_empty_selection(mask: &[u8]) -> bool {
    crate::commands::selection::is_empty_selection(mask)
}

#[wasm_bindgen(js_name = "traceSelectionContours")]
pub fn trace_selection_contours(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    crate::commands::selection::trace_selection_contours(mask, width, height)
}

#[wasm_bindgen(js_name = "getSelectionEdges")]
pub fn get_selection_edges(mask: &[u8], width: u32, height: u32) -> Vec<f64> {
    crate::commands::selection::get_selection_edges(mask, width, height)
}

#[wasm_bindgen(js_name = "createPolygonMask")]
pub fn create_polygon_mask(points_flat: &[f64], width: u32, height: u32) -> Vec<u8> {
    crate::commands::selection::create_polygon_mask(points_flat, width, height)
}

#[wasm_bindgen(js_name = "enterQuickMaskMode")]
pub fn enter_quick_mask_mode(engine: &mut Engine) {
    crate::commands::selection::enter_quick_mask_mode(&mut engine.inner)
}

#[wasm_bindgen(js_name = "exitQuickMaskMode")]
pub fn exit_quick_mask_mode(engine: &mut Engine) -> Option<Vec<u8>> {
    crate::commands::selection::exit_quick_mask_mode(&mut engine.inner)
}

#[wasm_bindgen(js_name = "paintQuickMaskDab")]
pub fn paint_quick_mask_dab(
    engine: &mut Engine,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    crate::commands::selection::paint_quick_mask_dab(&mut engine.inner, cx, cy, size, hardness, opacity, mode)
}

#[wasm_bindgen(js_name = "paintQuickMaskDabBatch")]
pub fn paint_quick_mask_dab_batch(
    engine: &mut Engine,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    crate::commands::selection::paint_quick_mask_dab_batch(&mut engine.inner, points, size, hardness, opacity, mode)
}

#[wasm_bindgen(js_name = "drawQuickMaskPencilLine")]
pub fn draw_quick_mask_pencil_line(
    engine: &mut Engine,
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
    crate::commands::selection::draw_quick_mask_pencil_line(&mut engine.inner, x0, y0, x1, y1, r, g, b, a, size, mode)
}

#[wasm_bindgen(js_name = "fillQuickMask")]
pub fn fill_quick_mask(
    engine: &mut Engine,
    start_x: u32,
    start_y: u32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    crate::commands::selection::fill_quick_mask(&mut engine.inner, start_x, start_y, tolerance, contiguous, mode)
}

#[wasm_bindgen(js_name = "renderQuickMaskLinearGradient")]
pub fn render_quick_mask_linear_gradient(
    engine: &mut Engine,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    crate::commands::selection::render_quick_mask_linear_gradient(&mut engine.inner, start_x, start_y, end_x, end_y, stops_json)
}

#[wasm_bindgen(js_name = "renderQuickMaskRadialGradient")]
pub fn render_quick_mask_radial_gradient(engine: &mut Engine, cx: f64, cy: f64, radius: f64, stops_json: &str) {
    crate::commands::selection::render_quick_mask_radial_gradient(&mut engine.inner, cx, cy, radius, stops_json)
}

#[wasm_bindgen(js_name = "readQuickMaskPixels")]
pub fn read_quick_mask_pixels(engine: &Engine) -> Vec<u8> {
    crate::commands::selection::read_quick_mask_pixels(&engine.inner)
}

#[wasm_bindgen(js_name = "uploadQuickMaskPixels")]
pub fn upload_quick_mask_pixels(engine: &mut Engine, data: &[u8], width: u32, height: u32) {
    crate::commands::selection::upload_quick_mask_pixels(&mut engine.inner, data, width, height)
}

#[wasm_bindgen(js_name = "beginQuickMaskMove")]
pub fn begin_quick_mask_move(engine: &mut Engine) -> bool {
    crate::commands::selection::begin_quick_mask_move(&mut engine.inner)
}

#[wasm_bindgen(js_name = "translateQuickMask")]
pub fn translate_quick_mask(engine: &mut Engine, dx: i32, dy: i32) {
    crate::commands::selection::translate_quick_mask(&mut engine.inner, dx, dy)
}

#[wasm_bindgen(js_name = "endQuickMaskMove")]
pub fn end_quick_mask_move(engine: &mut Engine) {
    crate::commands::selection::end_quick_mask_move(&mut engine.inner)
}
