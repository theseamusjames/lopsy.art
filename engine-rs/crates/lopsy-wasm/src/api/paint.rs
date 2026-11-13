//! wasm-bindgen exports for `commands::paint`. Each converts its arguments
//! and calls the one function of the same name there.

use wasm_bindgen::prelude::*;

use crate::Engine;

#[wasm_bindgen(js_name = "beginStroke")]
pub fn begin_stroke(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    lopsy_engine::commands::paint::begin_stroke(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "prewarmStroke")]
pub fn prewarm_stroke(engine: &mut Engine, layer_id: &str) -> Result<(), JsError> {
    lopsy_engine::commands::paint::prewarm_stroke(&mut engine.inner, layer_id).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "compositePatchOntoLayer")]
pub fn composite_patch_onto_layer(
    engine: &mut Engine,
    layer_id: &str,
    data: &[u8],
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::paint::composite_patch_onto_layer(&mut engine.inner, layer_id, data, x, y, width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "applyBrushDab")]
pub fn apply_brush_dab(
    engine: &mut Engine,
    layer_id: &str,
    cx: f64,
    cy: f64,
    stamp_size: f32,
    hardness: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    opacity: f32,
    flow: f32,
    size_jitter: f32,
    angle_jitter: f32,
    opacity_jitter: f32,
) {
    lopsy_engine::commands::paint::apply_brush_dab(&mut engine.inner, layer_id, cx, cy, stamp_size, hardness, r, g, b, a, opacity, flow, size_jitter, angle_jitter, opacity_jitter)
}

#[wasm_bindgen(js_name = "applyBrushDabBatch")]
pub fn apply_brush_dab_batch(
    engine: &mut Engine,
    layer_id: &str,
    points: &[f64],
    stamp_size: f32,
    hardness: f32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    opacity: f32,
    flow: f32,
    size_jitter: f32,
    angle_jitter: f32,
    opacity_jitter: f32,
) {
    lopsy_engine::commands::paint::apply_brush_dab_batch(&mut engine.inner, layer_id, points, stamp_size, hardness, r, g, b, a, opacity, flow, size_jitter, angle_jitter, opacity_jitter)
}

#[wasm_bindgen(js_name = "applyEraserDab")]
pub fn apply_eraser_dab(
    engine: &mut Engine,
    layer_id: &str,
    cx: f64,
    cy: f64,
    stamp_size: f32,
    hardness: f32,
    opacity: f32,
) {
    lopsy_engine::commands::paint::apply_eraser_dab(&mut engine.inner, layer_id, cx, cy, stamp_size, hardness, opacity)
}

#[wasm_bindgen(js_name = "applyEraserDabBatch")]
pub fn apply_eraser_dab_batch(
    engine: &mut Engine,
    layer_id: &str,
    points: &[f64],
    stamp_size: f32,
    hardness: f32,
    opacity: f32,
) {
    lopsy_engine::commands::paint::apply_eraser_dab_batch(&mut engine.inner, layer_id, points, stamp_size, hardness, opacity)
}

#[wasm_bindgen(js_name = "drawPencilLine")]
pub fn draw_pencil_line(
    engine: &mut Engine,
    layer_id: &str,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    size: f32,
) {
    lopsy_engine::commands::paint::draw_pencil_line(&mut engine.inner, layer_id, x0, y0, x1, y1, r, g, b, a, size)
}

#[wasm_bindgen(js_name = "endStroke")]
pub fn end_stroke(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::paint::end_stroke(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "uploadBrushTip")]
pub fn upload_brush_tip(engine: &mut Engine, data: &[u8], width: u32, height: u32) -> Result<(), JsError> {
    lopsy_engine::commands::paint::upload_brush_tip(&mut engine.inner, data, width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "uploadBrushTipRGBA")]
pub fn upload_brush_tip_rgba(engine: &mut Engine, data: &[u8], width: u32, height: u32) -> Result<(), JsError> {
    lopsy_engine::commands::paint::upload_brush_tip_rgba(&mut engine.inner, data, width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearBrushTip")]
pub fn clear_brush_tip(engine: &mut Engine) {
    lopsy_engine::commands::paint::clear_brush_tip(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setBrushTipState")]
pub fn set_brush_tip_state(engine: &mut Engine, has_tip: bool, angle: f32, is_color: bool) {
    lopsy_engine::commands::paint::set_brush_tip_state(&mut engine.inner, has_tip, angle, is_color)
}

#[wasm_bindgen(js_name = "setBrushDabTransform")]
pub fn set_brush_dab_transform(engine: &mut Engine, m00: f32, m01: f32, m10: f32, m11: f32) {
    lopsy_engine::commands::paint::set_brush_dab_transform(&mut engine.inner, m00, m01, m10, m11)
}

#[wasm_bindgen(js_name = "cacheSubBrushTip")]
pub fn cache_sub_brush_tip(
    engine: &mut Engine,
    index: u32,
    data: &[u8],
    width: u32,
    height: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::paint::cache_sub_brush_tip(&mut engine.inner, index, data, width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "cacheSubBrushTipRGBA")]
pub fn cache_sub_brush_tip_rgba(
    engine: &mut Engine,
    index: u32,
    data: &[u8],
    width: u32,
    height: u32,
) -> Result<(), JsError> {
    lopsy_engine::commands::paint::cache_sub_brush_tip_rgba(&mut engine.inner, index, data, width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "activateSubBrushTip")]
pub fn activate_sub_brush_tip(engine: &mut Engine, index: u32, angle: f32, is_color: bool) {
    lopsy_engine::commands::paint::activate_sub_brush_tip(&mut engine.inner, index, angle, is_color)
}

#[wasm_bindgen(js_name = "deactivateSubBrushTip")]
pub fn deactivate_sub_brush_tip(engine: &mut Engine) {
    lopsy_engine::commands::paint::deactivate_sub_brush_tip(&mut engine.inner)
}

#[wasm_bindgen(js_name = "clearSubBrushTipCache")]
pub fn clear_sub_brush_tip_cache(engine: &mut Engine) {
    lopsy_engine::commands::paint::clear_sub_brush_tip_cache(&mut engine.inner)
}

#[wasm_bindgen(js_name = "uploadBrushTexture")]
pub fn upload_brush_texture(engine: &mut Engine, data: &[u8], width: u32, height: u32) -> Result<(), JsError> {
    lopsy_engine::commands::paint::upload_brush_texture(&mut engine.inner, data, width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "clearBrushTexture")]
pub fn clear_brush_texture(engine: &mut Engine) {
    lopsy_engine::commands::paint::clear_brush_texture(&mut engine.inner)
}

#[wasm_bindgen(js_name = "setBrushTextureState")]
pub fn set_brush_texture_state(engine: &mut Engine, has_texture: bool, scale: f32, blend_mode: u32) {
    lopsy_engine::commands::paint::set_brush_texture_state(&mut engine.inner, has_texture, scale, blend_mode)
}

#[wasm_bindgen(js_name = "getBuiltinBrushTip")]
pub fn get_builtin_brush_tip(name: &str) -> Option<Vec<u8>> {
    lopsy_engine::commands::paint::get_builtin_brush_tip(name)
}

#[wasm_bindgen(js_name = "listBuiltinBrushTips")]
pub fn list_builtin_brush_tips_js() -> String {
    lopsy_engine::commands::paint::list_builtin_brush_tips_js()
}

#[wasm_bindgen(js_name = "generateBrushStamp")]
pub fn generate_brush_stamp(size: u32, hardness: f32) -> Vec<f32> {
    lopsy_engine::commands::paint::generate_brush_stamp(size, hardness)
}

#[wasm_bindgen(js_name = "interpolatePoints")]
pub fn interpolate_points(from_x: f64, from_y: f64, to_x: f64, to_y: f64, spacing: f64) -> Vec<f64> {
    lopsy_engine::commands::paint::interpolate_points(from_x, from_y, to_x, to_y, spacing)
}

#[wasm_bindgen(js_name = "beginDodgeBurnStroke")]
pub fn begin_dodge_burn_stroke(engine: &mut Engine, layer_id: &str, mode: u32) -> Result<(), JsError> {
    lopsy_engine::commands::paint::begin_dodge_burn_stroke(&mut engine.inner, layer_id, mode).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "applyDodgeBurnDabBatch")]
pub fn apply_dodge_burn_dab_batch(
    engine: &mut Engine,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    exposure: f32,
) {
    lopsy_engine::commands::paint::apply_dodge_burn_dab_batch(&mut engine.inner, layer_id, points, size, hardness, exposure)
}

#[wasm_bindgen(js_name = "endDodgeBurnStroke")]
pub fn end_dodge_burn_stroke(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::paint::end_dodge_burn_stroke(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "beginSpongeStroke")]
pub fn begin_sponge_stroke(engine: &mut Engine, layer_id: &str, mode: u32) -> Result<(), JsError> {
    lopsy_engine::commands::paint::begin_sponge_stroke(&mut engine.inner, layer_id, mode).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "applySpongeDabBatch")]
pub fn apply_sponge_dab_batch(
    engine: &mut Engine,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    strength: f32,
) {
    lopsy_engine::commands::paint::apply_sponge_dab_batch(&mut engine.inner, layer_id, points, size, hardness, strength)
}

#[wasm_bindgen(js_name = "endSpongeStroke")]
pub fn end_sponge_stroke(engine: &mut Engine, layer_id: &str) {
    lopsy_engine::commands::paint::end_sponge_stroke(&mut engine.inner, layer_id)
}

#[wasm_bindgen(js_name = "applySmudgeDab")]
pub fn apply_smudge_dab(
    engine: &mut Engine,
    layer_id: &str,
    cx: f64,
    cy: f64,
    prev_x: f64,
    prev_y: f64,
    size: f32,
    strength: f32,
) {
    lopsy_engine::commands::paint::apply_smudge_dab(&mut engine.inner, layer_id, cx, cy, prev_x, prev_y, size, strength)
}

#[wasm_bindgen(js_name = "applySmudgeDabBatch")]
pub fn apply_smudge_dab_batch(engine: &mut Engine, layer_id: &str, points: &[f64], size: f32, strength: f32) {
    lopsy_engine::commands::paint::apply_smudge_dab_batch(&mut engine.inner, layer_id, points, size, strength)
}

#[wasm_bindgen(js_name = "applyStampDab")]
pub fn apply_stamp_dab(
    engine: &mut Engine,
    layer_id: &str,
    dest_x: f64,
    dest_y: f64,
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
) {
    lopsy_engine::commands::paint::apply_stamp_dab(&mut engine.inner, layer_id, dest_x, dest_y, source_offset_x, source_offset_y, size)
}

#[wasm_bindgen(js_name = "applyStampDabBatch")]
pub fn apply_stamp_dab_batch(
    engine: &mut Engine,
    layer_id: &str,
    points: &[f64],
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
) {
    lopsy_engine::commands::paint::apply_stamp_dab_batch(&mut engine.inner, layer_id, points, source_offset_x, source_offset_y, size)
}

#[wasm_bindgen(js_name = "applyHealingDab")]
pub fn apply_healing_dab(
    engine: &mut Engine,
    layer_id: &str,
    dest_x: f64,
    dest_y: f64,
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
    opacity: f32,
) {
    lopsy_engine::commands::paint::apply_healing_dab(&mut engine.inner, layer_id, dest_x, dest_y, source_offset_x, source_offset_y, size, opacity)
}

#[wasm_bindgen(js_name = "applyHealingDabBatch")]
pub fn apply_healing_dab_batch(
    engine: &mut Engine,
    layer_id: &str,
    points: &[f64],
    source_offset_x: f64,
    source_offset_y: f64,
    size: f32,
    opacity: f32,
) {
    lopsy_engine::commands::paint::apply_healing_dab_batch(&mut engine.inner, layer_id, points, source_offset_x, source_offset_y, size, opacity)
}

#[wasm_bindgen(js_name = "paintMaskDab")]
pub fn paint_mask_dab(
    engine: &mut Engine,
    layer_id: &str,
    cx: f64,
    cy: f64,
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    lopsy_engine::commands::paint::paint_mask_dab(&mut engine.inner, layer_id, cx, cy, size, hardness, opacity, mode)
}

#[wasm_bindgen(js_name = "paintMaskDabBatch")]
pub fn paint_mask_dab_batch(
    engine: &mut Engine,
    layer_id: &str,
    points: &[f64],
    size: f32,
    hardness: f32,
    opacity: f32,
    mode: u32,
) {
    lopsy_engine::commands::paint::paint_mask_dab_batch(&mut engine.inner, layer_id, points, size, hardness, opacity, mode)
}

#[wasm_bindgen(js_name = "drawMaskPencilLine")]
pub fn draw_mask_pencil_line(
    engine: &mut Engine,
    layer_id: &str,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    a: f32,
    size: f32,
    mode: u32,
) {
    lopsy_engine::commands::paint::draw_mask_pencil_line(&mut engine.inner, layer_id, x0, y0, x1, y1, a, size, mode)
}

#[wasm_bindgen(js_name = "fillMask")]
pub fn fill_mask(
    engine: &mut Engine,
    layer_id: &str,
    doc_x: i32,
    doc_y: i32,
    tolerance: u32,
    contiguous: bool,
    mode: u32,
) {
    lopsy_engine::commands::paint::fill_mask(&mut engine.inner, layer_id, doc_x, doc_y, tolerance, contiguous, mode)
}

#[wasm_bindgen(js_name = "renderMaskLinearGradient")]
pub fn render_mask_linear_gradient(
    engine: &mut Engine,
    layer_id: &str,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    stops_json: &str,
) {
    lopsy_engine::commands::paint::render_mask_linear_gradient(&mut engine.inner, layer_id, start_x, start_y, end_x, end_y, stops_json)
}

#[wasm_bindgen(js_name = "renderMaskRadialGradient")]
pub fn render_mask_radial_gradient(
    engine: &mut Engine,
    layer_id: &str,
    cx: f64,
    cy: f64,
    radius: f64,
    stops_json: &str,
) {
    lopsy_engine::commands::paint::render_mask_radial_gradient(&mut engine.inner, layer_id, cx, cy, radius, stops_json)
}

#[wasm_bindgen(js_name = "readMaskTexture")]
pub fn read_mask_texture(engine: &mut Engine, layer_id: &str) -> Option<Vec<u8>> {
    lopsy_engine::commands::paint::read_mask_texture(&mut engine.inner, layer_id)
}
