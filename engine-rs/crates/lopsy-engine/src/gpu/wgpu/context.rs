use web_sys::HtmlCanvasElement;

use super::framebuffer::FramebufferPool;
use super::program::Linker;
use super::texture_pool::TexturePool;
use super::UNAVAILABLE;

pub struct GpuContext {
    /// The device and its queue. Nothing outside `gpu/` can reach them:
    /// feature code draws through `gpu::pass` and allocates through the
    /// pools.
    pub(in crate::gpu) device: wgpu::Device,
    pub(in crate::gpu) queue: wgpu::Queue,
    pub has_half_float: bool,
    pub has_float_blend: bool,
}

impl GpuContext {
    /// WebGPU hands out its adapter and device through promises, so a
    /// context cannot be made inside this synchronous call the way a WebGL
    /// one is.
    pub fn new(_canvas: &HtmlCanvasElement) -> Result<Self, String> {
        Err(UNAVAILABLE.into())
    }

    /// The texture and framebuffer pools for this context.
    pub fn create_pools(&self) -> (TexturePool, FramebufferPool) {
        (
            TexturePool::new(&self.device, &self.queue, self.has_half_float, self.max_texture_size()),
            FramebufferPool::new(),
        )
    }

    /// What compiles this context's shaders.
    pub(in crate::gpu) fn linker(&self) -> Linker {
        Linker::new(&self.device)
    }

    /// Largest texture edge the device accepts.
    pub fn max_texture_size(&self) -> u32 {
        self.device.limits().max_texture_dimension_2d
    }
}
