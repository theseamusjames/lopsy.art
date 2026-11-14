use web_sys::{HtmlCanvasElement, WebGl2RenderingContext};
use wasm_bindgen::JsCast;

use crate::gpu::framebuffer::FramebufferPool;
use crate::gpu::texture_pool::TexturePool;

pub struct GpuContext {
    /// The WebGL context. Nothing outside `gpu/` can reach it: feature code
    /// draws through `gpu::pass` and allocates through the pools.
    pub(in crate::gpu) gl: WebGl2RenderingContext,
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

        crate::host::log(
            crate::host::LogLevel::Info,
            &format!(
                "[Lopsy GPU] RGBA16F: ext_half={} ext_float={} fbo_ok={} → use_float={}  float_blend={}",
                has_half_float_ext, has_float_ext,
                has_half_float, has_half_float, has_float_blend
            ),
        );

        Ok(Self {
            gl,
            has_half_float,
            has_float_blend,
        })
    }

    /// The texture and framebuffer pools for this context.
    pub fn create_pools(&self) -> (TexturePool, FramebufferPool) {
        (
            TexturePool::new(&self.gl, self.has_half_float, self.max_texture_size()),
            FramebufferPool::new(&self.gl),
        )
    }

    /// Largest texture edge the context accepts, or `u32::MAX` if it does
    /// not say.
    pub fn max_texture_size(&self) -> u32 {
        self.gl
            .get_parameter(WebGl2RenderingContext::MAX_TEXTURE_SIZE)
            .ok()
            .and_then(|v| v.as_f64())
            .map(|v| v as u32)
            .filter(|&v| v > 0)
            .unwrap_or(u32::MAX)
    }
}
