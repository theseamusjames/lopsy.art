use std::cell::{Cell, RefCell};
use std::sync::Arc;

use web_sys::HtmlCanvasElement;

use super::framebuffer::FramebufferPool;
use super::program::{LinkedProgram, Linker, QUAD_SIZE};
use super::texture_pool::{self, TexturePool};
use crate::host::{self, LogLevel};

pub struct GpuContext {
    /// The device and its queue. Nothing outside `gpu/` can reach them:
    /// feature code draws through `gpu::pass` and allocates through the
    /// pools.
    pub(in crate::gpu) device: wgpu::Device,
    pub(in crate::gpu) queue: wgpu::Queue,
    screen: Screen,
    pub(in crate::gpu) draw: DrawState,
    pub has_half_float: bool,
    pub has_float_blend: bool,
}

/// What every pass on the device draws with.
pub(in crate::gpu) struct DrawState {
    linker: Linker,
    /// Every uniform struct a pass draws with, each at its own offset. The
    /// bytes of one submit are written before it; after it they are dead
    /// and the next submit writes over them from the start.
    arena: wgpu::Buffer,
    cursor: Cell<u64>,
    offset_alignment: u64,
    /// The vertex stage's `Quad`, somewhere in the arena.
    pub(in crate::gpu) quad_group: wgpu::BindGroup,
    pub(in crate::gpu) fill: LinkedProgram,
    pub(in crate::gpu) fill_group: wgpu::BindGroup,
    /// Bound where a shader declares a texture the pass did not supply.
    pub(in crate::gpu) blank: wgpu::TextureView,
}

/// Uniform bytes the arena holds: over 4,000 draws in one submit.
const ARENA_SIZE: u64 = 1 << 20;

/// The triangle as it covers a whole texture target, and the whole screen:
/// `Quad { scale, offset }` (see the vertex shader). They sit at the start
/// of the arena and are never overwritten.
const TEXTURE_QUAD: [f32; 4] = [1.0, -1.0, 0.0, 0.0];
const SCREEN_QUAD: [f32; 4] = [1.0, 1.0, 0.0, 0.0];

impl DrawState {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Result<Self, String> {
        let linker = Linker::new(device);
        let arena = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniform arena"),
            size: ARENA_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let offset_alignment = u64::from(device.limits().min_uniform_buffer_offset_alignment);
        queue.write_buffer(&arena, 0, &quad_bytes(TEXTURE_QUAD));
        queue.write_buffer(&arena, offset_alignment, &quad_bytes(SCREEN_QUAD));

        let uniform_group = |layout: &wgpu::BindGroupLayout, size: u64| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &arena,
                        offset: 0,
                        size: std::num::NonZeroU64::new(size),
                    }),
                }],
            })
        };
        let quad_group = uniform_group(linker.quad_layout(), QUAD_SIZE);
        let fill = linker.link_fill()?;
        let fill_group = uniform_group(&fill.layout, u64::from(fill.reflection.params_size));

        let blank = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("blank"),
                size: wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: texture_pool::FORMAT,
                usage: wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
            .create_view(&wgpu::TextureViewDescriptor::default());

        Ok(Self {
            linker,
            arena,
            cursor: Cell::new(2 * offset_alignment),
            offset_alignment,
            quad_group,
            fill,
            fill_group,
            blank,
        })
    }

    pub(in crate::gpu) fn arena(&self) -> &wgpu::Buffer {
        &self.arena
    }

    /// Where the identity `Quad` for a target is.
    pub(in crate::gpu) fn identity_quad_offset(&self, is_screen: bool) -> u32 {
        if is_screen { self.offset_alignment as u32 } else { 0 }
    }

    /// Put `bytes` in the arena for the submit being recorded and return
    /// their offset, or `None` when the arena is full: the caller submits
    /// what it has recorded and asks again.
    pub(in crate::gpu) fn stage(&self, queue: &wgpu::Queue, bytes: &[u8]) -> Option<u32> {
        let offset = self.cursor.get();
        let end = offset + (bytes.len() as u64).next_multiple_of(self.offset_alignment);
        if end > ARENA_SIZE {
            return None;
        }
        queue.write_buffer(&self.arena, offset, bytes);
        self.cursor.set(end);
        Some(offset as u32)
    }

    /// Forget what was staged: call after every submit.
    pub(in crate::gpu) fn reset(&self) {
        self.cursor.set(2 * self.offset_alignment);
    }
}

pub(in crate::gpu) fn quad_bytes(quad: [f32; 4]) -> [u8; 16] {
    let mut bytes = [0u8; 16];
    for (slot, value) in bytes.chunks_exact_mut(4).zip(quad) {
        slot.copy_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// The canvas the engine presents to and the frame being drawn into it.
struct Screen {
    canvas: HtmlCanvasElement,
    surface: wgpu::Surface<'static>,
    config: RefCell<wgpu::SurfaceConfiguration>,
    /// The surface texture for the frame in progress, from the first screen
    /// pass until `present`.
    frame: RefCell<Option<wgpu::SurfaceTexture>>,
}

/// Where a screen pass draws, and whether it is the first into this frame:
/// the first one has nothing to keep and starts from a cleared texture.
pub(in crate::gpu) struct ScreenTarget {
    pub(in crate::gpu) view: wgpu::TextureView,
    pub(in crate::gpu) format: wgpu::TextureFormat,
    pub(in crate::gpu) width: u32,
    pub(in crate::gpu) height: u32,
    pub(in crate::gpu) is_first_pass: bool,
}

impl GpuContext {
    /// WebGPU hands out its adapter and device through promises, so unlike
    /// the WebGL context this one is made asynchronously.
    pub async fn new(canvas: &HtmlCanvasElement) -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let surface = canvas_surface(&instance, canvas)?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                ..Default::default()
            })
            .await
            .map_err(|e| format!("WebGPU adapter: {e}"))?;

        // WebGPU's default limit is 8192, below what the same GPU allows
        // through WebGL. Ask for everything the adapter offers.
        let max_texture_size = adapter.limits().max_texture_dimension_2d;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                required_limits: wgpu::Limits {
                    max_texture_dimension_2d: max_texture_size,
                    ..wgpu::Limits::default()
                },
                ..Default::default()
            })
            .await
            .map_err(|e| format!("WebGPU device: {e}"))?;
        device.on_uncaptured_error(Arc::new(|error| {
            host::log(LogLevel::Error, &format!("[Lopsy GPU] {error}"));
        }));
        device.set_device_lost_callback(|reason, message| {
            host::log(LogLevel::Error, &format!("[Lopsy GPU] device lost ({reason:?}): {message}"));
            host::gpu_lost(&message);
        });

        let (width, height) = canvas_size(canvas);
        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or("The WebGPU adapter cannot draw to this canvas")?;
        // A WebGL canvas is premultiplied unless asked otherwise, and the
        // final blit writes the alpha the page shows through. wgpu lists
        // only `Opaque` for a canvas but configures it with this one.
        config.alpha_mode = wgpu::CompositeAlphaMode::PreMultiplied;
        surface.configure(&device, &config);

        host::log(
            LogLevel::Info,
            &format!(
                "[Lopsy GPU] wgpu {:?}: surface {:?} {:?}, max texture {max_texture_size}",
                adapter.get_info().backend,
                config.format,
                config.alpha_mode,
            ),
        );

        let draw = DrawState::new(&device, &queue)?;
        Ok(Self {
            device,
            queue,
            draw,
            screen: Screen {
                canvas: canvas.clone(),
                surface,
                config: RefCell::new(config),
                frame: RefCell::new(None),
            },
            // WebGPU requires `rgba16float` to be renderable, blendable and
            // filterable, so there is nothing to probe.
            has_half_float: true,
            has_float_blend: true,
        })
    }

    /// The texture and framebuffer pools for this context.
    pub fn create_pools(&self) -> (TexturePool, FramebufferPool) {
        (
            TexturePool::new(&self.device, &self.queue, self.max_texture_size()),
            FramebufferPool::new(),
        )
    }

    /// What compiles this context's shaders.
    pub(in crate::gpu) fn linker(&self) -> Linker {
        self.draw.linker.clone()
    }

    /// Largest texture edge the device accepts.
    pub fn max_texture_size(&self) -> u32 {
        self.device.limits().max_texture_dimension_2d
    }

    /// Destroy the device, as losing it would: every operation after this
    /// does nothing and the host is told through `host::gpu_lost`. WebGPU
    /// offers no other way to rehearse a loss.
    pub fn lose_device(&self) -> bool {
        self.device.destroy();
        true
    }

    /// Size of the canvas in device pixels.
    pub(in crate::gpu) fn screen_size(&self) -> (u32, u32) {
        canvas_size(&self.screen.canvas)
    }

    /// The view a screen pass draws into, starting a frame if none is in
    /// progress. `None` when the surface has no texture to give, which
    /// skips the frame.
    pub(in crate::gpu) fn screen_target(&self) -> Option<ScreenTarget> {
        let screen = &self.screen;
        let mut frame = screen.frame.borrow_mut();
        let is_first_pass = frame.is_none();
        if is_first_pass {
            screen.resize_to_canvas(&self.device);
            *frame = Some(screen.acquire()?);
        }
        let view = frame.as_ref()?.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let config = screen.config.borrow();
        Some(ScreenTarget { view, format: config.format, width: config.width, height: config.height, is_first_pass })
    }

    /// Hand the frame in progress, if any, to the canvas.
    pub(in crate::gpu) fn present(&self) {
        if let Some(frame) = self.screen.frame.borrow_mut().take() {
            self.queue.present(frame);
        }
    }
}

impl Screen {
    /// A surface keeps the size it was configured with; the canvas is
    /// resized from JS without telling the engine.
    fn resize_to_canvas(&self, device: &wgpu::Device) {
        let (width, height) = canvas_size(&self.canvas);
        let mut config = self.config.borrow_mut();
        if (config.width, config.height) == (width, height) {
            return;
        }
        config.width = width;
        config.height = height;
        self.surface.configure(device, &config);
    }

    fn acquire(&self) -> Option<wgpu::SurfaceTexture> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Some(frame),
            other => {
                host::log(LogLevel::Warn, &format!("[Lopsy GPU] no surface texture: {other:?}"));
                None
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
fn canvas_surface(instance: &wgpu::Instance, canvas: &HtmlCanvasElement) -> Result<wgpu::Surface<'static>, String> {
    instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
        .map_err(|e| format!("WebGPU surface: {e}"))
}

/// `cargo test` builds this backend for the machine it runs on, where no
/// canvas exists. The native host (6.10) will draw without a surface.
#[cfg(not(target_arch = "wasm32"))]
fn canvas_surface(_instance: &wgpu::Instance, _canvas: &HtmlCanvasElement) -> Result<wgpu::Surface<'static>, String> {
    Err("A canvas surface exists only in the browser".into())
}

/// A surface cannot be zero-sized, which a canvas is while it is hidden.
fn canvas_size(canvas: &HtmlCanvasElement) -> (u32, u32) {
    (canvas.width().max(1), canvas.height().max(1))
}
