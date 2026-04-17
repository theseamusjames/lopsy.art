pub mod gpu;
pub mod engine;
pub mod compositor;
pub mod layer_manager;
pub mod brush_gpu;
pub mod filter_gpu;
pub mod gradient_gpu;
pub mod shape_gpu;
pub mod selection_gpu;
pub mod dodge_burn_gpu;
pub mod smudge_gpu;
pub mod clone_stamp_gpu;
pub mod overlay_renderer;
pub mod color_mgmt;
pub mod api;

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use lopsy_core::color::{BlendMode, ColorSpace};
use lopsy_core::geometry;

use crate::engine::EngineInner;
use crate::gpu::context::GpuContext;
use crate::gpu::shader::ShaderPrograms;

// ============================================================
// Engine wrapper for wasm_bindgen
// ============================================================

#[wasm_bindgen]
pub struct Engine {
    inner: EngineInner,
}

// ============================================================
// Engine Lifecycle
// ============================================================

#[wasm_bindgen(js_name = "createEngine")]
pub fn create_engine(canvas: HtmlCanvasElement) -> Result<Engine, JsError> {
    let gpu_ctx = GpuContext::new(&canvas).map_err(|e| JsError::new(&e))?;
    let shaders = ShaderPrograms::compile_all(&gpu_ctx.gl).map_err(|e| JsError::new(&e))?;
    let inner = EngineInner::new(gpu_ctx, shaders).map_err(|e| JsError::new(&e))?;
    Ok(Engine { inner })
}

#[wasm_bindgen(js_name = "setDocumentSize")]
pub fn set_document_size(engine: &mut Engine, width: u32, height: u32) -> Result<(), JsError> {
    engine.inner.set_document_size(width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setViewport")]
pub fn set_viewport(engine: &mut Engine, zoom: f64, pan_x: f64, pan_y: f64, screen_w: f64, screen_h: f64) {
    engine.inner.set_viewport(zoom, pan_x, pan_y, screen_w, screen_h);
}

#[wasm_bindgen(js_name = "setBackgroundColor")]
pub fn set_background_color(engine: &mut Engine, r: f32, g: f32, b: f32, a: f32) {
    engine.inner.set_background_color(r, g, b, a);
}

#[wasm_bindgen(js_name = "clearAllLayers")]
pub fn clear_all_layers(engine: &mut Engine) {
    engine.inner.clear_all_layers();
}


// ============================================================
// Compositing / Rendering
// ============================================================

#[wasm_bindgen(js_name = "render")]
pub fn render(engine: &mut Engine) {
    compositor::composite(&mut engine.inner);
}

#[wasm_bindgen(js_name = "markLayerDirty")]
pub fn mark_layer_dirty(engine: &mut Engine, layer_id: &str) {
    engine.inner.mark_layer_dirty(layer_id);
}

#[wasm_bindgen(js_name = "markAllDirty")]
pub fn mark_all_dirty(engine: &mut Engine) {
    engine.inner.mark_all_dirty();
}


// ============================================================
// Blending (CPU fallback)
// ============================================================

#[wasm_bindgen(js_name = "blendColors")]
pub fn blend_colors(
    src_r: f32, src_g: f32, src_b: f32, src_a: f32,
    dst_r: f32, dst_g: f32, dst_b: f32, dst_a: f32,
    mode: u32,
) -> Vec<u8> {
    let src = lopsy_core::color::Color::new(src_r, src_g, src_b, src_a);
    let dst = lopsy_core::color::Color::new(dst_r, dst_g, dst_b, dst_a);
    let blend_mode = BlendMode::from_u8(mode as u8).unwrap_or(BlendMode::Normal);
    let result = lopsy_core::blend::blend_colors(src, dst, blend_mode);
    let c8 = result.to_srgb8();
    vec![c8.r, c8.g, c8.b, c8.a]
}


// ============================================================
// Coordinate Transforms
// ============================================================

#[wasm_bindgen(js_name = "screenToCanvas")]
pub fn screen_to_canvas(
    screen_x: f64, screen_y: f64,
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> Vec<f64> {
    let (cx, cy) = geometry::screen_to_canvas(screen_x, screen_y, zoom, pan_x, pan_y, view_width, view_height);
    vec![cx, cy]
}

#[wasm_bindgen(js_name = "canvasToScreen")]
pub fn canvas_to_screen(
    canvas_x: f64, canvas_y: f64,
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> Vec<f64> {
    let (sx, sy) = geometry::canvas_to_screen(canvas_x, canvas_y, zoom, pan_x, pan_y, view_width, view_height);
    vec![sx, sy]
}

#[wasm_bindgen(js_name = "getVisibleRegion")]
pub fn get_visible_region(
    zoom: f64, pan_x: f64, pan_y: f64,
    view_width: f64, view_height: f64,
) -> Vec<f64> {
    let (x, y, w, h) = geometry::get_visible_region(zoom, pan_x, pan_y, view_width, view_height);
    vec![x, y, w, h]
}

#[wasm_bindgen(js_name = "screenDeltaToCanvas")]
pub fn screen_delta_to_canvas(dx: f64, dy: f64, zoom: f64) -> Vec<f64> {
    let (cx, cy) = geometry::screen_delta_to_canvas(dx, dy, zoom);
    vec![cx, cy]
}

// ============================================================
// Pixel Operations (CPU-side via WASM)
// ============================================================

#[wasm_bindgen(js_name = "clonePixelData")]
pub fn clone_pixel_data(data: &[u8]) -> Vec<u8> {
    lopsy_core::pixel_buffer::clone_pixel_data(data)
}

#[wasm_bindgen(js_name = "cropToContentBounds")]
pub fn crop_to_content_bounds(data: &[u8], width: u32, height: u32) -> Vec<u8> {
    let (cropped, _rect) = lopsy_core::pixel_buffer::crop_to_content_bounds(data, width, height);
    cropped
}

#[wasm_bindgen(js_name = "expandFromCrop")]
pub fn expand_from_crop(
    cropped: &[u8], cw: u32, ch: u32,
    ox: i32, oy: i32, fw: u32, fh: u32,
) -> Vec<u8> {
    lopsy_core::pixel_buffer::expand_from_crop(cropped, cw, ch, ox, oy, fw, fh)
}

#[wasm_bindgen(js_name = "toSparsePixelData")]
pub fn to_sparse_pixel_data(data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let sparse = lopsy_core::sparse::to_sparse(data, width, height)?;
    let mut packed = Vec::new();
    let count = sparse.indices.len() as u32;
    packed.extend_from_slice(&count.to_le_bytes());
    for &idx in &sparse.indices {
        packed.extend_from_slice(&idx.to_le_bytes());
    }
    packed.extend_from_slice(&sparse.rgba);
    Some(packed)
}

#[wasm_bindgen(js_name = "scalePixelData")]
pub fn scale_pixel_data(data: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    lopsy_core::pixel_buffer::scale_pixel_data(data, src_w, src_h, dst_w, dst_h)
}

#[wasm_bindgen(js_name = "resizeCanvasPixelData")]
pub fn resize_canvas_pixel_data(
    data: &[u8], src_w: u32, src_h: u32,
    layer_x: i32, layer_y: i32,
    dst_w: u32, dst_h: u32,
    offset_x: i32, offset_y: i32,
) -> Vec<u8> {
    lopsy_core::pixel_buffer::resize_canvas_pixel_data(data, src_w, src_h, layer_x, layer_y, dst_w, dst_h, offset_x, offset_y)
}

#[wasm_bindgen(js_name = "cropLayerPixelData")]
pub fn crop_layer_pixel_data(
    data: &[u8], src_w: u32, src_h: u32,
    layer_x: i32, layer_y: i32,
    crop_x: i32, crop_y: i32, crop_w: u32, crop_h: u32,
) -> Vec<u8> {
    lopsy_core::pixel_buffer::crop_layer_pixel_data(data, src_w, src_h, layer_x, layer_y, crop_x, crop_y, crop_w, crop_h)
}

#[wasm_bindgen(js_name = "createMaskSurface")]
pub fn create_mask_surface(mask_data: &[u8], width: u32, height: u32) -> Vec<u8> {
    lopsy_core::pixel_buffer::create_mask_surface(mask_data, width, height)
}

#[wasm_bindgen(js_name = "extractMaskFromSurface")]
pub fn extract_mask_from_surface(surface_data: &[u8], width: u32, height: u32) -> Vec<u8> {
    lopsy_core::pixel_buffer::extract_mask_from_surface(surface_data, width, height)
}


// ============================================================
// Color Management
// ============================================================

#[wasm_bindgen(js_name = "detectColorSpace")]
pub fn detect_color_space() -> u32 {
    // Check via matchMedia for Display P3 support
    if let Ok(result) = js_sys::eval("window.matchMedia('(color-gamut: p3)').matches") {
        if result.as_bool() == Some(true) {
            return 1; // DisplayP3
        }
    }
    0 // sRGB default
}

#[wasm_bindgen(js_name = "convertColorSpace")]
pub fn convert_color_space(
    data: &[u8], width: u32, height: u32,
    from_space: u32, to_space: u32,
) -> Vec<u8> {
    color_mgmt::convert_color_space(data, width, height, from_space, to_space)
}

#[wasm_bindgen(js_name = "buildIccProfile")]
pub fn build_icc_profile(color_space: u32) -> Vec<u8> {
    let cs = match color_space {
        1 => ColorSpace::DisplayP3,
        2 => ColorSpace::Rec2020,
        _ => ColorSpace::Srgb,
    };
    lopsy_core::export::build_icc_profile(cs)
}

// ============================================================
// Export
// ============================================================

#[wasm_bindgen(js_name = "compositeForExport")]
pub fn composite_for_export(engine: &mut Engine) -> Result<Vec<u8>, JsError> {
    compositor::composite_for_export(&mut engine.inner).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "getCompositeSize")]
pub fn get_composite_size(engine: &Engine) -> Vec<u32> {
    vec![engine.inner.doc_width, engine.inner.doc_height]
}


