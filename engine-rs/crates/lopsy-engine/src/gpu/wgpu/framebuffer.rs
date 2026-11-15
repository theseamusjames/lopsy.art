use std::cell::RefCell;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FramebufferHandle(pub usize);

/// WebGPU has no framebuffer objects: a render pass names the texture it
/// draws into. A framebuffer here is a name for whichever texture was last
/// attached to it, which is all the engine uses one for.
pub struct FramebufferPool {
    attachments: RefCell<Vec<Option<wgpu::Texture>>>,
}

impl FramebufferPool {
    pub(in crate::gpu) fn new() -> Self {
        Self { attachments: RefCell::new(Vec::new()) }
    }

    pub fn create(&mut self) -> Result<FramebufferHandle, String> {
        let attachments = self.attachments.get_mut();
        attachments.push(None);
        Ok(FramebufferHandle(attachments.len() - 1))
    }

    pub fn attach_texture(&self, handle: FramebufferHandle, texture: &wgpu::Texture) {
        if let Some(slot) = self.attachments.borrow_mut().get_mut(handle.0) {
            *slot = Some(texture.clone());
        }
    }

    /// The texture attached to `handle`.
    pub(in crate::gpu) fn attachment(&self, handle: FramebufferHandle) -> Option<wgpu::Texture> {
        self.attachments.borrow().get(handle.0).cloned().flatten()
    }

    /// Nothing is bound between WebGPU passes.
    pub fn unbind(&self) {}

    pub fn release(&mut self, handle: FramebufferHandle) {
        if let Some(slot) = self.attachments.get_mut().get_mut(handle.0) {
            *slot = None;
        }
    }

    pub fn destroy(&mut self) {
        self.attachments.get_mut().clear();
    }
}
