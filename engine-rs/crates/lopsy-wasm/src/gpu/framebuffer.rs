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

    /// Copy the `(x, y, width, height)` region of `src`'s colour attachment
    /// to `dst_origin` in `dst`'s, texel for texel. Leaves both bound (read
    /// and draw); callers rebind or `unbind` afterwards.
    pub fn blit_region(
        &self,
        gl: &WebGl2RenderingContext,
        src: FramebufferHandle,
        dst: FramebufferHandle,
        region: (i32, i32, i32, i32),
        dst_origin: (i32, i32),
    ) {
        let (Some(src), Some(dst)) = (self.entries.get(src.0), self.entries.get(dst.0)) else { return };
        let (x, y, w, h) = region;
        let (dx, dy) = dst_origin;
        gl.bind_framebuffer(WebGl2RenderingContext::READ_FRAMEBUFFER, Some(&src.fbo));
        gl.bind_framebuffer(WebGl2RenderingContext::DRAW_FRAMEBUFFER, Some(&dst.fbo));
        gl.blit_framebuffer(
            x, y, x + w, y + h,
            dx, dy, dx + w, dy + h,
            WebGl2RenderingContext::COLOR_BUFFER_BIT,
            WebGl2RenderingContext::NEAREST,
        );
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
