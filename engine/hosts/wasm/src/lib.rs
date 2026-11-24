pub mod api;
mod readback;

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use lopsy_core::color::BlendMode;
use lopsy_core::geometry;

use lopsy_engine::engine::EngineInner;
use lopsy_engine::gpu::context::GpuContext;
use lopsy_engine::gpu::shader::ShaderPrograms;
use lopsy_engine::{document::compositor, host};

use readback::{read, readback_export};

// ============================================================
// Engine wrapper for wasm_bindgen
// ============================================================

#[wasm_bindgen]
pub struct Engine {
    inner: EngineInner,
    /// Commands waiting for a readback.
    #[cfg(feature = "wgpu")]
    tasks: readback::Tasks,
}

// ============================================================
// Engine Lifecycle
// ============================================================

fn console_log(level: host::LogLevel, message: &str) {
    let message = message.into();
    match level {
        host::LogLevel::Info => web_sys::console::log_1(&message),
        host::LogLevel::Warn => web_sys::console::warn_1(&message),
        host::LogLevel::Error => web_sys::console::error_1(&message),
    }
}

/// Which backend this build of the engine draws with: `"webgl"` or `"wgpu"`.
#[wasm_bindgen(js_name = "rendererName")]
pub fn renderer_name() -> String {
    if cfg!(feature = "wgpu") { "wgpu" } else { "webgl" }.to_string()
}

/// The event the window receives when the wgpu device is lost. The page
/// answers it by creating the engine again (`useCanvasRendering.ts`).
#[cfg(feature = "wgpu")]
const GPU_LOST_EVENT: &str = "lopsy-gpu-lost";

#[cfg(feature = "wgpu")]
fn announce_gpu_lost(_reason: &str) {
    let Some(window) = web_sys::window() else { return };
    if let Ok(event) = web_sys::Event::new(GPU_LOST_EVENT) {
        let _ = window.dispatch_event(&event);
    }
}

/// A WebGL canvas fires `webglcontextlost` itself.
#[cfg(not(feature = "wgpu"))]
fn announce_gpu_lost(_reason: &str) {}

#[cfg(not(feature = "wgpu"))]
#[wasm_bindgen(js_name = "createEngine")]
pub fn create_engine(canvas: HtmlCanvasElement) -> Result<Engine, JsError> {
    host::install(host::Host { log: console_log, now_ms: js_sys::Date::now, gpu_lost: announce_gpu_lost });
    let gpu_ctx = GpuContext::new(&canvas).map_err(|e| JsError::new(&e))?;
    engine_on(gpu_ctx)
}

/// WebGPU hands out its device through a promise, so on wgpu this returns
/// one too. JS awaits `createEngine` on either backend.
#[cfg(feature = "wgpu")]
#[wasm_bindgen(js_name = "createEngine")]
pub async fn create_engine(canvas: HtmlCanvasElement) -> Result<Engine, JsError> {
    host::install(host::Host { log: console_log, now_ms: js_sys::Date::now, gpu_lost: announce_gpu_lost });
    let gpu_ctx = GpuContext::new(&canvas).await.map_err(|e| JsError::new(&e))?;
    engine_on(gpu_ctx)
}

fn engine_on(gpu_ctx: GpuContext) -> Result<Engine, JsError> {
    let shaders = ShaderPrograms::compile_all(&gpu_ctx).map_err(|e| JsError::new(&e))?;
    let inner = EngineInner::new(gpu_ctx, shaders).map_err(|e| JsError::new(&e))?;
    Ok(Engine {
        inner,
        #[cfg(feature = "wgpu")]
        tasks: readback::Tasks::default(),
    })
}

#[wasm_bindgen(js_name = "setDocumentSize")]
pub fn set_document_size(engine: &mut Engine, width: u32, height: u32) -> Result<(), JsError> {
    engine.inner.set_document_size(width, height).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen(js_name = "setViewport")]
pub fn set_viewport(engine: &mut Engine, zoom: f64, pan_x: f64, pan_y: f64, screen_w: f64, screen_h: f64) {
    engine.inner.set_viewport(zoom, pan_x, pan_y, screen_w, screen_h);
}

/// On wgpu, say whether the canvas is Display P3 and whether it should be
/// HDR: values above 1.0 shown brighter than white. Returns whether it is
/// HDR afterwards. WebGL returns false: there the page sets the drawing
/// buffer's colour space itself, and the buffer is 8 bits a channel. On
/// both, the develop working space renders the live frame for the colour
/// space said here, so a page with a P3 WebGL canvas calls it too.
#[wasm_bindgen(js_name = "setScreenOutput")]
pub fn set_screen_output(engine: &mut Engine, is_display_p3: bool, wants_hdr: bool) -> bool {
    engine.inner.set_screen_output(is_display_p3, wants_hdr)
}

/// Whether the screen really is HDR now: the engine's canvas is float
/// with extended tone mapping (wgpu, after `setScreenOutput` asked for HDR
/// and the browser could make it). Always false on WebGL. The status bar
/// should say HDR only when this is true.
#[wasm_bindgen(js_name = "screenIsHdr")]
pub fn screen_is_hdr(engine: &Engine) -> bool {
    engine.inner.screen_is_hdr()
}

#[wasm_bindgen(js_name = "setBackgroundColor")]
pub fn set_background_color(engine: &mut Engine, r: f32, g: f32, b: f32, a: f32) {
    engine.inner.set_background_color(r, g, b, a);
}

/// Set the document color mode: 0 = RGB (incl. grayscale/indexed), 1 = Lab,
/// 2 = CMYK. Mode 0 renders unchanged; Lab/CMYK add a display-decode pass.
#[wasm_bindgen(js_name = "setDocumentColorMode")]
pub fn set_document_color_mode(engine: &mut Engine, mode: u32) {
    engine.inner.set_document_color_mode(mode);
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
    compositor::render(&mut engine.inner);
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

/// All blend modes with their canonical names, exposed as JSON so the TS
/// side can build its psd-index ↔ union-tag maps from the same Rust source
/// of truth. The array is indexed by PSD index (matching `psd_index`).
///
/// Shape: `[{ "kebab": "normal", "pascal": "Normal", "display": "Normal" }, ...]`
#[wasm_bindgen(js_name = "blendModeCatalog")]
pub fn blend_mode_catalog() -> String {
    let mut out = String::from("[");
    for (i, mode) in BlendMode::ALL.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push_str(&format!(
            r#"{{"kebab":"{}","pascal":"{}","display":"{}"}}"#,
            mode.kebab_name(),
            mode.pascal_name(),
            mode.display_name(),
        ));
    }
    out.push(']');
    out
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

// ============================================================
// Pixel Operations (CPU-side via WASM)
// ============================================================

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

// ============================================================
// Export
// ============================================================

readback_export! {
    /// The document as RGBA8 sRGB. With the develop working space, rendered
    /// for sRGB by the output step, and dithered for a RAW photo.
    #[wasm_bindgen(js_name = "compositeForExport")]
    pub fn composite_for_export(engine) -> Result<Vec<u8>> {
        read(compositor::composite_for_export(engine))
    }
}

readback_export! {
    /// A 16-bit PNG of the document. `color_space` 0 is sRGB, 1 Display P3,
    /// 2 Rec. 2020. With the develop working space, the pixels are rendered
    /// for that space by the output step (not dithered).
    #[wasm_bindgen(js_name = "exportPng16")]
    pub fn export_png_16(engine, color_space: u8) -> Result<Vec<u8>> {
        read(compositor::export_png_16(engine, color_space))
    }
}

readback_export! {
    /// A 16-bit RGBA TIFF (Deflate, predictor 2, embedded ICC) of the same
    /// composite `exportPng16` encodes. `color_space` as `exportPng16`.
    #[wasm_bindgen(js_name = "exportTiff16")]
    pub fn export_tiff_16(engine, color_space: u8) -> Result<Vec<u8>> {
        read(compositor::export_tiff_16(engine, color_space))
    }
}

readback_export! {
    /// The composite as a 16-bit PNG in `file_space`, its numbers taken to
    /// be in `pixel_space` and converted. 0 is sRGB, 1 Display P3, 2
    /// Rec. 2020. `exportPng16(cs)` is `exportPng16To(cs, cs)`.
    #[wasm_bindgen(js_name = "exportPng16To")]
    pub fn export_png_16_to(engine, pixel_space: u8, file_space: u8) -> Result<Vec<u8>> {
        read(lopsy_engine::commands::export::export_png_16_to(engine, pixel_space, file_space))
    }
}

readback_export! {
    /// As `exportPng16To`, as a 16-bit RGBA TIFF with `file_space`'s ICC profile.
    #[wasm_bindgen(js_name = "exportTiff16To")]
    pub fn export_tiff_16_to(engine, pixel_space: u8, file_space: u8) -> Result<Vec<u8>> {
        read(lopsy_engine::commands::export::export_tiff_16_to(engine, pixel_space, file_space))
    }
}

/// Continue a command that was waiting for a readback (see `readback`).
/// WebGL never leaves one waiting.
#[cfg(not(feature = "wgpu"))]
#[wasm_bindgen(js_name = "resumeTask")]
pub fn resume_task(_engine: &mut Engine, _id: u32) -> Result<JsValue, JsError> {
    Err(JsError::new("No such readback task"))
}

/// Continue a command that was waiting for a readback (see `readback`).
#[cfg(feature = "wgpu")]
#[wasm_bindgen(js_name = "resumeTask")]
pub fn resume_task(engine: &mut Engine, id: u32) -> Result<JsValue, JsValue> {
    engine.tasks.resume(&mut engine.inner, id)
}

#[wasm_bindgen(js_name = "getCompositeSize")]
pub fn get_composite_size(engine: &Engine) -> Vec<u32> {
    vec![engine.inner.doc_width, engine.inner.doc_height]
}

/// Build an ICC profile for the given color space (0 = sRGB, 1 = Display
/// P3, 2 = Rec. 2020; anything else sRGB).
/// Used by the JS export path to tag files when the browser encoder did not.
#[wasm_bindgen(js_name = "buildIccProfile")]
pub fn build_icc_profile(color_space: u8) -> Vec<u8> {
    let cs = match color_space {
        1 => lopsy_core::color::ColorSpace::DisplayP3,
        2 => lopsy_core::color::ColorSpace::Rec2020,
        _ => lopsy_core::color::ColorSpace::Srgb,
    };
    lopsy_core::export::build_icc_profile(cs)
}

/// Convert an RGBA8 pixel buffer from one colour space to another (0 =
/// sRGB, 1 = Display P3, 2 = Rec. 2020), alpha untouched: the 8-bit
/// counterpart of the conversion `exportPng16To` does.
#[wasm_bindgen(js_name = "convertColorSpace8")]
pub fn convert_color_space_8(mut pixels: Vec<u8>, from: u8, to: u8) -> Result<Vec<u8>, JsError> {
    use lopsy_engine::commands::export::color_space_from_code;
    let from = color_space_from_code(from).map_err(|e| JsError::new(&e))?;
    let to = color_space_from_code(to).map_err(|e| JsError::new(&e))?;
    lopsy_core::space_convert::convert_rgba8(&mut pixels, from, to);
    Ok(pixels)
}

/// Convert an RGBA8 pixel buffer from Display P3 to sRGB.
/// Used for export formats that cannot carry an ICC profile (BMP).
#[wasm_bindgen(js_name = "convertP3ToSrgb")]
pub fn convert_p3_to_srgb(mut pixels: Vec<u8>) -> Vec<u8> {
    lopsy_core::color::p3_to_srgb_pixels(&mut pixels);
    pixels
}


