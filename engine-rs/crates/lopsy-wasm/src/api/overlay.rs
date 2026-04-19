//! Viewport- and overlay-side UI state: grid, rulers, the path/lasso/crop
//! previews, gradient guide, brush cursor, and transform overlay. Also
//! hosts `uploadLayerFromImageBitmap` — it's a layer texture upload but
//! specifically for the browser's ImageBitmap path (drag-drop, paste), so
//! it lives alongside the other canvas-display plumbing rather than in the
//! general layer API.

use wasm_bindgen::prelude::*;
use web_sys::WebGl2RenderingContext;

use crate::{Engine, overlay_renderer};

// ============================================================
// Tool UI Overlays
// ============================================================

#[wasm_bindgen(js_name = "setGridVisible")]
pub fn set_grid_visible(engine: &mut Engine, visible: bool) {
    engine.inner.grid_visible = visible;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setGridSize")]
pub fn set_grid_size(engine: &mut Engine, size: f32) {
    engine.inner.grid_size = size;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setTransformOverlay")]
pub fn set_transform_overlay(engine: &mut Engine, bounds_json: Option<String>) {
    overlay_renderer::set_transform_overlay(&mut engine.inner, bounds_json);
}

#[wasm_bindgen(js_name = "setGradientGuide")]
pub fn set_gradient_guide(
    engine: &mut Engine,
    start_x: f64, start_y: f64, end_x: f64, end_y: f64,
) {
    overlay_renderer::set_gradient_guide(&mut engine.inner, start_x, start_y, end_x, end_y);
}

#[wasm_bindgen(js_name = "clearGradientGuide")]
pub fn clear_gradient_guide(engine: &mut Engine) {
    overlay_renderer::clear_gradient_guide(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setPathOverlay")]
pub fn set_path_overlay(engine: &mut Engine, anchors_json: Option<String>) {
    overlay_renderer::set_path_overlay(&mut engine.inner, anchors_json);
}

#[wasm_bindgen(js_name = "setLassoPreview")]
pub fn set_lasso_preview(engine: &mut Engine, points_flat: Option<Vec<f64>>) {
    overlay_renderer::set_lasso_preview(&mut engine.inner, points_flat);
}

#[wasm_bindgen(js_name = "setCropPreview")]
pub fn set_crop_preview(engine: &mut Engine, x: f64, y: f64, w: f64, h: f64) {
    overlay_renderer::set_crop_preview(&mut engine.inner, x, y, w, h);
}

#[wasm_bindgen(js_name = "clearCropPreview")]
pub fn clear_crop_preview(engine: &mut Engine) {
    overlay_renderer::clear_crop_preview(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setBrushCursor")]
pub fn set_brush_cursor(engine: &mut Engine, x: f64, y: f64, radius: f64) {
    overlay_renderer::set_brush_cursor(&mut engine.inner, x, y, radius);
}

#[wasm_bindgen(js_name = "clearBrushCursor")]
pub fn clear_brush_cursor(engine: &mut Engine) {
    overlay_renderer::clear_brush_cursor(&mut engine.inner);
}

#[wasm_bindgen(js_name = "setRulersVisible")]
pub fn set_rulers_visible(engine: &mut Engine, visible: bool) {
    engine.inner.rulers_visible = visible;
    engine.inner.needs_recomposite = true;
}

#[wasm_bindgen(js_name = "setSeamlessPattern")]
pub fn set_seamless_pattern(engine: &mut Engine, enabled: bool, dim: bool) {
    engine.inner.seamless_pattern = enabled;
    engine.inner.seamless_dim = dim;
    engine.inner.needs_recomposite = true;
}

// ============================================================
// ImageBitmap upload
// ============================================================

#[wasm_bindgen(js_name = "uploadLayerFromImageBitmap")]
pub fn upload_layer_from_image_bitmap(
    engine: &mut Engine, layer_id: &str, bitmap: web_sys::ImageBitmap,
) {
    let gl = &engine.inner.gl;
    let width = bitmap.width();
    let height = bitmap.height();

    // Ensure texture exists and is correct size
    if let Some(&tex_handle) = engine.inner.layer_textures.get(layer_id) {
        let (tw, th) = engine.inner.texture_pool.get_size(tex_handle).unwrap_or((0, 0));
        if tw != width || th != height {
            engine.inner.texture_pool.release(tex_handle);
            if let Ok(new_tex) = engine.inner.texture_pool.acquire(gl, width, height) {
                engine.inner.layer_textures.insert(layer_id.to_string(), new_tex);
            }
        }
    }

    if let Some(&tex_handle) = engine.inner.layer_textures.get(layer_id) {
        if engine.inner.texture_pool.use_float() {
            // RGBA16F textures can't accept ImageBitmap directly.
            // Upload to a temp RGBA8 texture, then blit to the float texture.
            let temp_tex = match gl.create_texture() {
                Some(t) => t,
                None => { engine.inner.mark_layer_dirty(layer_id); return; }
            };
            gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&temp_tex));
            let _ = gl.tex_image_2d_with_u32_and_u32_and_image_bitmap(
                WebGl2RenderingContext::TEXTURE_2D,
                0,
                WebGl2RenderingContext::RGBA as i32,
                WebGl2RenderingContext::RGBA,
                WebGl2RenderingContext::UNSIGNED_BYTE,
                &bitmap,
            );
            gl.tex_parameteri(WebGl2RenderingContext::TEXTURE_2D, WebGl2RenderingContext::TEXTURE_MIN_FILTER, WebGl2RenderingContext::LINEAR as i32);
            gl.tex_parameteri(WebGl2RenderingContext::TEXTURE_2D, WebGl2RenderingContext::TEXTURE_MAG_FILTER, WebGl2RenderingContext::LINEAR as i32);

            // Blit from temp to float texture via the blit shader
            if let Some(dest_tex) = engine.inner.texture_pool.get(tex_handle).cloned() {
                engine.inner.render_to_texture(&dest_tex, width as i32, height as i32, |eng| {
                    let gl = &eng.gl;
                    gl.use_program(Some(&eng.shaders.blit.program));
                    gl.active_texture(WebGl2RenderingContext::TEXTURE0);
                    gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(&temp_tex));
                    if let Some(loc) = eng.shaders.blit.location(gl, "u_tex") {
                        gl.uniform1i(Some(&loc), 0);
                    }
                    eng.draw_fullscreen_quad();
                });
            }

            engine.inner.gl.delete_texture(Some(&temp_tex));
        } else {
            if let Some(texture) = engine.inner.texture_pool.get(tex_handle) {
                gl.bind_texture(WebGl2RenderingContext::TEXTURE_2D, Some(texture));
                let _ = gl.tex_image_2d_with_u32_and_u32_and_image_bitmap(
                    WebGl2RenderingContext::TEXTURE_2D,
                    0,
                    WebGl2RenderingContext::RGBA as i32,
                    WebGl2RenderingContext::RGBA,
                    WebGl2RenderingContext::UNSIGNED_BYTE,
                    &bitmap,
                );
            }
        }
    }

    engine.inner.mark_layer_dirty(layer_id);
}
