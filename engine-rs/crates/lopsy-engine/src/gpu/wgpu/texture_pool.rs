use super::UNAVAILABLE;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TextureHandle(pub usize);

struct TextureEntry {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
}

pub struct TexturePool {
    entries: Vec<Option<TextureEntry>>,
    use_float: bool,
    max_size: u32,
    device: wgpu::Device,
    queue: wgpu::Queue,
}

impl TexturePool {
    pub(in crate::gpu) fn new(device: &wgpu::Device, queue: &wgpu::Queue, use_float: bool, max_size: u32) -> Self {
        Self { entries: Vec::new(), use_float, max_size, device: device.clone(), queue: queue.clone() }
    }

    pub fn max_size(&self) -> u32 {
        self.max_size
    }

    pub fn use_float(&self) -> bool {
        self.use_float
    }

    pub fn destroy(&mut self) {
        for entry in self.entries.drain(..).flatten() {
            entry.texture.destroy();
        }
    }

    pub fn live_entry_count(&self) -> usize {
        self.entries.iter().filter(|e| e.is_some()).count()
    }

    pub fn free_entry_count(&self) -> usize {
        0
    }

    pub fn acquire(&mut self, _width: u32, _height: u32) -> Result<TextureHandle, String> {
        Err(UNAVAILABLE.into())
    }

    pub fn release(&mut self, _handle: TextureHandle) {}

    pub fn delete(&mut self, handle: TextureHandle) {
        if let Some(entry) = self.entries.get_mut(handle.0).and_then(Option::take) {
            entry.texture.destroy();
        }
    }

    pub fn get(&self, handle: TextureHandle) -> Option<&wgpu::Texture> {
        self.entries.get(handle.0).and_then(|e| e.as_ref()).map(|e| &e.texture)
    }

    pub fn get_size(&self, handle: TextureHandle) -> Option<(u32, u32)> {
        self.entries.get(handle.0).and_then(|e| e.as_ref()).map(|e| (e.width, e.height))
    }

    pub fn set_nearest_filter(&self, _handle: TextureHandle) {}

    pub fn set_linear_filter(&self, _handle: TextureHandle) {}

    pub fn set_repeat_wrap(&self, _handle: TextureHandle) {}

    pub fn set_clamp_wrap(&self, _handle: TextureHandle) {}

    pub fn upload_rgba(&self, _handle: TextureHandle, _x: i32, _y: i32, _w: u32, _h: u32, _data: &[u8]) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }

    pub fn upload_rgba_f32(&self, _handle: TextureHandle, _x: i32, _y: i32, _w: u32, _h: u32, _data: &[f32]) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }

    pub fn upload_rgba_u16(&self, _handle: TextureHandle, _x: i32, _y: i32, _w: u32, _h: u32, _data: &[u16]) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }

    pub fn upload_canvas(&self, _handle: TextureHandle, _canvas: &crate::gpu::ExternalImage, _w: u32, _h: u32) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
}
