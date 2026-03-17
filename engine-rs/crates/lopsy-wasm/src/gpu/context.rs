use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};
use wasm_bindgen::JsCast;

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

        let has_half_float = gl
            .get_extension("EXT_color_buffer_half_float")
            .ok()
            .flatten()
            .is_some();

        let has_float_blend = gl
            .get_extension("EXT_float_blend")
            .ok()
            .flatten()
            .is_some();

        Ok(Self {
            gl,
            has_half_float,
            has_float_blend,
        })
    }
}
