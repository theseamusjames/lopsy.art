use web_sys::{WebGl2RenderingContext, WebGlFramebuffer, WebGlTexture};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FramebufferHandle(pub usize);

struct FboEntry {
    fbo: WebGlFramebuffer,
}

pub struct FramebufferPool {
    entries: Vec<FboEntry>,
}

impl FramebufferPool {
    pub fn new() -> Self {
        Self { entries: Vec::new() }
    }

    pub fn create(&mut self, gl: &WebGl2RenderingContext) -> Result<FramebufferHandle, String> {
        let fbo = gl.create_framebuffer().ok_or("Failed to create framebuffer")?;
        let handle = FramebufferHandle(self.entries.len());
        self.entries.push(FboEntry { fbo });
        Ok(handle)
    }

    pub fn attach_texture(
        &self,
        gl: &WebGl2RenderingContext,
        handle: FramebufferHandle,
        texture: &WebGlTexture,
    ) {
        if let Some(entry) = self.entries.get(handle.0) {
            gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&entry.fbo));
            gl.framebuffer_texture_2d(
                WebGl2RenderingContext::FRAMEBUFFER,
                WebGl2RenderingContext::COLOR_ATTACHMENT0,
                WebGl2RenderingContext::TEXTURE_2D,
                Some(texture),
                0,
            );
        }
    }

    pub fn bind(&self, gl: &WebGl2RenderingContext, handle: FramebufferHandle) {
        if let Some(entry) = self.entries.get(handle.0) {
            gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&entry.fbo));
        }
    }

    pub fn unbind(&self, gl: &WebGl2RenderingContext) {
        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    }

    pub fn release(&mut self, gl: &WebGl2RenderingContext, handle: FramebufferHandle) {
        if let Some(entry) = self.entries.get(handle.0) {
            gl.delete_framebuffer(Some(&entry.fbo));
        }
    }

    /// Delete every FBO held by the pool. Call once when tearing down the
    /// engine so WebGL reclaims all FBO memory without waiting for the
    /// context itself to be destroyed.
    pub fn destroy(&mut self, gl: &WebGl2RenderingContext) {
        for entry in self.entries.drain(..) {
            gl.delete_framebuffer(Some(&entry.fbo));
        }
    }
}
