use std::cell::Cell;

use lopsy_core::half::f32_to_f16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TextureHandle(pub usize);

/// Every pooled texture is `rgba16float`, which WebGPU guarantees can be
/// rendered to, blended and filtered.
pub(in crate::gpu) const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const BYTES_PER_TEXEL: u32 = 8;

/// How many free textures of one size the pool keeps; the same policy as
/// the WebGL pool, so the two reuse textures in the same order.
const MAX_FREE_PER_SIZE: usize = 2;

/// Values converted per `write_texture` call when an upload is not already
/// half floats (32 MB of them).
const UPLOAD_BAND_VALUES: usize = 4 * 1024 * 1024;

/// How a texture is sampled. WebGL keeps this on the texture; here the
/// pool remembers it and a pass picks the matching sampler.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Sampling {
    is_nearest: bool,
    is_repeat: bool,
}

struct TextureEntry {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
    in_use: bool,
    sampling: Cell<Sampling>,
}

pub struct TexturePool {
    /// `None` slots are tombstones for deleted textures. Handles index into
    /// this vector, so entries are replaced in place and never shifted.
    entries: Vec<Option<TextureEntry>>,
    max_size: u32,
    device: wgpu::Device,
    queue: wgpu::Queue,
    /// Indexed by [`sampler_index`].
    samplers: [wgpu::Sampler; 4],
    /// `byte / 255` as a half float, for 8-bit uploads.
    half_from_byte: [u16; 256],
}

fn sampler_index(sampling: Sampling) -> usize {
    sampling.is_nearest as usize | (sampling.is_repeat as usize) << 1
}

fn make_sampler(device: &wgpu::Device, sampling: Sampling) -> wgpu::Sampler {
    let filter = if sampling.is_nearest { wgpu::FilterMode::Nearest } else { wgpu::FilterMode::Linear };
    let wrap = if sampling.is_repeat { wgpu::AddressMode::Repeat } else { wgpu::AddressMode::ClampToEdge };
    device.create_sampler(&wgpu::SamplerDescriptor {
        address_mode_u: wrap,
        address_mode_v: wrap,
        mag_filter: filter,
        min_filter: filter,
        ..Default::default()
    })
}

impl TexturePool {
    pub(in crate::gpu) fn new(device: &wgpu::Device, queue: &wgpu::Queue, max_size: u32) -> Self {
        let sampler = |is_nearest, is_repeat| make_sampler(device, Sampling { is_nearest, is_repeat });
        Self {
            entries: Vec::new(),
            max_size,
            device: device.clone(),
            queue: queue.clone(),
            samplers: [sampler(false, false), sampler(true, false), sampler(false, true), sampler(true, true)],
            half_from_byte: std::array::from_fn(|byte| f32_to_f16(byte as f32 / 255.0)),
        }
    }

    pub fn max_size(&self) -> u32 {
        self.max_size
    }

    pub fn use_float(&self) -> bool {
        true
    }

    pub fn destroy(&mut self) {
        for entry in self.entries.drain(..).flatten() {
            entry.texture.destroy();
        }
    }

    /// Total live (non-tombstone) entry count. Test / e2e helper.
    pub fn live_entry_count(&self) -> usize {
        self.entries.iter().filter(|e| e.is_some()).count()
    }

    /// Free-entry count across all sizes. Test / e2e helper.
    pub fn free_entry_count(&self) -> usize {
        self.entries.iter().flatten().filter(|e| !e.in_use).count()
    }

    /// A transparent `width` by `height` texture: a free one of that size
    /// if the pool holds one, a new one otherwise. A reused texture keeps
    /// the filter and wrap its last user set, as a WebGL texture does.
    pub fn acquire(&mut self, width: u32, height: u32) -> Result<TextureHandle, String> {
        if width > self.max_size || height > self.max_size {
            return Err(format!("texture {width}x{height} exceeds the GPU limit of {}", self.max_size));
        }
        self.evict_excess_free_entries();

        let free = self.entries.iter().position(|slot| {
            slot.as_ref().is_some_and(|entry| !entry.in_use && entry.width == width && entry.height == height)
        });
        if let Some(index) = free {
            if let Some(entry) = self.entries[index].as_mut() {
                entry.in_use = true;
                clear(&self.device, &self.queue, &entry.view);
            }
            return Ok(TextureHandle(index));
        }

        // A zero-sized texture is not allowed; the engine's sizes are the
        // ones it recorded, so only the allocation is padded.
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let entry = Some(TextureEntry { texture, view, width, height, in_use: true, sampling: Cell::default() });
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

    /// Return a texture to the pool. Excess free entries are destroyed at
    /// the start of the next `acquire`.
    pub fn release(&mut self, handle: TextureHandle) {
        if let Some(entry) = self.entries.get_mut(handle.0).and_then(|e| e.as_mut()) {
            if !entry.in_use {
                report_misuse("released twice", handle);
            }
            entry.in_use = false;
        }
    }

    /// Destroy an in-use texture outright instead of returning it to the
    /// pool, for one-off sizes that will never be acquired again.
    pub fn delete(&mut self, handle: TextureHandle) {
        let Some(entry) = self.entries.get_mut(handle.0).and_then(Option::take) else { return };
        if !entry.in_use {
            report_misuse("deleted after release", handle);
        }
        entry.texture.destroy();
    }

    fn evict_excess_free_entries(&mut self) {
        let mut counts: std::collections::HashMap<(u32, u32), usize> = std::collections::HashMap::new();
        for slot in self.entries.iter_mut() {
            let Some(entry) = slot.take() else { continue };
            if entry.in_use {
                *slot = Some(entry);
                continue;
            }
            let count = counts.entry((entry.width, entry.height)).or_insert(0);
            if *count >= MAX_FREE_PER_SIZE {
                entry.texture.destroy();
            } else {
                *count += 1;
                *slot = Some(entry);
            }
        }
    }

    fn entry(&self, handle: TextureHandle) -> Option<&TextureEntry> {
        self.entries.get(handle.0).and_then(|e| e.as_ref())
    }

    pub fn get(&self, handle: TextureHandle) -> Option<&wgpu::Texture> {
        let entry = self.entry(handle)?;
        if !entry.in_use {
            report_misuse("read after release", handle);
        }
        Some(&entry.texture)
    }

    pub fn get_size(&self, handle: TextureHandle) -> Option<(u32, u32)> {
        self.entry(handle).map(|e| (e.width, e.height))
    }

    /// The view a pass samples or draws into.
    pub(in crate::gpu) fn view(&self, handle: TextureHandle) -> Option<&wgpu::TextureView> {
        self.entry(handle).map(|e| &e.view)
    }

    /// The sampler that reads `handle` the way its filter and wrap say.
    pub(in crate::gpu) fn sampler(&self, handle: TextureHandle) -> &wgpu::Sampler {
        let sampling = self.entry(handle).map(|e| e.sampling.get()).unwrap_or_default();
        &self.samplers[sampler_index(sampling)]
    }

    /// A sampler for a texture the pool does not hold: nearest, clamped.
    pub(in crate::gpu) fn nearest_sampler(&self) -> &wgpu::Sampler {
        &self.samplers[sampler_index(Sampling { is_nearest: true, is_repeat: false })]
    }

    fn update_sampling(&self, handle: TextureHandle, change: impl FnOnce(&mut Sampling)) {
        if let Some(entry) = self.entry(handle) {
            let mut sampling = entry.sampling.get();
            change(&mut sampling);
            entry.sampling.set(sampling);
        }
    }

    pub fn set_nearest_filter(&self, handle: TextureHandle) {
        self.update_sampling(handle, |s| s.is_nearest = true);
    }

    pub fn set_linear_filter(&self, handle: TextureHandle) {
        self.update_sampling(handle, |s| s.is_nearest = false);
    }

    pub fn set_repeat_wrap(&self, handle: TextureHandle) {
        self.update_sampling(handle, |s| s.is_repeat = true);
    }

    pub fn set_clamp_wrap(&self, handle: TextureHandle) {
        self.update_sampling(handle, |s| s.is_repeat = false);
    }

    pub fn upload_rgba(&self, handle: TextureHandle, x: i32, y: i32, w: u32, h: u32, data: &[u8]) -> Result<(), String> {
        let lut = &self.half_from_byte;
        self.upload_as_halves(handle, x, y, w, h, data, |byte| lut[byte as usize])
    }

    pub fn upload_rgba_f32(&self, handle: TextureHandle, x: i32, y: i32, w: u32, h: u32, data: &[f32]) -> Result<(), String> {
        self.upload_as_halves(handle, x, y, w, h, data, f32_to_f16)
    }

    pub fn upload_rgba_u16(&self, handle: TextureHandle, x: i32, y: i32, w: u32, h: u32, data: &[u16]) -> Result<(), String> {
        self.upload_as_halves(handle, x, y, w, h, data, |v| f32_to_f16(v as f32 / 65535.0))
    }

    /// Write `w` by `h` RGBA texels at `(x, y)`, converting each value to
    /// the half float the texture stores. Large uploads go up in bands so
    /// the converted copy stays small.
    fn upload_as_halves<T: Copy>(
        &self,
        handle: TextureHandle,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        data: &[T],
        to_half: impl Fn(T) -> u16,
    ) -> Result<(), String> {
        let entry = self.entry(handle).ok_or("Texture not found")?;
        if w == 0 || h == 0 {
            return Ok(());
        }
        let row_values = w as usize * 4;
        if data.len() < row_values * h as usize {
            return Err(format!("upload of {w}x{h} was given {} values", data.len()));
        }
        let fits = x >= 0 && y >= 0 && x as u32 + w <= entry.texture.width() && y as u32 + h <= entry.texture.height();
        if !fits {
            return Err(format!("upload of {w}x{h} at ({x}, {y}) does not fit a {}x{} texture", entry.width, entry.height));
        }

        let band_rows = (UPLOAD_BAND_VALUES / row_values).max(1);
        let mut band: Vec<u8> = Vec::with_capacity(band_rows.min(h as usize) * row_values * 2);
        for (i, rows) in data[..row_values * h as usize].chunks(band_rows * row_values).enumerate() {
            band.clear();
            band.extend(rows.iter().flat_map(|&value| to_half(value).to_le_bytes()));
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &entry.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: x as u32, y: y as u32 + (i * band_rows) as u32, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                &band,
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * BYTES_PER_TEXEL), rows_per_image: None },
                wgpu::Extent3d { width: w, height: (rows.len() / row_values) as u32, depth_or_array_layers: 1 },
            );
        }
        Ok(())
    }

    /// Fill the texture from a canvas, top row first and not premultiplied,
    /// as the WebGL upload does.
    #[cfg(target_arch = "wasm32")]
    pub fn upload_canvas(&self, handle: TextureHandle, canvas: &crate::gpu::ExternalImage, _w: u32, _h: u32) -> Result<(), String> {
        let entry = self.entry(handle).ok_or("Texture not found")?;
        let width = canvas.width().min(entry.texture.width());
        let height = canvas.height().min(entry.texture.height());
        if width == 0 || height == 0 {
            return Ok(());
        }
        self.queue.copy_external_image_to_texture(
            &wgpu::CopyExternalImageSourceInfo {
                source: wgpu::ExternalImageSource::HTMLCanvasElement(canvas.clone()),
                origin: wgpu::Origin2d::ZERO,
                flip_y: false,
            },
            wgpu::CopyExternalImageDestInfo {
                texture: &entry.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
                color_space: wgpu::PredefinedColorSpace::Srgb,
                premultiplied_alpha: false,
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );
        Ok(())
    }

    /// A canvas exists only in the browser.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn upload_canvas(&self, _handle: TextureHandle, _canvas: &crate::gpu::ExternalImage, _w: u32, _h: u32) -> Result<(), String> {
        Err("A canvas can only be uploaded in the browser".into())
    }
}

/// Make `view`'s texture transparent.
fn clear(device: &wgpu::Device, queue: &wgpu::Queue, view: &wgpu::TextureView) {
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: None,
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    queue.submit([encoder.finish()]);
}

#[cfg(debug_assertions)]
fn report_misuse(what: &str, handle: TextureHandle) {
    crate::host::log(crate::host::LogLevel::Error, &format!("[texture-pool] handle {} {what}", handle.0));
}

#[cfg(not(debug_assertions))]
fn report_misuse(_what: &str, _handle: TextureHandle) {}
