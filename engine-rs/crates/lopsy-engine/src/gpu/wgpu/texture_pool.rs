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

    /// A new transparent texture. Nothing is reused yet: `release` destroys
    /// what `acquire` made.
    pub fn acquire(&mut self, width: u32, height: u32) -> Result<TextureHandle, String> {
        if width > self.max_size || height > self.max_size {
            return Err(format!("texture {width}x{height} exceeds the GPU limit of {}", self.max_size));
        }
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format(),
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let entry = Some(TextureEntry { texture, width, height });
        let index = match self.entries.iter().position(Option::is_none) {
            Some(index) => {
                self.entries[index] = entry;
                index
            }
            None => {
                self.entries.push(entry);
                self.entries.len() - 1
            }
        };
        Ok(TextureHandle(index))
    }

    /// The format every pooled texture has.
    pub(in crate::gpu) fn format(&self) -> wgpu::TextureFormat {
        if self.use_float { wgpu::TextureFormat::Rgba16Float } else { wgpu::TextureFormat::Rgba8Unorm }
    }

    pub fn release(&mut self, handle: TextureHandle) {
        self.delete(handle);
    }

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
