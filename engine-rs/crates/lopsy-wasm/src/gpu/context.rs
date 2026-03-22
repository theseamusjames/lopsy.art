use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};
use wasm_bindgen::JsCast;

use crate::gpu::texture_pool::TexturePool;

pub struct GpuContext {
    pub gl: WebGl2RenderingContext,
    pub has_half_float: bool,
    pub has_float_blend: bool,
}

impl GpuContext {
    pub fn new(canvas: &HtmlCanvasElement) -> Result<Self, String> {
        let gl = canvas
            .get_context("webgl2")
            .map_err(|e| format!("getContext failed: {:?}", e))?
            .ok_or("WebGL 2 not supported")?
            .dyn_into::<WebGl2RenderingContext>()
            .map_err(|_| "Failed to cast to WebGl2RenderingContext")?;

        // Check for float texture extensions
        let has_half_float_ext = gl
            .get_extension("EXT_color_buffer_half_float")
            .ok()
            .flatten()
            .is_some();

        // EXT_color_buffer_float also makes RGBA16F renderable in WebGL2
        let has_float_ext = gl
            .get_extension("EXT_color_buffer_float")
            .ok()
            .flatten()
            .is_some();

        // Verify the FBO is actually complete with RGBA16F — some GPUs report
        // the extension but don't render correctly to float FBOs.
        let has_half_float = (has_half_float_ext || has_float_ext)
            && TexturePool::verify_float_renderable(&gl);

        let has_float_blend = gl
            .get_extension("EXT_float_blend")
            .ok()
            .flatten()
            .is_some();

        web_sys::console::log_1(
            &format!(
                "[Lopsy GPU] RGBA16F: ext_half={} ext_float={} fbo_ok={} → use_float={}  float_blend={}",
                has_half_float_ext, has_float_ext,
                has_half_float, has_half_float, has_float_blend
            ).into(),
        );

        Ok(Self {
            gl,
            has_half_float,
            has_float_blend,
        })
    }
}
