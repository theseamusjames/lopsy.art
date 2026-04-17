use web_sys::{WebGl2RenderingContext, WebGlFramebuffer, WebGlTexture};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FramebufferHandle(pub usize);

struct FboEntry {
    fbo: WebGlFramebuffer,
}

pub struct FramebufferPool {
    /// Tombstoned with `None` after release — keeps `FramebufferHandle`
    /// indices stable while making use-after-release a silent no-op rather
    /// than a dangling-pointer crash.
    entries: Vec<Option<FboEntry>>,
}

impl FramebufferPool {
    pub fn new() -> Self {
        Self { entries: Vec::new() }
    }

    pub fn create(&mut self, gl: &WebGl2RenderingContext) -> Result<FramebufferHandle, String> {
        let fbo = gl.create_framebuffer().ok_or("Failed to create framebuffer")?;
        // Reuse a tombstoned slot if present so handle space stays compact.
        if let Some(idx) = self.entries.iter().position(|s| s.is_none()) {
            self.entries[idx] = Some(FboEntry { fbo });
            Ok(FramebufferHandle(idx))
        } else {
            let handle = FramebufferHandle(self.entries.len());
            self.entries.push(Some(FboEntry { fbo }));
            Ok(handle)
        }
    }

    pub fn attach_texture(
        &self,
        gl: &WebGl2RenderingContext,
        handle: FramebufferHandle,
        texture: &WebGlTexture,
    ) {
        if let Some(entry) = self.entries.get(handle.0).and_then(|s| s.as_ref()) {
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
        if let Some(entry) = self.entries.get(handle.0).and_then(|s| s.as_ref()) {
            gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, Some(&entry.fbo));
        }
    }

    pub fn unbind(&self, gl: &WebGl2RenderingContext) {
        gl.bind_framebuffer(WebGl2RenderingContext::FRAMEBUFFER, None);
    }

    /// Delete the FBO and tombstone its slot. Subsequent calls with the same
    /// handle become silent no-ops instead of dereferencing a freed FBO.
    pub fn release(&mut self, gl: &WebGl2RenderingContext, handle: FramebufferHandle) {
        if let Some(entry) = self.entries.get_mut(handle.0).and_then(|s| s.take()) {
            gl.delete_framebuffer(Some(&entry.fbo));
        }
    }

    /// Free every FBO held by the pool. Call once when tearing down the engine.
    pub fn destroy(&mut self, gl: &WebGl2RenderingContext) {
        for slot in self.entries.drain(..) {
            if let Some(entry) = slot {
                gl.delete_framebuffer(Some(&entry.fbo));
            }
        }
    }
}
